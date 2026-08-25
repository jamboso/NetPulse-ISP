---
name: Self-hosted update dirty-checkout recovery
description: Safely recover a production checkout whose local edits block the fail-stop updater.
---

When the self-hosted updater refuses a dirty working tree, archive the tracked diff and untracked files, then restore the working tree to its current `HEAD` rather than resetting it to the remote branch.

**Why:** The updater must still see the committed release as an incoming fast-forward so it performs the full dependency, build, migration, restart, and health-check sequence. Resetting directly to the remote makes it think there is no update and skips that sequence.

**How to apply:** Back up first, use Git restore and clean only after approval, preserve `.env` and database data, verify the tree is clean, then use the owner Updates page to check and deploy the currently tracked GitHub candidate.