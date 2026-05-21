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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRouterSchema = createInsertSchema(routersTable).omit({ id: true, createdAt: true, lastSeen: true });
export type InsertRouter = z.infer<typeof insertRouterSchema>;
export type RouterDevice = typeof routersTable.$inferSelect;
