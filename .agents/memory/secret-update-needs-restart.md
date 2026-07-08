---
name: Secret updates need a full Repl restart
description: Updating a Replit secret's value doesn't propagate to already-running processes; a full restart of the Repl (not just a workflow) is needed before the new value takes effect.
---

Changing a secret's value in the Secrets UI (or via `requestEnvVar`) updates the platform's stored value immediately, but any process that was already running when the change happened keeps the old value in its environment — this includes the main agent's own shell, and (empirically observed) newly-created project task environments too if they inherit/snapshot rather than freshly boot.

**Why:** Environment variables are injected at process/container start, not hot-reloaded. A "secret saved" confirmation only means the platform's secret store was updated, not that any given running environment has picked it up.

**How to apply:** After a user updates a secret that a currently-running session needs, verify the actual value in use (e.g. `md5sum` the var, or make a real API call) rather than trusting the "saved" confirmation. If it's still stale, ask the user to fully stop and restart the Repl (not just restart a workflow) — that forces a fresh container boot that reads the current secret value. Re-verify with a functional check afterward.

Also watch for duplicate secrets with the same key: a project-level secret (no link icon in the Secrets UI) takes precedence over an account-level "linked" secret (shown with a link icon) of the same name. If both exist, the account-linked one can be a stale leftover — safe to unlink/remove once the project-level one is confirmed correct.

Separately: don't forget that credentials can also be baked into a git remote's URL (e.g. `.git/config`'s `remote.<name>.url` containing an embedded token). Even after the env var secret is fixed, an old token embedded in a remote URL will keep failing until you `git remote set-url` it with the current value.
