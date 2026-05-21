import { pgTable, serial, integer, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { subscriptionsTable } from "./subscriptions";

export const usageSnapshotsTable = pgTable("usage_snapshots", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
  bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, t => [
  index("usage_snapshots_subscription_id_idx").on(t.subscriptionId),
  index("usage_snapshots_recorded_at_idx").on(t.recordedAt),
]);

export type UsageSnapshot = typeof usageSnapshotsTable.$inferSelect;
