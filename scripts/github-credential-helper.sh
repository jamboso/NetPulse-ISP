#!/usr/bin/env bash
#
# Git invokes this helper whenever it needs credentials for a GitHub HTTPS URL.
# The token stays in the environment and is never written to .git/config.
set -euo pipefail

action="${1:-get}"
protocol=""
host=""

while IFS= read -r line; do
  [[ -z "$line" ]] && break

  case "$line" in
    protocol=*) protocol="${line#protocol=}" ;;
    host=*) host="${line#host=}" ;;
  esac
done

case "$action" in
  get)
    # This repository-level helper is scoped to GitHub, but leave any
    # unexpected credential request for another configured helper.
    if [[ "$protocol" != "https" || "$host" != "github.com" ]]; then
      exit 0
    fi

    if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
      echo "GITHUB_PERSONAL_ACCESS_TOKEN is required to authenticate GitHub pushes." >&2
      exit 1
    fi

    printf 'username=x-access-token\npassword=%s\n\n' "$GITHUB_PERSONAL_ACCESS_TOKEN"
    ;;
  store|erase)
    # Never persist GitHub credentials locally.
    exit 0
    ;;
  *)
    echo "Unsupported Git credential action: $action" >&2
    exit 1
    ;;
esac