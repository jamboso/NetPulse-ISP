#!/usr/bin/env bash
#
# Scan content about to be committed, plus the local Git config. Do not print
# matching values: a scanner must not turn a possible secret into terminal
# output or CI logs.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

declare -a PATTERNS=(
  "GitHub personal access token|gh[pousr]_[A-Za-z0-9_]{36,255}"
  "GitHub fine-grained personal access token|github_pat_[A-Za-z0-9_]{20,255}"
  "GitLab personal access token|glpat-[A-Za-z0-9_-]{20,255}"
  "AWS access key ID|A(KIA|SIA)[0-9A-Z]{16}"
  "private key|-----BEGIN [A-Z ]*PRIVATE KEY-----"
)

found=0

report_match() {
  local secret_type="$1"
  local location="$2"

  printf 'Secret scan blocked the commit: possible %s in %s.\n' \
    "$secret_type" "$location" >&2
  found=1
}

scan_file() {
  local file_path="$1"
  local location="$2"
  local entry secret_type pattern

  for entry in "${PATTERNS[@]}"; do
    secret_type="${entry%%|*}"
    pattern="${entry#*|}"

    if LC_ALL=C grep -aEq -- "$pattern" "$file_path"; then
      report_match "$secret_type" "$location"
    fi
  done
}

scan_staged_file() {
  local path="$1"
  local entry secret_type pattern

  # Verify the index entry exists before reading it. The hook only considers
  # files Git will add, copy, modify, or rename in this commit.
  git cat-file -e ":$path" || {
    printf 'Secret scan could not read staged file: %s\n' "$path" >&2
    exit 2
  }

  for entry in "${PATTERNS[@]}"; do
    secret_type="${entry%%|*}"
    pattern="${entry#*|}"

    if LC_ALL=C grep -aEq -- "$pattern" < <(git show ":$path"); then
      report_match "$secret_type" "staged file: $path"
    fi
  done
}

while IFS= read -r -d '' path; do
  scan_staged_file "$path"
done < <(git diff --cached --name-only --diff-filter=ACMR -z)

git_config="$(git rev-parse --absolute-git-dir)/config"
if [[ -f "$git_config" ]]; then
  scan_file "$git_config" ".git/config"
fi

if ((found)); then
  cat >&2 <<'MESSAGE'
Remove the credential from the staged content or local Git configuration,
rotate it if it is real, then try the commit again. Never bypass this check
with --no-verify.
MESSAGE
  exit 1
fi

printf 'Secret scan passed.\n'