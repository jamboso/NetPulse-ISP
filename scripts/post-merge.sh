#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

echo "Syncing to GitHub (Replit is source of truth)..."
PUSH_OUTPUT=$(git push --force github main 2>&1)
PUSH_EXIT=$?

if [ $PUSH_EXIT -eq 0 ]; then
  echo "GitHub sync: OK"
else
  echo "$PUSH_OUTPUT"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "GitHub sync FAILED. One-time fix needed:"
  echo ""
  echo "  1. Go to: https://github.com/settings/tokens"
  echo "  2. Edit your token — add the 'workflow' scope"
  echo "  3. In the Replit Shell, run:"
  echo "     git remote set-url github https://jamboso:<NEW_TOKEN>@github.com/jamboso/NetPulse-ISP.git"
  echo "  4. Then: git push --force github main"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
