#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  ███╗   ██╗███████╗████████╗██████╗ ██╗   ██╗██╗     ███████╗███████╗      ║
# ║  ████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║   ██║██║     ██╔════╝██╔════╝      ║
# ║  ██╔██╗ ██║█████╗     ██║   ██████╔╝██║   ██║██║     ███████╗█████╗        ║
# ║  ██║╚██╗██║██╔══╝     ██║   ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝        ║
# ║  ██║ ╚████║███████╗   ██║   ██║     ╚██████╔╝███████╗███████║███████╗      ║
# ║  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝      ║
# ║                          ISP Management System                              ║
# ║               https://github.com/jamboso/NetPulse-ISP                       ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#
#  USAGE (one command, nothing else needed):
#    curl -fsSL https://raw.githubusercontent.com/jamboso/NetPulse-ISP/main/deploy/setup-ubuntu.sh | sudo bash
#  OR with a custom repo URL:
#    sudo bash setup-ubuntu.sh https://github.com/jamboso/NetPulse-ISP.git
#
#  Tested: Ubuntu 22.04 LTS, 24.04 LTS
#  Takes:  ~5-8 minutes on a fresh server
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config (override with env vars if needed) ─────────────────────────────────
REPO_URL="${NETPULSE_REPO:-${1:-https://github.com/jamboso/NetPulse-ISP.git}}"
APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
DB_NAME="${NETPULSE_DB:-netpulse}"
DB_USER="${NETPULSE_DB_USER:-netpulse}"
APP_PORT="${NETPULSE_PORT:-8080}"
LOG_FILE="/var/log/netpulse/install.log"
START_TIME=$(date +%s)

