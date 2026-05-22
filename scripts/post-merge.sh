#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

echo "Syncing to GitHub (Replit is source of truth)..."
if git push --force github main 2>&1; then
  echo "GitHub sync: OK"
else
  echo ""
  echo "GitHub sync: FAILED"
  echo "  If the error mentions 'workflow' scope, the GitHub PAT needs the"
  echo "  'workflow' permission. Regenerate the token at:"
  echo "  https://github.com/settings/tokens and update the 'github' remote URL."
  echo "  All code changes were committed locally — nothing is lost."
fi
