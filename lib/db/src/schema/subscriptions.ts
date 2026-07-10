import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { plansTable } from "./plans";
import { routersTable } from "./routers";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().default(1),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  planId: integer("plan_id").notNull().references(() => plansTable.id),
  routerId: integer("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  ipAddress: text("ip_address"),
  macAddress: text("mac_address"),
  pppoeUsername: text("pppoe_username"),
  pppoePassword: text("pppoe_password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("subscriptions_customer_id_idx").on(t.customerId),
  index("subscriptions_status_idx").on(t.status),
]);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
