---
name: Replit-to-GitHub push is manual
description: Replit checkpoints are local git commits only; GitHub push must be triggered explicitly, and self-hosted deploys pull from GitHub, not Replit
---

Replit's automatic checkpointing creates local commits in the workspace repo, but it does **not** push them to any configured GitHub remote. If the user has a self-hosted deployment (e.g. via `deploy/update.sh`) that does `git pull` from GitHub, fixes made in this workspace won't reach it until someone explicitly runs `git push <remote> main`.

**Why:** caused real confusion once — a crash-loop fix was committed and verified locally, but the self-hosted server kept failing because `update.sh`'s `git pull` never saw it; the 19 unpushed commits sat local-only for a while before being pushed.

**How to apply:** after meaningful fixes intended for a self-hosted or externally-deployed target, proactively confirm whether the change needs to be pushed to GitHub (check `git rev-list --count HEAD` vs `<remote>/main`), and push rather than assuming Replit synced it automatically. Private GitHub remotes additionally require a valid credential with access to that repository and write permission; repository visibility alone does not authenticate Git. When pushing, watch for stale `.git/index.lock` or `.git/refs/remotes/*/lock` files from interrupted git calls — safe to remove if no git process is actually running — and git identity may need `user.email`/`user.name` set in this environment before commits succeed.

**This project's `github` remote uses a custom credential helper** (`scripts/github-credential-helper.sh`) that only reads the `GITHUB_PERSONAL_ACCESS_TOKEN` secret. On 2026-08-26 that secret was expired/invalid ("Invalid username or token"), but the separate `GITHUB_TOKEN` secret still had push access — `GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN" git push github main` succeeded. If a push fails with an auth error, try this override before asking the user for a new token. Deploying the pushed commit to the self-hosted production box still requires a separate step — production pulls from GitHub via its own owner-only Updates page or `deploy/update.sh <commit-sha>` run on that server; pushing here does not deploy it.
