import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";

export const blockedIpsTable = pgTable("blocked_ips", {
  id:           serial("id").primaryKey(),
  ip:           text("ip").notNull().unique(),
  blockedAt:    timestamp("blocked_at").notNull().defaultNow(),
  expiresAt:    timestamp("expires_at").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  reason:       text("reason").notNull(),
}, (t) => [
  index("blocked_ips_ip_idx").on(t.ip),
  index("blocked_ips_expires_at_idx").on(t.expiresAt),
]);

export type BlockedIp = typeof blockedIpsTable.$inferSelect;
