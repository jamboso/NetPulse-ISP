import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const securityEventsTable = pgTable("security_events", {
  id:        serial("id").primaryKey(),
  eventType: text("event_type").notNull().default("blocked_callback"),
  callerIp:  text("caller_ip").notNull(),
  endpoint:  text("endpoint").notNull(),
  method:    text("method").notNull().default("POST"),
  reason:    text("reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("security_events_event_type_idx").on(t.eventType),
  index("security_events_created_at_idx").on(t.createdAt),
  index("security_events_caller_ip_idx").on(t.callerIp),
]);

export type SecurityEvent = typeof securityEventsTable.$inferSelect;
