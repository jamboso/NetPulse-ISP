#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

echo "Syncing to GitHub (Replit is source of truth)..."
git push --force github main && echo "GitHub sync: OK" || echo "GitHub sync: FAILED — check GITHUB_TOKEN secret"
