import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const customerCommunicationsTable = pgTable("customer_communications", {
  id:         serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  type:       text("type").notNull().default("note"),       // note | sms | email | call
  direction:  text("direction").notNull().default("outbound"), // outbound | inbound
  subject:    text("subject"),
  content:    text("content").notNull(),
  sentBy:     text("sent_by"),                              // staff name/email
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, t => [
  index("customer_comms_customer_id_idx").on(t.customerId),
  index("customer_comms_created_at_idx").on(t.createdAt),
]);

export type CustomerCommunication = typeof customerCommunicationsTable.$inferSelect;
