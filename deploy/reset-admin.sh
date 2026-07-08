#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  NetPulse ISP Manager — Admin Account Reset                                  ║
# ║  Use when you're locked out or set the wrong password during setup.           ║
# ║                                                                              ║
# ║  Usage: sudo bash /opt/netpulse/deploy/reset-admin.sh                        ║
# ║                                                                              ║
# ║  What it does:                                                               ║
# ║    1. Removes all user accounts, sessions, and accounts from the database    ║
# ║    2. Clears the setupComplete flag                                           ║
# ║    3. You then visit http://<your-server-ip> and run the setup wizard again  ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
DB_NAME="${NETPULSE_DB_NAME:-netpulse}"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "  ${RED}✗  $*${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo bash $0"

echo ""
echo -e "${BOLD}NetPulse Admin Reset — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo "──────────────────────────────────────────"
echo ""
warn "This will DELETE all admin accounts and let you create a new one."
echo ""
read -r -p "  Are you sure? Type YES to continue: " confirm
[[ "$confirm" != "YES" ]] && { echo "  Aborted."; exit 0; }
echo ""

info "Clearing sessions..."
sudo -u postgres psql -d "$DB_NAME" -c "DELETE FROM sessions;" >/dev/null
ok "Sessions cleared"

info "Clearing accounts (password hashes)..."
sudo -u postgres psql -d "$DB_NAME" -c "DELETE FROM accounts;" >/dev/null
ok "Accounts cleared"

info "Clearing users..."
sudo -u postgres psql -d "$DB_NAME" -c "DELETE FROM users;" >/dev/null
ok "Users cleared"

info "Clearing verifications..."
sudo -u postgres psql -d "$DB_NAME" -c "DELETE FROM verifications;" >/dev/null 2>&1 || true
ok "Verifications cleared"

info "Resetting setup wizard flag..."
sudo -u postgres psql -d "$DB_NAME" \
  -c "UPDATE settings SET value = '0' WHERE key = 'setupComplete';" >/dev/null
# In case the row doesn't exist yet
sudo -u postgres psql -d "$DB_NAME" \
  -c "DELETE FROM settings WHERE key = 'setupComplete';" >/dev/null
ok "Setup flag reset"

echo ""
echo -e "${GREEN}${BOLD}✓ Reset complete!${NC}"
echo ""
echo -e "  Next step: open your browser and go to:"
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "  ${CYAN}http://${SERVER_IP}${NC}"
echo ""
echo -e "  The setup wizard will appear. Create your admin account with a"
echo -e "  password you'll remember, then log in."
echo ""
