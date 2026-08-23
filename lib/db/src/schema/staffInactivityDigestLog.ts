import { date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Records the daily staff-inactivity digest delivery state for each company.
 * The unique company/date constraint ensures a successful digest is never sent
 * more than once per UTC calendar day, even if the API server restarts.
 */
export const staffInactivityDigestLogTable = pgTable(
  "staff_inactivity_digest_log",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    digestDate: date("digest_date", { mode: "string" }).notNull(),
    recipientEmail: text("recipient_email").notNull(),
    affectedCount: integer("affected_count").notNull(),
    status: text("status").notNull().default("pending"),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("staff_inactivity_digest_company_date_idx").on(
      table.companyId,
      table.digestDate,
    ),
  ],
);

export type StaffInactivityDigestLog = typeof staffInactivityDigestLogTable.$inferSelect;