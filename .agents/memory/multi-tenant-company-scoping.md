---
name: Multi-tenant company scoping pattern (NetPulse)
description: How tenant isolation, owner role, and access enforcement are wired for the ISP reseller SaaS conversion
---

Tenant isolation uses a `companyId` column (not-null, default 1 for legacy rows) on every tenant-owned table, with app-level (not DB-level) integrity — there is no FK-enforced tenant boundary, so any new route touching these tables must remember to scope it.

**Why:** Retrofitting multi-tenancy onto a single-tenant schema without a full migration; DB-level constraints across 8+ tables would have been much higher risk/effort for the same practical isolation, given a trusted-owner threat model (not adversarial tenants).

**How to apply:**
- Every tenant route file installs `router.use(resolveCompanyScope)` and reads `req.companyId` (set by the middleware in `artifacts/api-server/src/middlewares/companyScope.ts`), never `req.user.companyId` directly.
- `resolveCompanyScope` also enforces access: for non-owner roles it loads the company row and returns 402 `COMPANY_SUSPENDED` if `accessStatus === "suspended"` or `accessUntil` has passed, unless `exempt` is true. Owner role bypasses this (optionally scopes via `?companyId=` query param for cross-tenant admin views).
- Company id 1 ("Default Company") is seeded as `exempt: true` and holds all pre-migration data — never suspend it.
- New tenant tables/routes must follow the same `scoped<Entity>Where(req, id)` helper pattern (see `customers.ts`, `invoices.ts`, etc.) — `and(eq(id), eq(companyId))` when `req.companyId != null`, else unscoped (owner-without-param case).
- Owner-only company CRUD lives in `artifacts/api-server/src/routes/companies.ts`, gated by `requireRole("owner")` for the whole router.
