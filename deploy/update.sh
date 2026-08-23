#!/usr/bin/env bash
# Safe, fail-stop NetPulse production release updater.
set -euo pipefail

APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
UPDATE_CONFIG="${NETPULSE_UPDATE_CONFIG_FILE:-/etc/netpulse/update.conf}"
LOG_FILE="${NETPULSE_UPDATE_LOG_FILE:-/var/log/netpulse/update.log}"
STATUS_FILE="${NETPULSE_UPDATE_STATUS_FILE:-/var/lib/netpulse/update-status.json}"
BACKUP_DIR="${NETPULSE_BACKUP_DIR:-/var/backups/netpulse}"
LOCK_FILE="${NETPULSE_UPDATE_LOCK_FILE:-/var/lock/netpulse-update.lock}"
RETRY_FAILED_RELEASE=0
if [[ "${1:-}" == "--retry" ]]; then
  RETRY_FAILED_RELEASE=1
  shift
fi
[[ $# -le 1 ]] || { echo "Usage: $0 [--retry] [full-target-commit]" >&2; exit 2; }
TARGET_COMMIT="${1:-}"
[[ "$TARGET_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || {
  echo "A full, confirmed target commit SHA is required." >&2
  exit 2
}
START=$(date +%s)
PREVIOUS_COMMIT=""
BACKUP_PATH=""
CURRENT_PHASE="preflight"
RECOVERY_PREVIOUS_COMMIT=""
RECOVERY_BACKUP_PATH=""

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$STATUS_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf '%s' "$value"
}

write_status() {
  local state="$1" phase="$2" message="$3"
  local tmp="${STATUS_FILE}.tmp.$$"
  umask 022
  cat > "$tmp" <<EOF
{"state":"$(json_escape "$state")","phase":"$(json_escape "$phase")","message":"$(json_escape "$message")","targetCommit":"$(json_escape "$TARGET_COMMIT")","previousCommit":"$(json_escape "$PREVIOUS_COMMIT")","backupPath":"$(json_escape "$BACKUP_PATH")","updatedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
  mv "$tmp" "$STATUS_FILE"
}

die() {
  local message="$*"
  write_status "failed" "$CURRENT_PHASE" "$message"
  echo -e "  ${RED}✗  ${message}${NC}"
  exit 1
}

on_error() {
  local exit_code=$?
  write_status "failed" "$CURRENT_PHASE" "Deployment failed during ${CURRENT_PHASE}. The running application was not restarted."
  exit "$exit_code"
}
trap on_error ERR

[[ $EUID -ne 0 ]] && die "Run this production updater as root."
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
[[ -d "$APP_DIR/.git" ]] || die "Production checkout is missing."
[[ -f "$APP_DIR/.env" ]] || die "Production .env is missing; refusing to continue."
[[ -f "$UPDATE_CONFIG" ]] || die "Root-owned update configuration is missing. Run deploy/setup-ubuntu.sh in upgrade mode as root."
[[ "$(stat -c '%U:%a' "$UPDATE_CONFIG")" == "root:600" ]] || die "Update configuration must be owned by root with mode 600."
command -v flock >/dev/null || die "flock is required for safe deployments."

exec 9>"$LOCK_FILE"
flock -n 9 || die "Another deployment is already running."

cd "$APP_DIR"
set -o allexport; source "$UPDATE_CONFIG"; set +o allexport
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is required for a production update."
if [[ "$RETRY_FAILED_RELEASE" == "1" && -f "$STATUS_FILE" ]]; then
  RECOVERY_PREVIOUS_COMMIT="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(/^[0-9a-f]{40}$/i.test(s.previousCommit || "") ? s.previousCommit : "")' "$STATUS_FILE" 2>/dev/null || true)"
  RECOVERY_BACKUP_PATH="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(typeof s.backupPath === "string" ? s.backupPath : "")' "$STATUS_FILE" 2>/dev/null || true)"
fi

echo ""
echo -e "${BOLD}NetPulse safe release update — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo "──────────────────────────────────────────"

CURRENT_PHASE="preflight"
write_status "preflight" "$CURRENT_PHASE" "Validating the configured production branch."

# Ignored files such as .env are deliberately excluded: they are preserved
# untouched. Any tracked local edit is a reason to stop, never reset it.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  die "Tracked server-local changes were found. Commit or revert them before deploying."
fi

BRANCH="$(git symbolic-ref --quiet --short HEAD)" || die "The production checkout is detached."
REMOTE="$(git config --get "branch.${BRANCH}.remote" || true)"
MERGE_REF="$(git config --get "branch.${BRANCH}.merge" || true)"
REMOTE_BRANCH="${MERGE_REF#refs/heads/}"
[[ -n "$REMOTE" && "$MERGE_REF" == refs/heads/* ]] || die "The deployed checkout does not track a production branch."

git fetch --quiet --no-tags "$REMOTE" "refs/heads/${REMOTE_BRANCH}"
CANDIDATE_COMMIT="$(git rev-parse FETCH_HEAD)"
PREVIOUS_COMMIT="$(git rev-parse HEAD)"

if [[ -n "$TARGET_COMMIT" && "$TARGET_COMMIT" != "$CANDIDATE_COMMIT" ]]; then
  die "The confirmed target is no longer the configured production-branch commit. Check again before deploying."
fi
TARGET_COMMIT="$CANDIDATE_COMMIT"

if [[ "$PREVIOUS_COMMIT" == "$TARGET_COMMIT" && "$RETRY_FAILED_RELEASE" != "1" ]]; then
  write_status "no-update" "complete" "No update is available; production already matches the configured branch."
  warn "Already up to date ($(git rev-parse --short HEAD))"
  exit 0
fi

if [[ "$PREVIOUS_COMMIT" == "$TARGET_COMMIT" ]]; then
  PREVIOUS_COMMIT="${RECOVERY_PREVIOUS_COMMIT:-$PREVIOUS_COMMIT}"
  BACKUP_PATH="$RECOVERY_BACKUP_PATH"
  warn "Retrying the previously failed release without changing the checkout."
else
  git merge-base --is-ancestor "$PREVIOUS_COMMIT" "$TARGET_COMMIT" \
    || die "The configured production branch is not a fast-forward update. Refusing to replace the deployed revision."

  CURRENT_PHASE="backing-up"
  write_status "backing-up" "$CURRENT_PHASE" "Creating a database backup before changing production."
  mkdir -p "$BACKUP_DIR"
  umask 077
  BACKUP_PATH="${BACKUP_DIR}/netpulse-$(date -u +%Y%m%d-%H%M%S)-${PREVIOUS_COMMIT:0:7}.dump"
  pg_dump --format=custom --file="$BACKUP_PATH" --dbname="$DATABASE_URL"
  [[ -s "$BACKUP_PATH" ]] || die "Database backup did not produce a usable file."
  pg_restore --list "$BACKUP_PATH" >/dev/null
  ok "Database backup created before release change"

  CURRENT_PHASE="updating"
  write_status "updating" "$CURRENT_PHASE" "Fast-forwarding the verified production branch."
  git merge --ff-only "$TARGET_COMMIT"
  ok "Updated $(git rev-parse --short "$PREVIOUS_COMMIT") → $(git rev-parse --short "$TARGET_COMMIT")"
fi

CURRENT_PHASE="installing"
write_status "installing" "$CURRENT_PHASE" "Installing locked release dependencies."
for attempt in 1 2 3; do
  CI=true NETPULSE_INSTALL=1 pnpm install --frozen-lockfile && break
  if [[ "$attempt" -eq 3 ]]; then
    die "Dependency installation failed after 3 attempts."
  fi
  warn "Dependency installation attempt $attempt failed; retrying in 15 seconds."
  sleep 15
done

CURRENT_PHASE="building"
write_status "building" "$CURRENT_PHASE" "Building shared libraries, API, and portal before restart."
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/isp-portal run build
ok "Release built successfully"

CURRENT_PHASE="migrating"
write_status "migrating" "$CURRENT_PHASE" "Applying outstanding recorded database migrations."
bash "$APP_DIR/deploy/migrate.sh"
ok "Recorded database migrations completed"

CURRENT_PHASE="restarting"
write_status "restarting" "$CURRENT_PHASE" "Restarting the production PM2 service."
PM2_USER="${NETPULSE_PM2_USER:-root}"
if [[ "$PM2_USER" == "root" ]]; then
  pm2 restart netpulse 2>/dev/null || pm2 start "$APP_DIR/deploy/ecosystem.config.cjs"
  pm2 save --force >/dev/null
else
  sudo -u "$PM2_USER" pm2 restart netpulse 2>/dev/null || sudo -u "$PM2_USER" pm2 start "$APP_DIR/deploy/ecosystem.config.cjs"
  sudo -u "$PM2_USER" pm2 save --force >/dev/null
fi

CURRENT_PHASE="health-check"
write_status "health-check" "$CURRENT_PHASE" "Waiting for the restarted application health check."
sleep 5
curl --fail --silent --show-error --retry 5 --retry-delay 2 "http://localhost:80/api/healthz" -o /dev/null \
  || die "Health check failed after restart. Inspect the update log before attempting another deployment."

ELAPSED=$(( $(date +%s) - START ))
write_status "succeeded" "complete" "Deployment completed and the application health check passed."
ok "Deployment completed in ${ELAPSED}s and health check passed"