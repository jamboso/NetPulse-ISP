---
name: Cross-tenant leak in aggregate/dashboard routes
description: New aggregate endpoints (dashboards, monitoring overviews) must be individually audited for company_id scoping — resolveCompanyScope middleware does not enforce it automatically.
---

`/api/monitoring/overview` queried `routersTable` (and session-log-derived ONU/flapping stats) with no `companyId` filter, while the sibling `/api/routers` list endpoint correctly scoped by `req.companyId`. Any authenticated user of any company could see every company's routers/status via the monitoring dashboard.

**Why:** `resolveCompanyScope` middleware only *sets* `req.companyId` on the request; it does not auto-filter queries. Each handler must apply `eq(table.companyId, req.companyId)` itself. Aggregate/rollup endpoints (dashboards, monitoring, reports) are the most likely to be missed because they're often written by copying a "load everything" query pattern, and code review tends to focus on CRUD routes.

**How to apply:** When adding or auditing any route that reads from a company-scoped table (routers, customers, subscriptions, invoices, tickets, equipment, ipPools, etc.), grep for `req.companyId` usage in that route file and confirm every `db.select()...from(<scopedTable>)` has a matching `where(eq(table.companyId, req.companyId))` (or explicit `req.companyId != null` bypass for owner/global views). Don't assume scoping is inherited from middleware or from a sibling endpoint in the same router file.
