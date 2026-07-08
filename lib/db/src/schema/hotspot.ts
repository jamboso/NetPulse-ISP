import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { routersTable } from "./routers";

// ── Hotspot Packages (per router) ────────────────────────────────────────────
export const hotspotPackagesTable = pgTable("hotspot_packages", {
  id: serial("id").primaryKey(),
  routerId: integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  dataLimitMb: integer("data_limit_mb"),
  downloadSpeedKbps: integer("download_speed_kbps"),
  uploadSpeedKbps: integer("upload_speed_kbps"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("KES"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertHotspotPackageSchema = createInsertSchema(hotspotPackagesTable).omit({ id: true, createdAt: true });
export type InsertHotspotPackage = z.infer<typeof insertHotspotPackageSchema>;
export type HotspotPackage = typeof hotspotPackagesTable.$inferSelect;

// ── Hotspot Vouchers / Sessions ───────────────────────────────────────────────
export const hotspotVouchersTable = pgTable("hotspot_vouchers", {
  id: serial("id").primaryKey(),
  routerId: integer("router_id").notNull().references(() => routersTable.id),
  packageId: integer("package_id").references(() => hotspotPackagesTable.id),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  phone: text("phone").notNull(),
  macAddress: text("mac_address"),
  ipAddress: text("ip_address"),
  checkoutRequestId: text("checkout_request_id"),
  mpesaRef: text("mpesa_ref"),
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at"),
  activatedAt: timestamp("activated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertHotspotVoucherSchema = createInsertSchema(hotspotVouchersTable).omit({ id: true, createdAt: true });
export type InsertHotspotVoucher = z.infer<typeof insertHotspotVoucherSchema>;
export type HotspotVoucher = typeof hotspotVouchersTable.$inferSelect;
