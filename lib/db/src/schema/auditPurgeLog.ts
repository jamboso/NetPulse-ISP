import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const auditPurgeLogTable = pgTable("audit_purge_log", {
  id:           serial("id").primaryKey(),
  purgedAt:     timestamp("purged_at", { withTimezone: true }).notNull().defaultNow(),
  deletedCount: integer("deleted_count").notNull(),
  triggeredBy:  text("triggered_by").notNull(),
});

export type AuditPurgeLog = typeof auditPurgeLogTable.$inferSelect;
