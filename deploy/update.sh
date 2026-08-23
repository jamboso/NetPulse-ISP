#!/usr/bin/env bash
# Safe, owner-triggered NetPulse production updater.
set -euo pipefail

APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
LOG_FILE="/var/log/netpulse/update.log"
BACKUP_ROOT="${NETPULSE_BACKUP_DIR:-/root/netpulse-release-backups}"
STATUS_FILE="${NETPULSE_UPDATE_STATUS_FILE:-/var/lib/netpulse/update-status.json}"
START=$(date +%s)
CURRENT_PHASE="preflight"
BEFORE=""
TARGET=""
BACKUP_DIR=""
UPDATE_STARTED_AT=$(date +%s)

mkdir -p /var/log/netpulse
exec > >(tee -a "$LOG_FILE") 2>&1

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
write_status() {
  local state="$1"
  install -d -m 700 "$(dirname "$STATUS_FILE")"
  umask 077
  printf '{"state":"%s","phase":"%s","targetCommit":"%s","previousCommit":"%s","backupDir":"%s","pid":%s,"startedAt":%s,"updatedAt":"%s"}\n' \
    "$state" "$CURRENT_PHASE" "$TARGET" "$BEFORE" "$BACKUP_DIR" "$$" "$UPDATE_STARTED_AT" "$(date -Iseconds)" \
    > "${STATUS_FILE}.tmp.$$"
  mv "${STATUS_FILE}.tmp.$$" "$STATUS_FILE"
}
die()  {
  write_status "failed"
  echo -e "  ${RED}✗${NC}  $*" >&2
  exit 1
}
on_error() {
  local exit_code=$?
  trap - ERR
  write_status "failed"
  echo -e "  ${RED}✗${NC}  Update stopped during $CURRENT_PHASE. The running app was not restarted." >&2
  exit "$exit_code"
}

require_safe_name() {
  [[ "$1" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Invalid Git remote or branch name."
}

resolve_remote() {
  local upstream candidate
  if [[ -n "${NETPULSE_UPDATE_REMOTE:-}" ]]; then
    require_safe_name "$NETPULSE_UPDATE_REMOTE"
    git remote get-url "$NETPULSE_UPDATE_REMOTE" >/dev/null 2>&1 \
      || die "Configured Git remote '$NETPULSE_UPDATE_REMOTE' does not exist."
    printf '%s' "$NETPULSE_UPDATE_REMOTE"
    return
  fi

  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
  if [[ "$upstream" == */* ]]; then
    candidate="${upstream%%/*}"
    if git remote get-url "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return
    fi
  fi

  for candidate in origin github; do
    if git remote get-url "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return
    fi
  done
  die "No Git remote is configured for production updates."
}

echo ""
echo -e "${BOLD}NetPulse Update — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo "──────────────────────────────────────────"

[[ -d "$APP_DIR/.git" ]] || die "App checkout not found at $APP_DIR."
[[ $EUID -eq 0 ]] || die "Run as root so the root-owned PM2 process is updated."
cd "$APP_DIR"
exec 9>/var/lock/netpulse-update.lock
if ! flock -n 9; then
  echo -e "  ${RED}✗${NC}  Another NetPulse update is already in progress." >&2
  exit 1
fi
trap on_error ERR

set -o allexport
source "$APP_DIR/.env" 2>/dev/null || true
set +o allexport
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is missing from $APP_DIR/.env."

BRANCH="${NETPULSE_UPDATE_BRANCH:-$(git branch --show-current)}"
require_safe_name "$BRANCH"
REMOTE=$(resolve_remote)

if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Tracked server-local code changes were found. Refusing to overwrite them; resolve them before updating."
fi

CURRENT_PHASE="fetching release"
info "Fetching approved release from $REMOTE/$BRANCH..."
git fetch --prune "$REMOTE" "refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
BEFORE=$(git rev-parse HEAD)
TARGET=$(git rev-parse "$REMOTE/$BRANCH")

if [[ -n "${NETPULSE_EXPECTED_COMMIT:-}" && "$TARGET" != "$NETPULSE_EXPECTED_COMMIT" ]]; then
  die "The release changed after confirmation. Check for updates again before deploying."
fi
if [[ "$BEFORE" == "$TARGET" ]] \
  && [[ -f "$STATUS_FILE" ]] \
  && grep -Fq "\"state\":\"success\"" "$STATUS_FILE" \
  && grep -Fq "\"targetCommit\":\"$TARGET\"" "$STATUS_FILE"; then
  write_status "success"
  warn "Already successfully deployed ($(git rev-parse --short HEAD)); no changes were made."
  trap - ERR
  exit 0
fi
write_status "running"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
install -d -m 700 "$BACKUP_DIR"

CURRENT_PHASE="database backup"
write_status "running"
info "Backing up the production database..."
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$BACKUP_DIR/database-before-update.dump"
printf '%s\n' "$BEFORE" > "$BACKUP_DIR/previous-commit.txt"
printf '%s\n' "$TARGET" > "$BACKUP_DIR/target-commit.txt"
git update-ref "refs/netpulse/backups/$STAMP" "$BEFORE"
ok "Backup created at $BACKUP_DIR"

if [[ "$BEFORE" != "$TARGET" ]]; then
  CURRENT_PHASE="updating code"
  write_status "running"
  info "Fast-forwarding code to $(git rev-parse --short "$TARGET")..."
  git merge --ff-only "$TARGET"
  ok "Updated $(git rev-parse --short "$BEFORE") → $(git rev-parse --short HEAD)"
else
  warn "Re-running the incomplete deployment for $(git rev-parse --short HEAD)."
fi

CURRENT_PHASE="installing dependencies"
write_status "running"
info "Installing dependencies..."
for attempt in 1 2 3; do
  if CI=true NETPULSE_INSTALL=1 pnpm install --frozen-lockfile 2>&1 | tail -5; then
    break
  fi
  [[ "$attempt" -eq 3 ]] && die "pnpm install failed after three attempts."
  warn "Install attempt $attempt failed — retrying in 15 seconds..."
  sleep 15
done
ok "Dependencies installed"

CURRENT_PHASE="building application"
write_status "running"
info "Building shared libraries..."
pnpm run typecheck:libs 2>&1 | tail -5
info "Building API server..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5
info "Building frontend..."
PORT=3000 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/isp-portal run build 2>&1 | tail -5
ok "Build completed"

CURRENT_PHASE="applying database migrations"
write_status "running"
info "Applying recorded database migrations..."
bash "$APP_DIR/deploy/migrate.sh"
ok "Database migrations completed"

CURRENT_PHASE="restarting application"
write_status "running"
info "Build and migration complete — signalling dashboard before restart..."
echo "NETPULSE_RESTART_NOW"
sleep 3

# The API process owns the live-update SSE pipe and will be replaced by PM2.
# From this point on, write only to the persistent log so the detached updater
# can always record its final health result in STATUS_FILE.
exec >>"$LOG_FILE" 2>&1

info "Restarting root-owned PM2 process..."
pm2 restart netpulse
pm2 save --force >/dev/null

PORT="${PORT:-8080}"
sleep 5
CURRENT_PHASE="verifying health"
write_status "running"
if curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/healthz" >/dev/null; then
  ok "App is healthy"
else
  die "Health check failed after restart. Previous code ref: $BEFORE; database backup: $BACKUP_DIR"
fi

ELAPSED=$(( $(date +%s) - START ))
CURRENT_PHASE="completed"
write_status "success"
trap - ERR
echo ""
echo -e "${GREEN}${BOLD}✓ Update complete in ${ELAPSED}s${NC}"