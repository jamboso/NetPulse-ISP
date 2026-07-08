import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id:         serial("id").primaryKey(),
  userId:     text("user_id").notNull(),
  userEmail:  text("user_email"),
  action:     text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId:   integer("entity_id"),
  diff:       jsonb("diff"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("audit_logs_user_id_idx").on(t.userId),
  index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  index("audit_logs_created_at_idx").on(t.createdAt),
]);

export type AuditLog = typeof auditLogsTable.$inferSelect;
