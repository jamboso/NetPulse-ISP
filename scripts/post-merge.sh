#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

echo "Syncing to GitHub (Replit is source of truth)..."
git remote set-url github https://github.com/jamboso/NetPulse-ISP.git 2>/dev/null || true
if git push --force "https://jamboso:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/jamboso/NetPulse-ISP.git" main 2>&1; then
  echo "GitHub sync: OK"
else
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "GitHub sync FAILED (non-fatal — code is safe locally)."
  echo "Ensure GITHUB_PERSONAL_ACCESS_TOKEN is set with repo+workflow scopes."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
