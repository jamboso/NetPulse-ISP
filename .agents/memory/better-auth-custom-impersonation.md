---
name: Owner impersonation without the official admin plugin
description: How "login as" / impersonate-user was added without better-auth's admin plugin, and why — relevant for any future admin/impersonation/session-creation feature.
---

Needed an owner-only "log in as this SaaS client" button. Did NOT use better-auth's official `admin` plugin, because it requires additional schema columns (`banned`/`banReason`/`banExpires` on users, `impersonatedBy` on sessions) and its own admin-role/permission system, which would have collided with this app's existing `owner/admin/billing/support/technician` role column.

**Why this matters:** instead wrote a tiny custom better-auth plugin (`createAuthEndpoint` + `sessionMiddleware` + `setSessionCookie`, all public exports from `better-auth/api` and `better-auth/cookies`) exposing one endpoint that checks `ctx.context.session.user.role === "owner"` and calls `ctx.context.internalAdapter.createSession(targetUserId, false)`. No new schema columns needed. This is a supported extension pattern (plugins get full `ctx.context` access), safer than hand-rolling cookie signing from outside better-auth.

**How to apply:** Confirmed working detail — better-auth's main `session_token` cookie is HMAC-signed via `ctx.setSignedCookie`, not a raw token; don't try to craft it manually outside of a plugin/endpoint context. Also: after changing a user's `role` directly via SQL, their existing session's cookie-cache (5 min TTL) still serves stale role data — sign out/in (or wait for cache expiry) before testing role-gated behavior.