# ── Colours ───────────────────────────────────────────────────────────────────
BOLD='\033[1m';    DIM='\033[2m'
RED='\033[0;31m';  GREEN='\033[0;32m';  YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m';   PURPLE='\033[0;35m'; NC='\033[0m'

# ── Logging ───────────────────────────────────────────────────────────────────
mkdir -p /var/log/netpulse
exec > >(tee -a "$LOG_FILE") 2>&1

STEP=0; TOTAL=9
step() {
  STEP=$((STEP+1))
  local elapsed=$(( $(date +%s) - START_TIME ))
  echo ""
  echo -e "${BLUE}${BOLD}┌─────────────────────────────────────────────────────${NC}"
  echo -e "${BLUE}${BOLD}│ [${STEP}/${TOTAL}] $*${NC}  ${DIM}(${elapsed}s elapsed)${NC}"
  echo -e "${BLUE}${BOLD}└─────────────────────────────────────────────────────${NC}"
}
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
die()  {
  echo ""
  echo -e "${RED}${BOLD}╔══ INSTALLATION FAILED ══════════════════════════════${NC}"
  echo -e "${RED}║  $*${NC}"
  echo -e "${RED}║  Full log: $LOG_FILE${NC}"
  echo -e "${RED}╚════════════════════════════════════════════════════${NC}"
  exit 1
}

trap 'die "Unexpected error on line $LINENO. Last command: $BASH_COMMAND"' ERR

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root:  sudo bash $0"

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo ""
echo -e "${CYAN}${BOLD}"
cat << 'BANNER'
  ███╗   ██╗███████╗████████╗██████╗ ██╗   ██╗██╗     ███████╗███████╗
  ████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║   ██║██║     ██╔════╝██╔════╝
  ██╔██╗ ██║█████╗     ██║   ██████╔╝██║   ██║██║     ███████╗█████╗
  ██║╚██╗██║██╔══╝     ██║   ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝
  ██║ ╚████║███████╗   ██║   ██║      ╚████╔╝ ███████╗███████║███████╗
  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝       ╚═══╝  ╚══════╝╚══════╝╚══════╝
BANNER
echo -e "${NC}"
echo -e "  ${BOLD}ISP Management System — Production Installer${NC}"
echo -e "  ${DIM}Log: $LOG_FILE${NC}"
echo ""
echo -e "  ${GREEN}●${NC} ${DIM}This script installs everything automatically.${NC}"
echo -e "  ${GREEN}●${NC} ${DIM}No external API keys needed — auth runs on your server.${NC}"
echo ""
sleep 1

# ─────────────────────────────────────────────────────────────────────────────
step "Pre-flight checks"
# ─────────────────────────────────────────────────────────────────────────────

# OS check
if [[ -f /etc/os-release ]]; then
  source /etc/os-release
  info "OS: $PRETTY_NAME"
  if [[ "$ID" != "ubuntu" ]]; then
    warn "This installer is optimised for Ubuntu. Other Debian systems may work."
  fi
  VER_NUM="${VERSION_ID%%.*}"
  if [[ $VER_NUM -lt 20 ]]; then
    die "Ubuntu 20.04+ required (found $VERSION_ID)"
  fi
  ok "Ubuntu $VERSION_ID supported"
fi

# RAM check
RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
RAM_MB=$((RAM_KB/1024))
if [[ $RAM_MB -lt 900 ]]; then
  warn "Only ${RAM_MB}MB RAM detected. 1GB+ recommended for smooth operation."
else
  ok "${RAM_MB}MB RAM available"
fi

# Disk check
DISK_FREE_GB=$(df -BG / | awk 'NR==2{print $4}' | tr -d 'G')
if [[ $DISK_FREE_GB -lt 5 ]]; then
  die "Only ${DISK_FREE_GB}GB disk space free. Need at least 5GB."
fi
ok "${DISK_FREE_GB}GB disk space free"

# Internet check
if curl -fsS --max-time 5 https://1.1.1.1 -o /dev/null; then
  ok "Internet connectivity confirmed"
else
  die "No internet connection. This installer requires internet access."
fi

# Upgrade vs fresh install detection
if [[ -d "$APP_DIR/.git" ]]; then
  UPGRADE=true
  warn "Existing NetPulse installation detected at $APP_DIR"
  info "Running upgrade mode instead of fresh install..."
  echo ""
  read -rp "  Upgrade existing installation? [Y/n]: " _confirm
  _confirm="${_confirm:-Y}"
  [[ "$_confirm" =~ ^[Yy]$ ]] || die "Upgrade cancelled."
else
  UPGRADE=false
  ok "Fresh installation — no existing install detected"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Installing system packages"
# ─────────────────────────────────────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
info "Updating package lists..."
apt-get update -qq

info "Installing: git, nginx, postgresql, openssl, curl, ufw..."
apt-get install -y -qq \
  git nginx postgresql postgresql-contrib \
  openssl curl wget ca-certificates gnupg \
  software-properties-common ufw
ok "System packages installed"

# ─────────────────────────────────────────────────────────────────────────────
step "Installing Node.js 24"
# ─────────────────────────────────────────────────────────────────────────────
if command -v node &>/dev/null && node -e "process.exit(parseInt(process.version.slice(1)) >= 24 ? 0 : 1)" 2>/dev/null; then
  ok "Node.js $(node --version) already installed"
else
  info "Downloading NodeSource setup script..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs
  ok "Node.js $(node --version) installed"
fi

if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g pnpm@latest --silent
fi
ok "pnpm $(pnpm --version) ready"

if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  npm install -g pm2@latest --silent
fi
ok "PM2 $(pm2 --version) ready"

# ─────────────────────────────────────────────────────────────────────────────
step "Setting up PostgreSQL database"
# ─────────────────────────────────────────────────────────────────────────────
systemctl enable postgresql --quiet
systemctl start postgresql

DB_PASSWORD=$(openssl rand -hex 24)

sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename='$DB_USER'" | grep -q 1 \
  && info "DB user '$DB_USER' already exists" \
  || { sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" > /dev/null; ok "Created DB user"; }

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  && info "Database '$DB_NAME' already exists" \
  || { sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" > /dev/null; ok "Created database '$DB_NAME'"; }

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
ok "PostgreSQL ready → $DB_NAME"

# ─────────────────────────────────────────────────────────────────────────────
step "Deploying application code"
# ─────────────────────────────────────────────────────────────────────────────

# If no repo URL provided, check if we're already inside a git repo
if [[ -z "$REPO_URL" ]]; then
  if [[ -d "$APP_DIR/.git" ]]; then
    info "Using existing repo at $APP_DIR"
  elif [[ -f "$(pwd)/package.json" ]] && grep -q "netpulse\|@workspace" "$(pwd)/package.json" 2>/dev/null; then
    warn "No GitHub repo URL given. Using current directory."
    APP_DIR="$(pwd)"
  else
    echo ""
    echo -e "  ${YELLOW}No GitHub repository URL was provided.${NC}"
    read -rp "  GitHub repo URL (e.g. https://github.com/you/netpulse.git): " REPO_URL
    [[ -z "$REPO_URL" ]] && die "Repo URL is required."
  fi
fi

if [[ -n "$REPO_URL" ]]; then
  if [[ "$UPGRADE" == "true" ]]; then
    info "Pulling latest changes..."
    git -C "$APP_DIR" pull origin main
  else
    info "Cloning repo to $APP_DIR..."
    git clone "$REPO_URL" "$APP_DIR"
    ok "Code cloned"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Writing environment configuration"
# ─────────────────────────────────────────────────────────────────────────────
ENV_FILE="$APP_DIR/.env"

if [[ -f "$ENV_FILE" ]] && [[ "$UPGRADE" == "true" ]]; then
  info ".env already exists — preserving existing configuration"
  source "$ENV_FILE" 2>/dev/null || true
  # Update DATABASE_URL if it changed
  if ! grep -q "DATABASE_URL" "$ENV_FILE"; then
    echo "DATABASE_URL=${DATABASE_URL}" >> "$ENV_FILE"
  fi
else
  BETTER_AUTH_SECRET=$(openssl rand -hex 32)
  SESSION_SECRET=$(openssl rand -hex 64)
  SERVER_IP=$(hostname -I | awk '{print $1}')

  cat > "$ENV_FILE" << EOF
# ─── NetPulse Production Configuration ───────────────────────────────────────
# Generated: $(date)
# Edit and restart: pm2 restart netpulse
# ─────────────────────────────────────────────────────────────────────────────

NODE_ENV=production
PORT=${APP_PORT}

# PostgreSQL — auto-generated, do not change unless you move the DB
DATABASE_URL=${DATABASE_URL}

# ── Authentication (better-auth) ──────────────────────────────────────────────
# Auto-generated secret — keep this private
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
# Set to your public domain once DNS is configured
BETTER_AUTH_URL=http://${SERVER_IP}

# Session secret (auto-generated)
SESSION_SECRET=${SESSION_SECRET}

# Frontend dist path (served in production)
FRONTEND_DIST_PATH=${APP_DIR}/artifacts/isp-portal/dist/public

# Your domain or server IP (for nginx / HTTPS)
SERVER_DOMAIN=${SERVER_IP}
EOF

  ok ".env written to $ENV_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Building application"
# ─────────────────────────────────────────────────────────────────────────────
cd "$APP_DIR"

# Load env vars for build
set -o allexport
source "$ENV_FILE" 2>/dev/null || true
set +o allexport

info "Installing Node.js dependencies (this takes ~1-2 minutes)..."
pnpm install --frozen-lockfile 2>&1 | tail -3

info "Building shared libraries..."
pnpm run typecheck:libs 2>&1 | tail -3

info "Building API server..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5

info "Building frontend..."
PORT=3000 BASE_PATH=/ \
  NODE_ENV=production \
  pnpm --filter @workspace/isp-portal run build 2>&1 | tail -5

ok "Build complete"

# ─────────────────────────────────────────────────────────────────────────────
step "Running database migrations"
# ─────────────────────────────────────────────────────────────────────────────
info "Applying schema to database..."
pnpm --filter @workspace/db run push
ok "Database schema up to date"

# ─────────────────────────────────────────────────────────────────────────────
step "Starting application with PM2"
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p /var/log/netpulse

pm2 delete netpulse 2>/dev/null || true
pm2 start "$APP_DIR/deploy/ecosystem.config.cjs"
pm2 save --force

# Auto-start on server reboot
PM2_STARTUP=$(pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1)
eval "$PM2_STARTUP" 2>/dev/null || true

ok "NetPulse started with PM2"

# ─────────────────────────────────────────────────────────────────────────────
step "Configuring nginx"
# ─────────────────────────────────────────────────────────────────────────────
SERVER_DOMAIN="${SERVER_DOMAIN:-_}"
NGINX_CONF="/etc/nginx/sites-available/netpulse"

cat > "$NGINX_CONF" << NGINXEOF
# ─── NetPulse nginx configuration ────────────────────────────────────────────
# Generated: $(date)
# ─────────────────────────────────────────────────────────────────────────────

server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_DOMAIN};

    # Logs
    access_log /var/log/nginx/netpulse-access.log;
    error_log  /var/log/nginx/netpulse-error.log;

    # Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1024;
    gzip_vary on;

    # API reverse proxy
    location /api {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_buffering    off;
        client_max_body_size 50m;
    }

    # Frontend static files
    root ${APP_DIR}/artifacts/isp-portal/dist/public;
    index index.html;

    # Cache immutable assets forever
    location ~* \.(js|css|woff2?|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/netpulse
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl enable nginx --quiet && systemctl reload nginx
ok "nginx configured and running"

# ── Firewall ──────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   comment "SSH"       >/dev/null 2>&1 || true
  ufw allow 80/tcp   comment "HTTP"      >/dev/null 2>&1 || true
  ufw allow 443/tcp  comment "HTTPS"     >/dev/null 2>&1 || true
  ufw allow 1194/tcp comment "OpenVPN"   >/dev/null 2>&1 || true
  ufw allow 1812/udp comment "RADIUS"    >/dev/null 2>&1 || true
  ufw allow 1813/udp comment "RADIUS-Acct" >/dev/null 2>&1 || true
  echo "y" | ufw enable >/dev/null 2>&1 || true
  ok "Firewall configured (22, 80, 443, 1194, 1812, 1813)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Health check — wait for app to come up
# ─────────────────────────────────────────────────────────────────────────────
info "Waiting for app to start..."
HEALTHY=false
for i in {1..15}; do
  if curl -fsS "http://localhost:80/api/healthz" -o /dev/null 2>/dev/null; then
    HEALTHY=true; break
  fi
  sleep 2
done

ELAPSED=$(( $(date +%s) - START_TIME ))

# ─────────────────────────────────────────────────────────────────────────────
# Done!
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║            NetPulse Installation Complete! ✓             ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"

if [[ "$HEALTHY" == "true" ]]; then
  echo -e "${GREEN}${BOLD}║  Status: ${GREEN}● RUNNING${BOLD}                                        ║${NC}"
else
  echo -e "${GREEN}${BOLD}║  Status: ${YELLOW}● STARTING (allow 30 more seconds)${BOLD}               ║${NC}"
fi

echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}║  ${NC}${BOLD}→ Open your browser:${NC}                                     ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║    ${CYAN}http://${SERVER_DOMAIN}${NC}                           ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}║  ${NC}${BOLD}→ First-time setup (runs once):${NC}                          ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║    ${CYAN}http://${SERVER_DOMAIN}/setup${NC}                      ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║    Create admin account + enter company details           ║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  ${NC}${BOLD}Auth configuration (better-auth, self-hosted):${NC}           ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║    BETTER_AUTH_SECRET auto-generated in .env             ║${NC}"
echo -e "${GREEN}${BOLD}║    Update BETTER_AUTH_URL once you have a domain:        ║${NC}"
echo -e "${GREEN}${BOLD}║    1. Edit ${APP_DIR}/.env                               ║${NC}"
echo -e "${GREEN}${BOLD}║       Set BETTER_AUTH_URL=https://yourdomain.com         ║${NC}"
echo -e "${GREEN}${BOLD}║    2. Run: bash ${APP_DIR}/deploy/update.sh              ║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  ${NC}${DIM}Useful commands:${NC}                                         ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  pm2 status              — app process status${NC}            ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  pm2 logs netpulse       — live logs${NC}                     ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  bash ${APP_DIR}/deploy/update.sh  — update${NC}              ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  cat $LOG_FILE           — full install log${NC}              ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}Next: add HTTPS with Let's Encrypt (certbot):${NC}             ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  apt install certbot python3-certbot-nginx${NC}               ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  certbot --nginx -d ${SERVER_DOMAIN}${NC}               ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}Total install time: ${ELAPSED}s · Log: $LOG_FILE${NC}"
echo ""
