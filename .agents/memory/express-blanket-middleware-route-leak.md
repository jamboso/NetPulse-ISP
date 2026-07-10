---
name: Express blanket middleware route leak
description: An unscoped router.use(middleware) inside a sub-router blocks or affects every request that reaches that sub-router, not just its own declared routes — dangerous when sub-routers are mounted early in the chain.
---

Calling `router.use(requireRole("owner"))` (no path argument) at the top of a sub-router, then mounting that sub-router with `mainRouter.use(subRouter)` (also no path), makes the middleware run for **every request that reaches that mount point** — including requests meant for completely unrelated routes registered later in the same Express app. Express doesn't scope `router.use()` to the routes declared in that file; it scopes it to the sub-router instance, and the sub-router sees all traffic that falls through to it in mount order.

**Why:** This caused a real outage: a `companies` router mounted early in `routes/index.ts` with a blanket `requireRole("owner")` silently 403'd every non-owner request that reached it, including `/api/customers` and `/api/sms/*` mounted afterward, because the request had to pass down through the Express middleware stack in mount order.

**How to apply:** Never put role/permission gating in a sub-router via a path-less `router.use(...)`. Apply the middleware per-route instead (`router.get("/x", requireRole("admin"), handler)`), or mount the sub-router under an explicit path prefix (`mainRouter.use("/companies", subRouter)`) so the blanket middleware can't leak beyond it. When auditing routers for this bug, grep for `router.use(requireRole` or `router.use(requireAuth` with no leading path segment.
