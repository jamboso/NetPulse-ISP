---
name: Better Auth password-change hooks
description: Error and response semantics that matter when enforcing password-change policy in Better Auth hooks.
---

Better Auth exposes an endpoint failure to its `after` hooks as an API error whose application code is under `result.body.code`, not necessarily `result.code`. Treat only the documented `{ token, user }` change-password response as success; do not reset security state or mirror credentials for any other outcome.

**Why:** Misclassifying an API error as a success can clear a lockout counter and synchronize a submitted password to an external credential store even though Better Auth rejected the password change.

**How to apply:** When an after hook needs to replace an endpoint error (for example, turning the threshold failure into a rate-limit response), return an object holding a concrete `Response`. Better Auth otherwise preserves the original endpoint status while replacing only the response payload.