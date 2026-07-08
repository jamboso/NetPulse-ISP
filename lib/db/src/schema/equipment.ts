import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const equipmentTable = pgTable("equipment", {
  id:         serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  name:       text("name").notNull(),
  type:       text("type").notNull().default("router"),
  model:      text("model").notNull(),
  brand:      text("brand"),
  ipAddress:  text("ip_address").notNull(),
  macAddress: text("mac_address"),
  location:   text("location"),
  status:     text("status").notNull().default("online"),
  notes:      text("notes"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, t => [
  index("equipment_customer_id_idx").on(t.customerId),
]);

export const insertEquipmentSchema = createInsertSchema(equipmentTable).omit({ id: true, createdAt: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipmentTable.$inferSelect;
