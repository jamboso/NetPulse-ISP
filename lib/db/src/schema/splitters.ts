import { pgTable, serial, text, integer, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";
import { routersTable } from "./routers";

export const splittersTable = pgTable("splitters", {
  id:          serial("id").primaryKey(),
  // Legacy single-tenant rows default to company 1, matching routers/customers/equipment.
  companyId:   integer("company_id").notNull().default(1),
  name:        text("name").notNull(),
  description: text("description"),
  latitude:    doublePrecision("latitude"),
  longitude:   doublePrecision("longitude"),
  routerId:    integer("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  capacity:    integer("capacity").default(8),        // max client ports (4, 8, 16, 32)
  location:    text("location"),                       // human-readable location name
  fiberColor:  text("fiber_color"),                    // cable colour for map overlay
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, t => [
  index("splitters_router_id_idx").on(t.routerId),
  index("splitters_company_id_idx").on(t.companyId),
]);

export type Splitter = typeof splittersTable.$inferSelect;
