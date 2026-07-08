import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const smsTemplatesTable = pgTable("sms_templates", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  // "manual" | "reminder_6" | "reminder_5" | "reminder_4" | "reminder_3" | "reminder_2" | "reminder_1" | "reminder_0"
  triggerType: text("trigger_type").notNull().default("manual"),
  message:     text("message").notNull(),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type SmsTemplate = typeof smsTemplatesTable.$inferSelect;
