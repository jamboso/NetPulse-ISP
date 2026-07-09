---
name: better-auth password hashing helper
description: How to hash/verify passwords outside better-auth's own sign-in/reset flows (e.g. custom OTP-based reset) while staying compatible with its stored format.
---

When a custom flow (e.g. SMS OTP password reset) needs to write a new password directly into the `accounts` table, do not hand-roll the scrypt hashing — import `hashPassword` (and `verifyPassword`) from the `better-auth/crypto` subpath export.

**Why:** This is the exact same implementation better-auth uses internally for email/password auth, so the resulting hash is guaranteed to match the format `accountsTable.password` expects and will verify correctly on subsequent logins. Reimplementing it manually risks subtle incompatibilities with the `hex-salt:hex-hash` format.

**How to apply:** For any server-side code that writes a new password outside of better-auth's built-in `auth.api.*` methods (custom reset-via-SMS, admin "set password" tools, etc.), use `hashPassword` from `better-auth/crypto` before writing to the accounts table. Use `auth.api.requestPasswordReset` (not `forgetPassword`, which doesn't exist in v1.6.x) for the standard email-link reset path.
