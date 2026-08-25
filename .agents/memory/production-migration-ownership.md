---
name: Production migration ownership
description: Self-hosted PostgreSQL baseline ownership must match the application role used by release migrations.
---

Production release migrations run through `DATABASE_URL` as the application database role. Fresh-install schema creation must use that same role; creating baseline tables as PostgreSQL's `postgres` role leaves later `ALTER TABLE` migrations unable to run even when grants exist.

**Why:** PostgreSQL table grants do not grant ownership, and a production update stopped at the first migration that altered a baseline table.

**How to apply:** Keep fresh schema creation under the application role. If an existing installation has baseline tables owned by another role, correct ownership once as a database administrator before retrying the release.