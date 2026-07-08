import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ipPoolsTable = pgTable("ip_pools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  network: text("network").notNull(),
  gateway: text("gateway").notNull(),
  subnetMask: text("subnet_mask").notNull(),
  dns1: text("dns1"),
  dns2: text("dns2"),
  totalIps: integer("total_ips").notNull().default(0),
  usedIps: integer("used_ips").notNull().default(0),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIpPoolSchema = createInsertSchema(ipPoolsTable).omit({ id: true, createdAt: true });
export type InsertIpPool = z.infer<typeof insertIpPoolSchema>;
export type IpPool = typeof ipPoolsTable.$inferSelect;
