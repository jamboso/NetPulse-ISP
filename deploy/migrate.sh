#!/usr/bin/env bash
# Ordered production migration runner. deploy/schema.sql is intentionally not
# executed here; it remains the baseline for fresh installations only.
set -euo pipefail

APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
MIGRATIONS_DIR="$APP_DIR/deploy/migrations"
LOCK_FILE="${NETPULSE_MIGRATION_LOCK_FILE:-/var/lock/netpulse-migrate.lock}"

[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is required for migrations." >&2; exit 1; }
[[ -d "$MIGRATIONS_DIR" ]] || { echo "Migration directory is missing." >&2; exit 1; }

exec 8>"$LOCK_FILE"
flock -n 8 || { echo "Another database migration is already running." >&2; exit 1; }

PSQL=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1)
"${PSQL[@]}" <<'SQL'
CREATE TABLE IF NOT EXISTS public.netpulse_schema_migrations (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

mapfile -t migrations < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort)
[[ ${#migrations[@]} -gt 0 ]] || { echo "No production migrations were found." >&2; exit 1; }

for filename in "${migrations[@]}"; do
  [[ "$filename" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]] || {
    echo "Invalid migration filename: $filename" >&2
    exit 1
  }
  migration_id="${filename%.sql}"
  migration_file="$MIGRATIONS_DIR/$filename"
  checksum="$(sha256sum "$migration_file" | awk '{print $1}')"
  recorded="$("${PSQL[@]}" -Atqc "SELECT checksum FROM public.netpulse_schema_migrations WHERE id = '$migration_id'")"

  if [[ -n "$recorded" ]]; then
    [[ "$recorded" == "$checksum" ]] || {
      echo "Migration $migration_id was changed after it was applied." >&2
      exit 1
    }
    echo "Migration $migration_id already applied."
    continue
  fi

  # The baseline is applied exclusively by the fresh installer. Existing
  # installations are recorded against it before deltas are considered.
  if [[ "$migration_id" == "0001_baseline" ]]; then
    has_users="$("${PSQL[@]}" -Atqc "SELECT to_regclass('public.users') IS NOT NULL")"
    [[ "$has_users" == "t" ]] || {
      echo "Fresh baseline is missing. Run deploy/setup-ubuntu.sh for a new installation." >&2
      exit 1
    }
    "${PSQL[@]}" -c "INSERT INTO public.netpulse_schema_migrations (id, checksum) VALUES ('$migration_id', '$checksum')"
    echo "Recorded existing baseline."
    continue
  fi

  {
    echo "BEGIN;"
    cat "$migration_file"
    printf "INSERT INTO public.netpulse_schema_migrations (id, checksum) VALUES ('%s', '%s');\n" "$migration_id" "$checksum"
    echo "COMMIT;"
  } | "${PSQL[@]}"
  echo "Applied migration $migration_id."
done