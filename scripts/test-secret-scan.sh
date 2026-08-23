#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
scanner="$repo_root/scripts/scan-secrets.sh"
test_repo="$(mktemp -d)"
trap 'rm -rf "$test_repo"' EXIT

git -C "$test_repo" init --quiet
git -C "$test_repo" config user.email "secret-scan-test@example.invalid"
git -C "$test_repo" config user.name "Secret Scan Test"

printf 'safe staged content\n' > "$test_repo/safe.txt"
git -C "$test_repo" add safe.txt

(
  cd "$test_repo"
  bash "$scanner" >/dev/null
)

token_prefix="ghp_"
test_token="${token_prefix}$(printf 'a%.0s' {1..36})"

printf 'token=%s\n' "$test_token" > "$test_repo/token.txt"
git -C "$test_repo" add token.txt

if (
  cd "$test_repo"
  bash "$scanner" >/dev/null 2>&1
); then
  echo "Expected scanner to reject a staged GitHub PAT." >&2
  exit 1
fi

git -C "$test_repo" reset --quiet token.txt
git -C "$test_repo" config --local remote.origin.url \
  "https://x-access-token:${test_token}@github.com/example/example.git"

if (
  cd "$test_repo"
  bash "$scanner" >/dev/null 2>&1
); then
  echo "Expected scanner to reject a GitHub PAT in .git/config." >&2
  exit 1
fi

git -C "$test_repo" config --unset remote.origin.url
mkdir -p "$test_repo/.githooks" "$test_repo/scripts"
cp "$repo_root/.githooks/pre-commit" "$test_repo/.githooks/pre-commit"
cp "$scanner" "$test_repo/scripts/scan-secrets.sh"
cp "$repo_root/scripts/setup-git-hooks.sh" "$test_repo/scripts/setup-git-hooks.sh"

(
  cd "$test_repo"
  bash scripts/setup-git-hooks.sh >/dev/null
  git commit --quiet -m "safe commit"
)

git -C "$test_repo" add token.txt
if (
  cd "$test_repo"
  git commit --quiet -m "blocked secret"
); then
  echo "Expected pre-commit hook to reject a staged GitHub PAT." >&2
  exit 1
fi

echo "Secret scanner tests passed."