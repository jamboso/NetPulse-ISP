#!/usr/bin/env bash
#
# Configure this clone to use the repository-owned hooks. Run with:
#   bash scripts/setup-git-hooks.sh
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this script from inside a Git working tree." >&2
  exit 1
}

hook="$repo_root/.githooks/pre-commit"
if [[ ! -f "$hook" ]]; then
  echo "Expected pre-commit hook is missing: $hook" >&2
  exit 1
fi

chmod u+x "$hook"
git -C "$repo_root" config --local core.hooksPath .githooks

echo "Configured Git hooks for this clone."