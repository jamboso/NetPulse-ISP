import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

// Per-company M-Pesa Daraja credentials. Each SaaS client company can run
// its own paybill/till with its own Consumer Key/Secret/Passkey, isolated
// from every other company. One row per company (companyId is unique).
// Callback URLs are disambiguated per company via companies.username in
// the path (see /api/mpesa/callback/:companyUsername), since Safaricom
// callbacks arrive unauthenticated and must be routed to the right tenant.
export const companyMpesaConfigsTable = pgTable("company_mpesa_configs", {
  id:             serial("id").primaryKey(),
  companyId:      integer("company_id").notNull().unique().references(() => companiesTable.id, { onDelete: "cascade" }),
  consumerKey:    text("consumer_key"),
  consumerSecret: text("consumer_secret"),
  shortcode:      text("shortcode"),
  passkey:        text("passkey"),
  paybillNumber:  text("paybill_number"), // display value shown in SMS/receipts
  env:            text("env").notNull().default("sandbox"), // "sandbox" | "production"
  callbackUrl:    text("callback_url"), // override; defaults to the company-scoped callback path if unset
  allowedIps:     text("allowed_ips"), // comma-separated CIDRs/IPs; "*" disables the check
  webhookSecret:  text("webhook_secret"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanyMpesaConfigSchema = createInsertSchema(companyMpesaConfigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanyMpesaConfig = z.infer<typeof insertCompanyMpesaConfigSchema>;
export type CompanyMpesaConfig = typeof companyMpesaConfigsTable.$inferSelect;
