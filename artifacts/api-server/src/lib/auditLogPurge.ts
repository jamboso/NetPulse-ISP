/**
 * Audit Log Purge Scheduler
 *
 * Reads `auditLogRetentionDays` from the settings table and deletes
 * audit_logs rows whose created_at is older than that threshold.
 * Defaults to 365 days. Setting to 0 disables purging.
 *
 * Runs once on startup and then every 24 hours.
 */

import { db, auditLogsTable, settingsTable } from "@workspace/db";
import { lt, eq } from "drizzle-orm";
import { logger } from "./logger";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_RETENTION_DAYS = 365;

async function getRetentionDays(): Promise<number> {
  const rows = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "auditLogRetentionDays"))
    .limit(1);

  if (rows.length === 0 || rows[0]!.value === null || rows[0]!.value === "") {
    return DEFAULT_RETENTION_DAYS;
  }

  const parsed = parseInt(rows[0]!.value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

export async function purgeAuditLogs(): Promise<number> {
  const retentionDays = await getRetentionDays();

  if (retentionDays === 0) {
    logger.info("Audit log purge: retention disabled (0), skipping");
    return 0;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const deleted = await db
    .delete(auditLogsTable)
    .where(lt(auditLogsTable.createdAt, cutoff))
    .returning({ id: auditLogsTable.id });

  const count = deleted.length;

  if (count > 0) {
    logger.info({ count, retentionDays, cutoff }, "Audit log purge: deleted old records");
  } else {
    logger.debug({ retentionDays, cutoff }, "Audit log purge: no records to delete");
  }

  return count;
}

export function startAuditLogPurgeScheduler(): void {
  purgeAuditLogs().catch((err) =>
    logger.warn({ err }, "Audit log purge: initial run failed"),
  );

  setInterval(() => {
    purgeAuditLogs().catch((err) =>
      logger.warn({ err }, "Audit log purge: scheduled run failed"),
    );
  }, INTERVAL_MS);

  logger.info({ intervalMs: INTERVAL_MS }, "Audit log purge scheduler started");
}
