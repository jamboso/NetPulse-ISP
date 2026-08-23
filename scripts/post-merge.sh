#!/bin/bash
set -euo pipefail

# Keep the GitHub remote tokenless. Git requests the current token through the
# repository-scoped credential helper at push time, so rotating the secret does
# not require editing .git/config.
: "${GITHUB_PERSONAL_ACCESS_TOKEN:?GITHUB_PERSONAL_ACCESS_TOKEN must be set for GitHub sync}"
readonly GITHUB_REMOTE_URL="https://github.com/jamboso/NetPulse-ISP.git"
readonly GITHUB_CREDENTIAL_HELPER='!f() { bash "$(git rev-parse --show-toplevel)/scripts/github-credential-helper.sh" "$@"; }; f'

git remote set-url github "$GITHUB_REMOTE_URL"
git config --local credential.https://github.com.helper "$GITHUB_CREDENTIAL_HELPER"

# Task merges can legitimately add or remove dependencies. Keep the lockfile in
# sync rather than failing the whole reconciliation on an outdated frozen lock.
pnpm install --no-frozen-lockfile
pnpm --filter db push
