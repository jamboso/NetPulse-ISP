import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const vpnConfigsTable = pgTable("vpn_configs", {
  id:           serial("id").primaryKey(),
  customerId:   integer("customer_id").notNull().references(() => customersTable.id),
  commonName:   text("common_name").notNull().unique(),
  ovpnConfig:   text("ovpn_config").notNull(),
  issuedAt:     timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt:    timestamp("revoked_at", { withTimezone: true }),
  revokedBy:    text("revoked_by"),
});

export type CustomerVpnConfig = typeof vpnConfigsTable.$inferSelect;
