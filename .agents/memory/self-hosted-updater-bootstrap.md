---
name: Self-hosted updater bootstrap
description: A newly added privileged deployment helper needs one update pass to fetch the new updater and a retry pass to execute it.
---

When a release introduces a new action inside the production updater itself, the first update is still executing the updater file that was present before `git merge`. The updated script exists on disk afterward, but its newly added install step has not run.

**Why:** Shell scripts do not reload their own source after a fast-forward, so a first pass can deploy app code that expects a helper before that helper is installed.

**How to apply:** Perform the normal verified update to fetch the release, then rerun the now-updated updater with its explicit retry mode and the same confirmed target. Do not replace this with a manual `git reset` or broad sudo configuration.