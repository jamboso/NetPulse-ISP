import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Fiber access is intentionally independent from RouterOS devices. OLTs own
 * their PON inventory and detected ONUs; the encrypted connection payload is
 * never selected into API responses.
 */
export const oltsTable = pgTable("olts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  vendor: text("vendor").notNull(),
  model: text("model").notNull(),
  firmwareVersion: text("firmware_version"),
  ponTechnology: text("pon_technology").notNull(), // "epon" | "gpon"
  managementHost: text("management_host").notNull(),
  managementPort: integer("management_port").notNull().default(161),
  managementProtocol: text("management_protocol").notNull().default("snmp-v2c"),
  encryptedManagementCredentials: text("encrypted_management_credentials").notNull(),
  location: text("location"),
  enabled: boolean("enabled").notNull().default(true),
  healthState: text("health_state").notNull().default("unknown"),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  lastDiscoveryAt: timestamp("last_discovery_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("olts_company_id_idx").on(t.companyId),
  index("olts_company_name_idx").on(t.companyId, t.name),
]);

export const oltPonPortsTable = pgTable("olt_pon_ports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  oltId: integer("olt_id").notNull(),
  portNumber: text("port_number").notNull(),
  label: text("label"),
  state: text("state").notNull().default("unknown"),
  opticalState: text("optical_state"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("olt_pon_ports_company_olt_idx").on(t.companyId, t.oltId),
  index("olt_pon_ports_lookup_idx").on(t.oltId, t.portNumber),
  uniqueIndex("olt_pon_ports_company_olt_port_unique").on(t.companyId, t.oltId, t.portNumber),
]);

export const onusTable = pgTable("onus", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  oltId: integer("olt_id").notNull(),
  ponPortId: integer("pon_port_id"),
  serialNumber: text("serial_number"),
  loid: text("loid"),
  vendor: text("vendor"),
  model: text("model"),
  macAddress: text("mac_address"),
  opticalState: text("optical_state"),
  rxPowerDbm: text("rx_power_dbm"),
  txPowerDbm: text("tx_power_dbm"),
  provisioningState: text("provisioning_state").notNull().default("discovered"),
  customerId: integer("customer_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("onus_company_olt_idx").on(t.companyId, t.oltId),
  index("onus_company_serial_idx").on(t.companyId, t.serialNumber),
  index("onus_company_customer_idx").on(t.companyId, t.customerId),
  uniqueIndex("onus_company_olt_serial_unique").on(t.companyId, t.oltId, t.serialNumber),
]);

export const oltServiceProfilesTable = pgTable("olt_service_profiles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  vlanId: integer("vlan_id").notNull(),
  accessMode: text("access_mode").notNull(), // bridge | router | pppoe | dhcp
  downstreamKbps: integer("downstream_kbps"),
  upstreamKbps: integer("upstream_kbps"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("olt_service_profiles_company_idx").on(t.companyId),
  index("olt_service_profiles_company_name_idx").on(t.companyId, t.name),
]);

export const oltProvisioningJobsTable = pgTable("olt_provisioning_jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  oltId: integer("olt_id").notNull(),
  onuId: integer("onu_id"),
  serviceProfileId: integer("service_profile_id"),
  operation: text("operation").notNull(), // discovery | provision | rollback
  status: text("status").notNull().default("queued"),
  dryRun: boolean("dry_run").notNull().default(true),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
  requestedBy: text("requested_by").notNull(),
  result: text("result"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("olt_jobs_company_created_idx").on(t.companyId, t.createdAt),
  index("olt_jobs_company_olt_idx").on(t.companyId, t.oltId),
  index("olt_jobs_company_onu_idx").on(t.companyId, t.onuId),
]);

export const insertOltSchema = createInsertSchema(oltsTable).omit({
  id: true, companyId: true, encryptedManagementCredentials: true, healthState: true,
  lastHealthCheckAt: true, lastDiscoveryAt: true, lastError: true, createdAt: true, updatedAt: true,
});
export const insertOltPonPortSchema = createInsertSchema(oltPonPortsTable).omit({ id: true, companyId: true, createdAt: true, updatedAt: true });
export const insertOnuSchema = createInsertSchema(onusTable).omit({ id: true, companyId: true, createdAt: true, updatedAt: true });
export const insertOltServiceProfileSchema = createInsertSchema(oltServiceProfilesTable).omit({ id: true, companyId: true, createdAt: true, updatedAt: true });
export const insertOltProvisioningJobSchema = createInsertSchema(oltProvisioningJobsTable).omit({ id: true, companyId: true, createdAt: true });

export type Olt = typeof oltsTable.$inferSelect;
export type OltPonPort = typeof oltPonPortsTable.$inferSelect;
export type Onu = typeof onusTable.$inferSelect;
export type OltServiceProfile = typeof oltServiceProfilesTable.$inferSelect;
export type OltProvisioningJob = typeof oltProvisioningJobsTable.$inferSelect;
export type InsertOlt = z.infer<typeof insertOltSchema>;