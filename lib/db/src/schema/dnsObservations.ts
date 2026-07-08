import {
  pgTable, serial, integer, text, date, timestamp,
  index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { routersTable } from "./routers";

export const dnsObservationsTable = pgTable("dns_observations", {
  id:           serial("id").primaryKey(),
  routerId:     integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  domain:       text("domain").notNull(),
  category:     text("category").notNull().default("other"),
  hitCount:     integer("hit_count").notNull().default(1),
  recordedDate: date("recorded_date").notNull(),
  lastSeen:     timestamp("last_seen").defaultNow().notNull(),
}, t => [
  index("dns_obs_router_date_idx").on(t.routerId, t.recordedDate),
  index("dns_obs_domain_idx").on(t.domain),
  index("dns_obs_category_idx").on(t.category),
  uniqueIndex("dns_obs_unique_idx").on(t.routerId, t.domain, t.recordedDate),
]);

export type DnsObservation = typeof dnsObservationsTable.$inferSelect;
