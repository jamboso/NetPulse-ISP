---
name: Production DB schema drift causes silent-looking data loss
description: Why production API requests can 500 with a missing-column error after a dev schema push, and how it masquerades as "data disappeared"
---

Development schema pushes (`drizzle-kit push` / `pnpm --filter @workspace/db run push`) only affect the dev database. They do not propagate to the production database until the project is Published — Publish diffs dev vs. prod schemas and applies the difference.

If new columns are added to a table in dev (e.g. for a new feature) and the app is published before that point, or a route ships that selects the new columns, production requests to that route fail with a Drizzle/Postgres error like `column "x" does not exist`, which the generic error handler turns into a plain "Internal server error" 500.

**Why:** A user reported "data disappearing" from list pages. The real cause was the frontend silently rendering an empty list on any fetch error (`data?.data ?? []`) instead of surfacing the failure — once error banners were added, the true issue (a production 500 from a schema mismatch) became visible instead of looking like empty tables.

**How to apply:**
- When a production 500 shows a generic "Internal server error" but the same request works fine in dev, suspect schema drift between dev and prod databases before debugging application logic.
- Check `fetch_deployment_logs` for `_DrizzleQueryError` / `column ... does not exist` — that confirms drift.
- Do not attempt manual production DDL fixes (`psql`, `drizzle-kit push` against prod, custom migration scripts) — the `database` skill explicitly prohibits this. The correct fix is to have the user re-run Publish, which reconciles the schema automatically.
- Pair this with defensive frontend error states (don't let fetch failures render as silent empty data) so drift like this is visible immediately instead of looking like lost data.
