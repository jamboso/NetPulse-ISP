---
name: Company-scope route test mocking
description: Adding fail-closed tenant scoping to a route silently invalidates its existing tests.
---

When a route is changed to fail closed on missing tenant/company scope (return empty/403 instead of all rows), every pre-existing test for that route must be re-audited: tests that previously got real data back now need scope granted explicitly, and a companion test should assert the old "no scope selected" case now returns empty/`403` instead of leaking cross-tenant data.

**Why:** These test breakages look like unrelated regressions in a full suite run unless you recognize the scoping change is the cause — easy to misdiagnose and waste time on.

**How to apply:** Whenever fail-closed scoping is added to a route, grep its test file(s) for calls that assumed unscoped success, update them to supply scope, and add a explicit no-scope-selected regression test.
