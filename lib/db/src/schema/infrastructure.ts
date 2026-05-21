import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const vpnConfigTable = pgTable("vpn_config", {
  id: serial("id").primaryKey(),
  serverPublicIp: text("server_public_ip"),
  vpnPort: integer("vpn_port").default(1194),
  vpnProtocol: text("vpn_protocol").default("tcp"),
  vpnSubnet: text("vpn_subnet").default("10.8.0.0"),
  vpnSubnetMask: text("vpn_subnet_mask").default("255.255.255.0"),
  vpnDns: text("vpn_dns").default("8.8.8.8"),
  caCert: text("ca_cert"),
  caKey: text("ca_key"),
  serverCert: text("server_cert"),
  serverKey: text("server_key"),
  isConfigured: boolean("is_configured").default(false),
  certsGeneratedAt: timestamp("certs_generated_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const routerVpnCertsTable = pgTable("router_vpn_certs", {
  id: serial("id").primaryKey(),
  routerId: integer("router_id").notNull(),
  routerName: text("router_name").notNull(),
  clientCert: text("client_cert"),
  clientKey: text("client_key"),
  vpnIp: text("vpn_ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
});

export type VpnConfig = typeof vpnConfigTable.$inferSelect;
export type RouterVpnCert = typeof routerVpnCertsTable.$inferSelect;
