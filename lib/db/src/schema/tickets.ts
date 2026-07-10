import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().default(1),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  category: text("category"),
  assignedTo: text("assigned_to"),
  resolvedAt: text("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("tickets_customer_id_idx").on(t.customerId),
  index("tickets_status_idx").on(t.status),
]);

export const ticketRepliesTable = pgTable("ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id),
  message: text("message").notNull(),
  author: text("author").notNull(),
  isStaff: text("is_staff").notNull().default("false"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ id: true, createdAt: true });
export const insertTicketReplySchema = createInsertSchema(ticketRepliesTable).omit({ id: true, createdAt: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type InsertTicketReply = z.infer<typeof insertTicketReplySchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
export type TicketReply = typeof ticketRepliesTable.$inferSelect;
