import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const routersTable = pgTable("routers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  routerType: text("router_type").notNull().default("routeros"),
  ipAddress: text("ip_address").notNull(),
  port: integer("port"),
  username: text("username").notNull(),
  password: text("password").notNull(),
  description: text("description"),
  location: text("location"),
  // RouterOS-specific
  apiSsl: boolean("api_ssl").default(false),
  // Juniper / EdgeRouter
  sshPort: integer("ssh_port"),
  netconfPort: integer("netconf_port"),
  // Status
  enabled: boolean("enabled").notNull().default(true),
  lastSeen: timestamp("last_seen"),
  monitorState: text("monitor_state"), // persisted: "online" | "offline" | null
  radiusSecret: text("radius_secret"),
  radiusPort: integer("radius_port").default(1812),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ── Zero-Touch Provisioning ──────────────────────────────────────────────
  provisionToken: text("provision_token").unique(),
  provisionStatus: text("provision_status").notNull().default("pending"), // "pending" | "provisioned" | "connected"
  macAddress: text("mac_address"),
  rosVersion: text("ros_version"),
  vpnConnected: boolean("vpn_connected").notNull().default(false),
  lastCallbackAt: timestamp("last_callback_at"),
  vpnIp: text("vpn_ip"),
});

export const insertRouterSchema = createInsertSchema(routersTable).omit({ id: true, createdAt: true, lastSeen: true });
export type InsertRouter = z.infer<typeof insertRouterSchema>;
export type RouterDevice = typeof routersTable.$inferSelect;
