import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

// Tracks in-flight and completed company subscription renewal payments
// (M-Pesa STK Push or Stripe Checkout). A row is created when a company
// admin initiates a renewal and completed by the corresponding webhook/
// callback, which then extends companiesTable.accessUntil by `months`.
export const companyRenewalsTable = pgTable("company_renewals", {
  id:               serial("id").primaryKey(),
  companyId:        integer("company_id").notNull().references(() => companiesTable.id),
  provider:         text("provider").notNull(), // "mpesa" | "stripe"
  externalRef:      text("external_ref").notNull(), // CheckoutRequestID or Stripe session id
  months:           integer("months").notNull(),
  amount:           numeric("amount").notNull(),
  status:           text("status").notNull().default("pending"), // "pending" | "completed" | "failed"
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  completedAt:      timestamp("completed_at"),
});

export type CompanyRenewal = typeof companyRenewalsTable.$inferSelect;
