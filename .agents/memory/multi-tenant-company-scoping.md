---
name: Multi-tenant company scoping pattern (NetPulse)
description: How tenant isolation, owner role, and access enforcement are wired for the ISP reseller SaaS conversion
---

Tenant isolation uses an app-level `companyId` on tenant-owned tables (no DB-level FK tenant boundary). This means every route touching those tables — new or existing — must explicitly scope its queries and validate that any referenced foreign IDs (customer, plan, invoice, etc.) belong to the same company; nothing prevents cross-tenant reads/writes at the schema level.

**Why:** Retrofitting multi-tenancy onto a single-tenant schema without a full migration was chosen over DB-level constraints across many tables, given a trusted-owner threat model. The tradeoff is that isolation is only as strong as each route's discipline — a route that forgets to scope a query or validate a foreign key silently reintroduces a cross-tenant leak or tampering bug.

**How to apply:**
- Any new tenant-scoped route must resolve the effective company from server-side session state (never trust a client-supplied companyId), then both filter reads and validate every foreign-key reference against that company before writing.
- A platform-owner role bypasses tenant scoping entirely; access-suspension/expiry enforcement for tenants must happen in shared middleware, not duplicated per-route, or it's easy to add a route that skips the check.
- On any schema change adding a new tenant table, add a backfill step for pre-existing rows/users rather than assuming a clean migration — accounts that existed before tenant scoping was introduced can otherwise get silently locked out.
