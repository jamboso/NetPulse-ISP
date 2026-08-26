---
name: Cascade delete transaction safety
description: Rule for any hand-written multi-table delete cascade (not relying purely on DB-level ON DELETE CASCADE).
---

Any endpoint that deletes a row and then hand-deletes its dependents in application code must (1) run the whole cascade inside a single database transaction, and (2) have every table with a foreign key to the row being deleted audited first — not just the tables the feature obviously touches. A dependent table with a non-cascading FK (e.g. `NO ACTION`/`RESTRICT`, or no `onDelete` specified) will throw partway through the cascade, and without a transaction that failure leaves earlier deletes in the cascade already committed — silent partial data loss, not a clean rollback.

**Why:** This exact bug shipped past a full manual test pass and an automated test suite in one task: the missing dependent table only had one row in the dev data used for testing, so the FK violation never fired until code review reasoned about the schema directly. Tests that only exercise the happy path with sparse fixture data won't catch this class of bug.

**How to apply:** Before writing or reviewing a hard-delete cascade, grep the schema for every `references(() => <thisTable>...)` and check each one's `onDelete` behavior. Anything other than `cascade`/`set null` must be cleared explicitly, in the same transaction, before the parent row is deleted. Add a regression test using a dependent row on the non-cascading table specifically, not just the tables already in the happy-path fixture.
