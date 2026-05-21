import { pgTable, serial, integer, bigint, timestamp, text, index } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { subscriptionsTable } from "./subscriptions";

export const sessionLogsTable = pgTable("session_logs", {
  id:             serial("id").primaryKey(),
  customerId:     integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  pppoeUsername:  text("pppoe_username"),
  ipAddress:      text("ip_address"),
  macAddress:     text("mac_address"),
  sessionType:    text("session_type").default("pppoe").notNull(),
  routerName:     text("router_name"),
  bytesIn:        bigint("bytes_in",  { mode: "number" }).default(0).notNull(),
  bytesOut:       bigint("bytes_out", { mode: "number" }).default(0).notNull(),
  sessionStart:   timestamp("session_start").defaultNow().notNull(),
  sessionEnd:     timestamp("session_end"),
}, t => [
  index("session_logs_customer_id_idx").on(t.customerId),
  index("session_logs_subscription_id_idx").on(t.subscriptionId),
  index("session_logs_session_start_idx").on(t.sessionStart),
  index("session_logs_ip_address_idx").on(t.ipAddress),
  index("session_logs_mac_address_idx").on(t.macAddress),
]);

export type SessionLog = typeof sessionLogsTable.$inferSelect;
