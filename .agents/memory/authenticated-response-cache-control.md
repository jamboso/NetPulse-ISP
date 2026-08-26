---
name: Authenticated endpoints need private, no-store
description: Why `Cache-Control: public, max-age=N` on per-user/per-tenant JSON API responses causes cross-user data bleed, and the fix.
---

Any Express route that returns per-user or per-tenant data (dashboards, router/device status, customer lists, etc.) must never send `Cache-Control: public, max-age=...`. Use `private, no-store` instead.

**Why:** `public` cache directives are not varied by cookie/session by default. The browser's HTTP cache is shared across all requests to the same origin+URL in that browser profile — it does not know two different logged-in identities used that tab. In this app, staff can "login as" a customer (impersonation); once they do, the browser caches the customer-scoped JSON response for a dashboard/status URL. When staff return to their own admin session and hit the same URL, the browser can serve the stale cached (customer-scoped) response before the max-age expires, which looks exactly like "the customer's data leaked into my admin tab." An in-process server-side cache keyed by companyId (e.g. a status cache) does not protect against this — the vulnerable layer is the HTTP response header the browser itself obeys.

**How to apply:** Audit every `res.setHeader("Cache-Control", ...)` (or equivalent) in authenticated route handlers. Any response gated by `requireAuth`/`companyScope` middleware should be `private, no-store` (or at minimum `private` plus a `Vary` on the session cookie, but `no-store` is simplest and safest for small per-request payloads). Reserve `public, max-age` for genuinely public, unauthenticated, non-tenant-specific data.
