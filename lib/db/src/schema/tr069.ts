import { pgTable, serial, integer, text, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * TR-069 is deliberately kept separate from OLT provisioning. A discovered
 * ONU may (or may not) have an independently managed CWMP CPE behind it.
 * Only opaque, encrypted connector credentials are persisted here.
 */
export const tr069AcsConfigsTable = pgTable("tr069_acs_configs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull().default("GenieACS"),
  baseUrl: text("base_url").notNull(),
  encryptedNbiCredentials: text("encrypted_nbi_credentials").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("tr069_acs_configs_company_unique").on(t.companyId),
  index("tr069_acs_configs_company_idx").on(t.companyId),
]);

export const tr069DevicesTable = pgTable("tr069_devices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  onuId: integer("onu_id").notNull(),
  acsConfigId: integer("acs_config_id").notNull(),
  acsDeviceId: text("acs_device_id").notNull(),
  dataModel: text("data_model").notNull(), // tr-098 | tr-181
  status: text("status").notNull().default("pending_inform"),
  deviceAuthenticationConfigured: boolean("device_authentication_configured").notNull().default(false),
  deviceAuthenticationVerifiedAt: timestamp("device_authentication_verified_at", { withTimezone: true }),
  dataModelVerifiedAt: timestamp("data_model_verified_at", { withTimezone: true }),
  lastInformAt: timestamp("last_inform_at", { withTimezone: true }),
  lastManagedAt: timestamp("last_managed_at", { withTimezone: true }),
  lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
  reportedParameters: jsonb("reported_parameters").notNull().default({}),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("tr069_devices_company_onu_unique").on(t.companyId, t.onuId),
  uniqueIndex("tr069_devices_config_acs_device_unique").on(t.acsConfigId, t.acsDeviceId),
  index("tr069_devices_company_status_idx").on(t.companyId, t.status),
  index("tr069_devices_company_onu_idx").on(t.companyId, t.onuId),
]);

export const tr069CommandsTable = pgTable("tr069_commands", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  tr069DeviceId: integer("tr069_device_id").notNull(),
  serviceProfileId: integer("service_profile_id"),
  operation: text("operation").notNull().default("apply_service_profile"),
  parameters: jsonb("parameters").notNull().default([]),
  status: text("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  acsTaskId: text("acs_task_id"),
  result: jsonb("result"),
  error: text("error"),
  recoveryGuidance: text("recovery_guidance"),
  requestedBy: text("requested_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("tr069_commands_company_created_idx").on(t.companyId, t.createdAt),
  index("tr069_commands_company_device_idx").on(t.companyId, t.tr069DeviceId),
  index("tr069_commands_status_retry_idx").on(t.status, t.nextAttemptAt),
]);

export const insertTr069AcsConfigSchema = createInsertSchema(tr069AcsConfigsTable).omit({
  id: true, companyId: true, encryptedNbiCredentials: true, lastValidatedAt: true, lastError: true, createdAt: true, updatedAt: true,
});
export const insertTr069DeviceSchema = createInsertSchema(tr069DevicesTable).omit({
  id: true, companyId: true, deviceAuthenticationVerifiedAt: true, dataModelVerifiedAt: true, lastInformAt: true, lastManagedAt: true, lastRefreshAt: true, lastError: true, createdAt: true, updatedAt: true,
});
export const insertTr069CommandSchema = createInsertSchema(tr069CommandsTable).omit({
  id: true, companyId: true, acsTaskId: true, result: true, error: true, recoveryGuidance: true, startedAt: true, completedAt: true, createdAt: true, updatedAt: true,
});

export type Tr069AcsConfig = typeof tr069AcsConfigsTable.$inferSelect;
export type Tr069Device = typeof tr069DevicesTable.$inferSelect;
export type Tr069Command = typeof tr069CommandsTable.$inferSelect;
export type InsertTr069AcsConfig = z.infer<typeof insertTr069AcsConfigSchema>;
export type InsertTr069Device = z.infer<typeof insertTr069DeviceSchema>;
export type InsertTr069Command = z.infer<typeof insertTr069CommandSchema>;