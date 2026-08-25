---
name: Replit-to-GitHub push is manual
description: Replit checkpoints are local git commits only; GitHub push must be triggered explicitly, and self-hosted deploys pull from GitHub, not Replit
---

Replit's automatic checkpointing creates local commits in the workspace repo, but it does **not** push them to any configured GitHub remote. If the user has a self-hosted deployment (e.g. via `deploy/update.sh`) that does `git pull` from GitHub, fixes made in this workspace won't reach it until someone explicitly runs `git push <remote> main`.

**Why:** caused real confusion once — a crash-loop fix was committed and verified locally, but the self-hosted server kept failing because `update.sh`'s `git pull` never saw it; the 19 unpushed commits sat local-only for a while before being pushed.

**How to apply:** after meaningful fixes intended for a self-hosted or externally-deployed target, proactively confirm whether the change needs to be pushed to GitHub (check `git rev-list --count HEAD` vs `<remote>/main`), and push rather than assuming Replit synced it automatically. Private GitHub remotes additionally require a valid credential with access to that repository and write permission; repository visibility alone does not authenticate Git. When pushing, watch for stale `.git/index.lock` or `.git/refs/remotes/*/lock` files from interrupted git calls — safe to remove if no git process is actually running — and git identity may need `user.email`/`user.name` set in this environment before commits succeed.
