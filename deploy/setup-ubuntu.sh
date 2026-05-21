#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  NetPulse ISP Manager — Ubuntu Server Setup Script
#  Tested on Ubuntu 22.04 LTS / 24.04 LTS
#
#  Usage:
#    wget -O setup.sh https://raw.githubusercontent.com/YOUR/REPO/main/deploy/setup-ubuntu.sh
#    bash setup.sh https://github.com/YOUR/REPO.git
#
#  What this does:
#    1. Installs Node.js 24, pnpm, PM2
#    2. Installs PostgreSQL and creates a database
#    3. Clones your GitHub repo to /opt/netpulse
#    4. Guides you through .env configuration
#    5. Installs dependencies, builds everything, runs migrations
#    6. Starts the app with PM2 (auto-restart on crash / reboot)
#    7. Installs and configures nginx as reverse proxy
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}▶ $*${NC}"; }
success() { echo -e "${GREEN}✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $*${NC}"; }
die()     { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── Must run as root ───────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root: sudo bash $0 <github-repo-url>"

REPO_URL="${1:-}"
APP_DIR="/opt/netpulse"
DB_NAME="netpulse"
DB_USER="netpulse"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "   NetPulse ISP Manager — Production Setup"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── 1. System packages ─────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get install -y -qq curl git nginx postgresql postgresql-contrib openssl

# ── 2. Node.js 24 ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(parseInt(process.version.slice(1)) < 24 ? 1 : 0)" 2>/dev/null; echo $?) -ne 0 ]]; then
  info "Installing Node.js 24..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi
success "Node.js $(node --version) ready"

# ── 3. pnpm ────────────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g pnpm@latest --silent
fi
success "pnpm $(pnpm --version) ready"

# ── 4. PM2 ────────────────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  npm install -g pm2@latest --silent
fi
success "PM2 $(pm2 --version) ready"

# ── 5. PostgreSQL ─────────────────────────────────────────────────────────────
info "Setting up PostgreSQL..."
systemctl enable postgresql --quiet
systemctl start postgresql

DB_PASSWORD=$(openssl rand -hex 24)

# Create DB user + database if they don't exist
sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
success "PostgreSQL: database '$DB_NAME' ready"

# ── 6. Clone / update repo ────────────────────────────────────────────────────
if [[ -z "$REPO_URL" ]]; then
  echo ""
  read -rp "GitHub repo URL (e.g. https://github.com/yourname/netpulse.git): " REPO_URL
fi

if [[ -d "$APP_DIR/.git" ]]; then
  info "Repo already cloned, pulling latest..."
  git -C "$APP_DIR" pull origin main
else
  info "Cloning repo to $APP_DIR..."
  git clone "$REPO_URL" "$APP_DIR"
fi
success "Code at $APP_DIR"

# ── 7. Configure .env ─────────────────────────────────────────────────────────
ENV_FILE="$APP_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists, skipping interactive setup. Edit $ENV_FILE manually if needed."
else
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "   Clerk Authentication Setup"
  echo "   Go to https://dashboard.clerk.com, create a"
  echo "   PRODUCTION app, and paste the API keys below."
  echo "═══════════════════════════════════════════════════════"
  echo ""
  read -rp "  Clerk Publishable Key (pk_live_...): " CLERK_PUB_KEY
  read -rp "  Clerk Secret Key      (sk_live_...): " CLERK_SEC_KEY
  echo ""
  read -rp "  Your domain or server IP (e.g. isp.mycompany.com): " SERVER_DOMAIN
  SESSION_SECRET=$(openssl rand -hex 64)

  cat > "$ENV_FILE" <<EOF
# NetPulse production environment
NODE_ENV=production
PORT=8080

DATABASE_URL=${DATABASE_URL}

CLERK_PUBLISHABLE_KEY=${CLERK_PUB_KEY}
CLERK_SECRET_KEY=${CLERK_SEC_KEY}

SESSION_SECRET=${SESSION_SECRET}

FRONTEND_DIST_PATH=${APP_DIR}/artifacts/isp-portal/dist/public

# Build-time frontend vars (used by setup/update scripts)
VITE_CLERK_PUBLISHABLE_KEY=${CLERK_PUB_KEY}
VITE_CLERK_PROXY_URL=https://${SERVER_DOMAIN}/api/__clerk

SERVER_DOMAIN=${SERVER_DOMAIN}
EOF

  success ".env written to $ENV_FILE"
fi

# Load env
set -o allexport; source "$ENV_FILE"; set +o allexport

# ── 8. Log directory ──────────────────────────────────────────────────────────
mkdir -p /var/log/netpulse
chown -R www-data:www-data /var/log/netpulse 2>/dev/null || true

# ── 9. Install dependencies ───────────────────────────────────────────────────
info "Installing Node.js dependencies..."
cd "$APP_DIR"
pnpm install --frozen-lockfile
success "Dependencies installed"

# ── 10. Build shared libs ─────────────────────────────────────────────────────
info "Building shared libraries..."
pnpm run typecheck:libs
success "Libs built"

# ── 11. Build API server ──────────────────────────────────────────────────────
info "Building API server..."
pnpm --filter @workspace/api-server run build
success "API server built"

# ── 12. Build frontend ────────────────────────────────────────────────────────
info "Building frontend (this may take ~30 seconds)..."
PORT=3000 BASE_PATH=/ \
  VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" \
  VITE_CLERK_PROXY_URL="${VITE_CLERK_PROXY_URL:-}" \
  NODE_ENV=production \
  pnpm --filter @workspace/isp-portal run build
success "Frontend built → $APP_DIR/artifacts/isp-portal/dist/public"

# ── 13. Run DB migrations ─────────────────────────────────────────────────────
info "Running database migrations..."
pnpm --filter @workspace/db run push
success "Database schema up to date"

# ── 14. PM2 — start / restart ─────────────────────────────────────────────────
info "Starting app with PM2..."
pm2 delete netpulse 2>/dev/null || true
pm2 start "$APP_DIR/deploy/ecosystem.config.cjs"
pm2 save

# Enable PM2 to start on server reboot
PM2_STARTUP=$(pm2 startup systemd -u root --hp /root | tail -1)
eval "$PM2_STARTUP" 2>/dev/null || true

success "App running with PM2 (name: netpulse)"

# ── 15. nginx ─────────────────────────────────────────────────────────────────
DOMAIN="${SERVER_DOMAIN:-_}"
NGINX_CONF="/etc/nginx/sites-available/netpulse"

info "Configuring nginx..."

# Write nginx config (substituting the real domain and app dir)
cat > "$NGINX_CONF" <<NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1024;

    location /api {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_buffering    off;
    }

    root ${APP_DIR}/artifacts/isp-portal/dist/public;
    index index.html;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/netpulse
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t && systemctl reload nginx
success "nginx configured and running"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}   ✅  NetPulse is LIVE!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  App URL   : http://${DOMAIN}"
echo "  Logs      : pm2 logs netpulse"
echo "  Status    : pm2 status"
echo "  Update    : cd $APP_DIR && bash deploy/update.sh"
echo ""
echo "  Next step (HTTPS / SSL):"
echo "    sudo apt install certbot python3-certbot-nginx"
echo "    sudo certbot --nginx -d ${DOMAIN}"
echo ""
echo "  ⚠  Make sure your Clerk dashboard has this domain"
echo "     added under: Production app → Domains"
echo ""
echo "  Database credentials saved in: $ENV_FILE"
echo "  Keep that file private — do NOT commit it to git."
echo ""
