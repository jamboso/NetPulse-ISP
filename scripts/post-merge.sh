#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

echo "Syncing to GitHub (Replit is source of truth)..."
if git push --force github main 2>&1; then
  echo "GitHub sync: OK"
else
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "GitHub sync FAILED (non-fatal — code is safe locally)."
  echo "One-time fix: add 'workflow' scope to your GitHub PAT:"
  echo "  1. https://github.com/settings/tokens → edit token → add 'workflow'"
  echo "  2. git remote set-url github https://jamboso:<TOKEN>@github.com/jamboso/NetPulse-ISP.git"
  echo "  3. git push --force github main"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
