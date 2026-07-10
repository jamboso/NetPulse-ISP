import { db, companiesTable, usersTable } from "@workspace/db";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_COMPANY_ID = 1;

/**
 * Idempotent startup safeguard for the multi-tenant migration. Ensures:
 *  - the default company (id=1, exempt) exists, so pre-migration tenant
 *    data (which defaults companyId to 1) always resolves to a real row.
 *  - every non-owner user has a companyId, so existing staff accounts from
 *    before the multi-tenant conversion are never locked out by
 *    resolveCompanyScope after a deploy/merge.
 *  - at least one "owner" account exists, so owner-only areas (Companies,
 *    Settings, billing controls) are always reachable. New installs get
 *    their owner assigned at setup time (see routes/setup.ts); installs
 *    that completed setup before the multi-tenant conversion existed have
 *    no owner yet, so we promote their earliest-created admin here.
 *
 * Runs on every boot; all operations are no-ops once applied.
 */
export async function ensureCompanyBackfill(): Promise<void> {
  const [defaultCompany] = await db.select().from(companiesTable).where(eq(companiesTable.id, DEFAULT_COMPANY_ID));

  if (!defaultCompany) {
    await db.insert(companiesTable).values({
      id: DEFAULT_COMPANY_ID,
      name: "Default Company",
      username: "DEFAULT",
      ownerEmail: "owner@localhost",
      accessStatus: "active",
      exempt: true,
      accessUntil: null,
    }).onConflictDoNothing();
    logger.info({ companyId: DEFAULT_COMPANY_ID }, "Created default company for multi-tenant backfill");
  }

  const orphaned = await db
    .update(usersTable)
    .set({ companyId: DEFAULT_COMPANY_ID })
    .where(and(ne(usersTable.role, "owner"), isNull(usersTable.companyId)))
    .returning({ id: usersTable.id });

  if (orphaned.length > 0) {
    logger.warn(
      { count: orphaned.length, userIds: orphaned.map(u => u.id) },
      "Backfilled companyId for users left without a tenant assignment",
    );
  }

  const [existingOwner] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "owner"));
  if (!existingOwner) {
    const [earliestAdmin] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .orderBy(asc(usersTable.createdAt))
      .limit(1);

    if (earliestAdmin) {
      await db.update(usersTable)
        .set({ role: "owner", companyId: null, updatedAt: new Date() })
        .where(eq(usersTable.id, earliestAdmin.id));
      logger.warn(
        { userId: earliestAdmin.id, email: earliestAdmin.email },
        "No owner account found — promoted earliest admin to owner for multi-tenant backfill",
      );
    }
  }
}
