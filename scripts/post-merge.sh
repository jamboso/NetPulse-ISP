#!/bin/bash
set -euo pipefail

# Task merges can legitimately add or remove dependencies. Keep the lockfile in
# sync rather than failing the whole reconciliation on an outdated frozen lock.
pnpm install --no-frozen-lockfile
pnpm --filter db push
