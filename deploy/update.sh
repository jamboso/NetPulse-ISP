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
# CI=true prevents pnpm from prompting for TTY confirmation when it needs
# to remove/recreate node_modules (which fails in the detached SSE context).
CI=true pnpm install --frozen-lockfile 2>&1 | tail -3
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
pnpm --filter @workspace/db run push-force
ok "Database schema up to date"

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
