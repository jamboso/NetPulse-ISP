/**
 * Daily staff-inactivity digest.
 *
 * Each hourly check finds active staff accounts that have not logged in for
 * 30 days or more, then emails the owning company administrator a single
 * tenant-scoped digest. A durable per-company delivery claim prevents duplicate
 * sends after restarts and makes failures retryable.
 */

import {
  companiesTable,
  db,
  sessionsTable,
  staffInactivityDigestLogTable,
  usersTable,
} from "@workspace/db";
import { and, eq, isNull, lt, lte, max, or } from "drizzle-orm";
import {
  sendStaffInactivityDigestEmail,
  type StaffInactivityDigestUser,
} from "./mailer.js";
import { logger } from "./logger.js";
import { getSettings } from "./sms.js";

const INACTIVITY_DAYS = 30;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STALE_CLAIM_MS = 60 * 60 * 1000;

type Company = {
  id: number;
  name: string;
};

function startOfUtcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function staffPageUrl(): string {
  const appUrl = process.env["REPLIT_DOMAINS"]
    ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}`
    : (process.env["BETTER_AUTH_URL"] ?? "https://your-app.example.com");
  return `${appUrl.replace(/\/$/, "")}/staff`;
}

function inactiveCutoff(now: Date): Date {
  return new Date(now.getTime() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);
}

async function findDormantStaff(companyId: number, cutoff: Date): Promise<StaffInactivityDigestUser[]> {
  const lastActiveSubquery = db
    .select({
      userId: sessionsTable.userId,
      lastActiveAt: max(sessionsTable.createdAt).as("last_active_at"),
    })
    .from(sessionsTable)
    .groupBy(sessionsTable.userId)
    .as("last_active");

  return db
    .select({
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
      lastActiveAt: lastActiveSubquery.lastActiveAt,
    })
    .from(usersTable)
    .leftJoin(lastActiveSubquery, eq(lastActiveSubquery.userId, usersTable.id))
    .where(and(
      eq(usersTable.companyId, companyId),
      eq(usersTable.active, true),
      or(
        lte(lastActiveSubquery.lastActiveAt, cutoff),
        and(isNull(lastActiveSubquery.lastActiveAt), lte(usersTable.createdAt, cutoff)),
      ),
    ))
    .orderBy(usersTable.name);
}

async function findActiveAdminEmails(companyId: number): Promise<string[]> {
  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.companyId, companyId),
      eq(usersTable.role, "admin"),
      eq(usersTable.active, true),
    ));

  return admins.map((admin) => admin.email);
}

/**
 * Atomically claims a company/date delivery slot. Failed claims are reclaimed
 * on the next hourly check; a stuck claim is retried after one hour.
 */
async function claimDigest(
  company: Company,
  digestDate: string,
  recipientEmail: string,
  affectedCount: number,
  now: Date,
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const [claimed] = await db
    .insert(staffInactivityDigestLogTable)
    .values({
      companyId: company.id,
      digestDate,
      recipientEmail,
      affectedCount,
      status: "pending",
      processingStartedAt: now,
      sentAt: null,
      error: null,
    })
    .onConflictDoUpdate({
      target: [
        staffInactivityDigestLogTable.companyId,
        staffInactivityDigestLogTable.digestDate,
      ],
      set: {
        recipientEmail,
        affectedCount,
        status: "pending",
        processingStartedAt: now,
        sentAt: null,
        error: null,
      },
      setWhere: or(
        eq(staffInactivityDigestLogTable.status, "failed"),
        and(
          eq(staffInactivityDigestLogTable.status, "pending"),
          lt(staffInactivityDigestLogTable.processingStartedAt, staleBefore),
        ),
      ),
    })
    .returning({ id: staffInactivityDigestLogTable.id });

  return Boolean(claimed);
}

async function markDelivery(
  companyId: number,
  digestDate: string,
  result: { success: boolean; message: string },
): Promise<void> {
  await db
    .update(staffInactivityDigestLogTable)
    .set(result.success
      ? { status: "sent", sentAt: new Date(), error: null }
      : { status: "failed", error: result.message })
    .where(and(
      eq(staffInactivityDigestLogTable.companyId, companyId),
      eq(staffInactivityDigestLogTable.digestDate, digestDate),
    ));
}

/**
 * Sends any unsent daily inactivity digests that are due. Exported for
 * deterministic testing and manual operational checks.
 */
export async function runStaffInactivityDigest(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (!settings["smtpHost"] || !settings["smtpUser"] || !settings["smtpPass"]) {
    logger.warn("Staff inactivity digest: SMTP not configured, skipping");
    return 0;
  }

  const companies = await db
    .select({
      id: companiesTable.id,
      name: companiesTable.name,
    })
    .from(companiesTable);

  const digestDate = startOfUtcDay(now);
  const cutoff = inactiveCutoff(now);
  let sentCount = 0;

  for (const company of companies) {
    const dormantStaff = await findDormantStaff(company.id, cutoff);
    if (dormantStaff.length === 0) continue;

    const adminEmails = await findActiveAdminEmails(company.id);
    if (adminEmails.length === 0) {
      logger.warn(
        { companyId: company.id, affectedCount: dormantStaff.length },
        "Staff inactivity digest skipped because the company has no active admins",
      );
      continue;
    }

    const recipientEmail = adminEmails.join(",");
    const claimed = await claimDigest(company, digestDate, recipientEmail, dormantStaff.length, now);
    if (!claimed) continue;

    const result = await sendStaffInactivityDigestEmail({
      to: adminEmails,
      companyName: company.name,
      staffPageUrl: staffPageUrl(),
      inactiveUsers: dormantStaff,
      settings,
    });

    await markDelivery(company.id, digestDate, result);
    if (result.success) {
      sentCount += 1;
      logger.info(
        { companyId: company.id, recipientEmail, affectedCount: dormantStaff.length },
        "Staff inactivity digest sent",
      );
    } else {
      logger.warn(
        { companyId: company.id, recipientEmail, error: result.message },
        "Staff inactivity digest failed; it will be retried",
      );
    }
  }

  return sentCount;
}

export function startStaffInactivityDigestScheduler(): void {
  runStaffInactivityDigest().catch((err) =>
    logger.warn({ err }, "Staff inactivity digest: initial check failed"),
  );

  setInterval(() => {
    runStaffInactivityDigest().catch((err) =>
      logger.warn({ err }, "Staff inactivity digest: scheduled check failed"),
    );
  }, CHECK_INTERVAL_MS);

  logger.info({ checkIntervalMs: CHECK_INTERVAL_MS }, "Staff inactivity digest scheduler started");
}
