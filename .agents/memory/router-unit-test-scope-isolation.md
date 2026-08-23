---
name: Route unit test scope isolation
description: Keep router tests focused by isolating tenancy middleware unless tenant scope is the behavior under test.
---

Router unit tests that verify a route's own authorization or business behavior should mock global tenant-scope middleware rather than recreate tenant setup in every fixture.

**Why:** Tenant resolution runs before every route handler and can hide the behavior being tested behind missing-company failures, making unrelated test failures hard to interpret.

**How to apply:** For local route tests, pass the scope middleware through and explicitly mock every preliminary existence lookup the handler performs. Test tenant isolation separately in dedicated middleware or integration tests.