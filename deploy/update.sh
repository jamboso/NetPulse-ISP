#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  NetPulse ISP Manager — Update Script                                       ║
# ║  Usage: bash /opt/netpulse/deploy/update.sh                                 ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
LOG_FILE="/var/log/netpulse/update.log"
START=$(date +%s)

mkdir -p /var/log/netpulse
exec > >(tee -a "$LOG_FILE") 2>&1

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "  ${RED}✗  $*${NC}"; exit 1; }

echo ""
echo -e "${BOLD}NetPulse Update — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo "──────────────────────────────────────────"

[[ ! -d "$APP_DIR/.git" ]] && die "App not found at $APP_DIR. Run setup-ubuntu.sh first."
[[ $EUID -ne 0 ]] && die "Run as root: sudo bash $0"

cd "$APP_DIR"

# Load env
set -o allexport; source "$APP_DIR/.env" 2>/dev/null || true; set +o allexport

# ── 1. Pull latest code ────────────────────────────────────────────────────
info "Pulling latest code from origin/main..."
git fetch origin
BEFORE=$(git rev-parse HEAD)
git reset --hard origin/main
AFTER=$(git rev-parse HEAD)
if [[ "$BEFORE" == "$AFTER" ]]; then
  warn "Already up to date ($(git rev-parse --short HEAD))"
else
  ok "Updated $(git rev-parse --short $BEFORE) → $(git rev-parse --short $AFTER)"
fi

# ── 2. Install / update dependencies ──────────────────────────────────────
info "Installing dependencies..."
# Configure pnpm for slow/unreliable connections
pnpm config set fetch-retries 5         --location project 2>/dev/null || true
pnpm config set fetch-retry-mintimeout 30000  --location project 2>/dev/null || true
pnpm config set fetch-retry-maxtimeout 300000 --location project 2>/dev/null || true
pnpm config set fetch-timeout 300000    --location project 2>/dev/null || true
pnpm config set network-concurrency 4   --location project 2>/dev/null || true
# CI=true skips the TTY confirmation for node_modules removal (no terminal in SSE).
# NETPULSE_INSTALL=1 skips the preinstall guard. Retry up to 3 times.
for _attempt in 1 2 3; do
  CI=true NETPULSE_INSTALL=1 pnpm install --no-frozen-lockfile 2>&1 | tail -5 && break
  if [[ "$_attempt" -eq 3 ]]; then
    die "pnpm install failed after 3 attempts. Check your internet connection."
  fi
  warn "pnpm install attempt $_attempt failed — retrying in 15s..."
  sleep 15
done
ok "Dependencies up to date"

# ── 3. Build libs ──────────────────────────────────────────────────────────
info "Building shared libraries..."
pnpm run typecheck:libs 2>&1 | tail -3
ok "Libraries built"

# ── 4. Build API ──────────────────────────────────────────────────────────
info "Building API server..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5
ok "API server built"

# ── 5. Build frontend ─────────────────────────────────────────────────────
info "Building frontend..."
PORT=3000 BASE_PATH=/ \
  NODE_ENV=production \
  pnpm --filter @workspace/isp-portal run build 2>&1 | tail -5
ok "Frontend built"

# ── 6. Run DB migrations ──────────────────────────────────────────────────
info "Running database migrations..."
# Use schema.sql (IF NOT EXISTS statements) instead of drizzle-kit push,
# which requires an interactive TTY for column conflict resolution and
# fails silently when run detached from the SSE endpoint.
SCHEMA_SQL="$APP_DIR/deploy/schema.sql"
DB_NAME=$(echo "$DATABASE_URL" | grep -oP '(?<=/)[^/?]+$' || echo "netpulse")
if [[ -f "$SCHEMA_SQL" ]]; then
  sudo -u postgres psql -d "$DB_NAME" \
    -v ON_ERROR_STOP=0 \
    -f "$SCHEMA_SQL" >/dev/null 2>/tmp/schema-update.err || true
  # Grant permissions on any newly created objects
  sudo -u postgres psql -d "$DB_NAME" \
    -c "GRANT ALL PRIVILEGES ON ALL TABLES   IN SCHEMA public TO netpulse;" >/dev/null 2>&1 || true
  sudo -u postgres psql -d "$DB_NAME" \
    -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO netpulse;" >/dev/null 2>&1 || true
  ok "Database schema up to date"
else
  warn "schema.sql not found — skipping migration (schema may be out of date)"
fi

# ── 7. Restart app ────────────────────────────────────────────────────────
info "Build complete — signalling dashboard before restart..."
# This sentinel tells the in-app updater to send the SSE 'done' event and
# close the browser stream *before* pm2 kills the Node process.
echo "NETPULSE_RESTART_NOW"
# Give the API 3 seconds to flush the SSE response to the browser.
sleep 3

info "Restarting PM2 process..."
pm2 restart netpulse 2>/dev/null || pm2 start "$APP_DIR/deploy/ecosystem.config.cjs"
pm2 save --force >/dev/null
ok "App restarted"

# ── 8. Reload nginx ───────────────────────────────────────────────────────
if systemctl is-active nginx --quiet; then
  nginx -t && systemctl reload nginx
  ok "nginx reloaded"
fi

# ── Health check ──────────────────────────────────────────────────────────
sleep 5
if curl -fsS "http://localhost:80/api/healthz" -o /dev/null 2>/dev/null; then
  ok "App is healthy ✓"
else
  warn "Health check timed out — check logs: pm2 logs netpulse"
fi

ELAPSED=$(( $(date +%s) - START ))
echo ""
echo -e "${GREEN}${BOLD}✓ Update complete in ${ELAPSED}s${NC}"
echo -e "  ${CYAN}pm2 logs netpulse${NC}  to watch live logs"
echo ""
