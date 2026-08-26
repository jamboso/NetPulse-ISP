import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const routersTable = pgTable("routers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().default(1),
  // Optional link to the customer who owns this router (e.g. a customer-premises
  // router NetPulse auto-forwards traffic through). Historic rows and
  // company-owned infrastructure stay null ("unassigned") until a staff member
  // explicitly assigns them — never inferred/backfilled automatically.
  customerId: integer("customer_id").references(() => customersTable.id),
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
  // ── NETPULSE Bridge ───────────────────────────────────────────────────────
  // JSON array of interface names currently in the NETPULSE bridge, e.g. ["ether2","ether3"]
  bridgePorts: text("bridge_ports").default('["ether2"]'),
}, t => [
  index("routers_customer_id_idx").on(t.customerId),
]);

export const insertRouterSchema = createInsertSchema(routersTable).omit({ id: true, createdAt: true, lastSeen: true, companyId: true });
export type InsertRouter = z.infer<typeof insertRouterSchema>;
export type RouterDevice = typeof routersTable.$inferSelect;
