#!/usr/bin/env bash
# Applies ordered NetPulse production migrations exactly once.
set -euo pipefail

APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
MIGRATIONS_DIR="$APP_DIR/deploy/migrations"

[[ -d "$MIGRATIONS_DIR" ]] || { echo "Migration directory is missing: $MIGRATIONS_DIR" >&2; exit 1; }
set -o allexport
source "$APP_DIR/.env" 2>/dev/null || true
set +o allexport
[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is required for migrations." >&2; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS netpulse_schema_migrations (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

shopt -s nullglob
for file in "$MIGRATIONS_DIR"/[0-9][0-9][0-9]_*.sql; do
  id=$(basename "$file")
  [[ "$id" =~ ^[0-9]{3}_[A-Za-z0-9._-]+\.sql$ ]] || {
    echo "Invalid migration filename: $id" >&2
    exit 1
  }
  checksum=$(sha256sum "$file" | awk '{print $1}')
  stored=$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 \
    -c "SELECT checksum FROM netpulse_schema_migrations WHERE id = '$id'")

  if [[ -n "$stored" ]]; then
    [[ "$stored" == "$checksum" ]] || {
      echo "Migration checksum changed after application: $id" >&2
      exit 1
    }
    echo "  ✓ $id already applied"
    continue
  fi

  echo "  → Applying $id"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\i '$file'
INSERT INTO netpulse_schema_migrations (id, checksum)
VALUES ('$id', '$checksum');
COMMIT;
SQL
  echo "  ✓ $id applied"
done