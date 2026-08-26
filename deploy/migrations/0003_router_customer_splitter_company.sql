-- Owner network-tools scoping (task #223):
--   * routers.customer_id — optional link from a router to the customer who
--     owns it. Historic rows stay NULL ("unassigned") until a staff member
--     explicitly assigns them.
--   * splitters.company_id — tenant scope for splitter/map records, matching
--     routers/customers/equipment.

ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "customer_id" integer;
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "routers" ADD CONSTRAINT "routers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routers_customer_id_idx" ON "routers" ("customer_id");
--> statement-breakpoint
-- Default to company 1 first (matches how every other pre-multi-tenant table
-- in this schema — customers, routers, equipment, ip_pools, etc. — was
-- backfilled: company 1 is the original single-tenant install).
ALTER TABLE "splitters" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
-- A splitter attached to a router (the common case) must inherit that
-- router's *actual* company, not the blanket default above — routers created
-- after multi-tenancy went live can already belong to a company other than
-- 1, and leaving the splitter on company 1 would hide it from its real
-- tenant while exposing it to company 1. Only orphan splitters (no router)
-- keep the company-1 default, consistent with the rest of this migration.
UPDATE "splitters" AS s
SET "company_id" = r."company_id"
FROM "routers" AS r
WHERE s."router_id" = r."id"
  AND s."company_id" IS DISTINCT FROM r."company_id";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "splitters_company_id_idx" ON "splitters" ("company_id");
