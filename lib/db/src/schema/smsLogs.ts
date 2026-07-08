import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const smsLogsTable = pgTable("sms_logs", {
  id:             serial("id").primaryKey(),
  customerId:     integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  subscriptionId: integer("subscription_id"),
  phone:          text("phone").notNull(),
  message:        text("message").notNull(),
  templateId:     integer("template_id"),
  triggerType:    text("trigger_type").notNull().default("manual"),
  status:         text("status").notNull().default("sent"),  // sent | failed
  error:          text("error"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, t => [
  index("sms_logs_customer_id_idx").on(t.customerId),
  index("sms_logs_created_at_idx").on(t.createdAt),
  index("sms_logs_trigger_type_idx").on(t.triggerType),
  index("sms_logs_subscription_trigger_idx").on(t.subscriptionId, t.triggerType),
]);

export type SmsLog = typeof smsLogsTable.$inferSelect;
