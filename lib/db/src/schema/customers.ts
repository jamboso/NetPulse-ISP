import { pgTable, serial, text, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id:        serial("id").primaryKey(),
  companyId: integer("company_id").notNull().default(1),
  name:      text("name").notNull(),
  email:     text("email").notNull().unique(),
  phone:     text("phone").notNull(),
  address:   text("address").notNull(),
  status:    text("status").notNull().default("active"),
  notes:          text("notes"),
  latitude:       doublePrecision("latitude"),
  longitude:      doublePrecision("longitude"),
  pppoeUsername:  text("pppoe_username"),
  pppoePassword:  text("pppoe_password"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
