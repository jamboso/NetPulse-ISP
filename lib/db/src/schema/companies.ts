import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Multi-tenant company accounts. Each company is a resold ISP instance with
// its own isolated customers/plans/subscriptions/etc, scoped by companyId
// on the tenant-owned tables. The platform owner (role "owner") manages
// companies from an owner-only area and is not itself scoped to a company.
export const companiesTable = pgTable("companies", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull(),
  username:     text("username").notNull().unique(), // auto-derived from initials, e.g. "WM"
  ownerEmail:   text("owner_email").notNull(),
  ownerPhone:   text("owner_phone"),
  // "active" | "suspended" — exempt overrides this and always grants access
  accessStatus: text("access_status").notNull().default("active"),
  exempt:       boolean("exempt").notNull().default(false),
  accessUntil:  timestamp("access_until"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
