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

STEP=0; TOTAL=9   # updated below after prompts if optional modules are chosen
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

# ── Optional module prompts ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}  Optional modules (can be added later by re-running this script)${NC}"
echo ""

INSTALL_RADIUS=false
read -rp "  Install FreeRADIUS? (PPPoE/802.1X auth for MikroTik routers) [y/N]: " _r
[[ "${_r:-N}" =~ ^[Yy]$ ]] && INSTALL_RADIUS=true
[[ "$INSTALL_RADIUS" == "true" ]] && ok "FreeRADIUS — will install" || info "FreeRADIUS — skipped"

INSTALL_VPN=false
read -rp "  Install OpenVPN? (VPN cert management for customers) [y/N]: " _v
[[ "${_v:-N}" =~ ^[Yy]$ ]] && INSTALL_VPN=true
[[ "$INSTALL_VPN" == "true" ]] && ok "OpenVPN — will install" || info "OpenVPN — skipped"

# Recalculate total steps
TOTAL=9
[[ "$INSTALL_RADIUS" == "true" ]] && TOTAL=$((TOTAL+1))
[[ "$INSTALL_VPN"    == "true" ]] && TOTAL=$((TOTAL+1))
echo ""

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
ok "Core system packages installed"

if [[ "$INSTALL_RADIUS" == "true" ]]; then
  info "Installing FreeRADIUS..."
  apt-get install -y -qq freeradius freeradius-postgresql freeradius-utils
  ok "FreeRADIUS installed"
fi

if [[ "$INSTALL_VPN" == "true" ]]; then
  info "Installing OpenVPN + easy-rsa..."
  apt-get install -y -qq openvpn easy-rsa
  ok "OpenVPN + easy-rsa installed"
fi

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

# Grant permissions (needed if RADIUS schema will be applied)
sudo -u postgres psql -d "$DB_NAME" \
  -c "GRANT ALL PRIVILEGES ON ALL TABLES   IN SCHEMA public TO ${DB_USER};" >/dev/null 2>&1 || true
sudo -u postgres psql -d "$DB_NAME" \
  -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};" >/dev/null 2>&1 || true

if [[ "$INSTALL_RADIUS" == "true" ]]; then
  FR_SCHEMA="/etc/freeradius/3.0/mods-config/sql/main/postgresql/schema.sql"
  if [[ -f "$FR_SCHEMA" ]]; then
    if ! sudo -u postgres psql -d "$DB_NAME" -tAc \
         "SELECT 1 FROM information_schema.tables WHERE table_name='radcheck'" 2>/dev/null | grep -q 1; then
      info "Applying FreeRADIUS schema to database..."
      sudo -u postgres psql -d "$DB_NAME" -f "$FR_SCHEMA" >/dev/null
      ok "FreeRADIUS schema applied"
    else
      info "FreeRADIUS schema already present — skipping"
    fi
  fi
  # radnas table — NAS device secrets managed by the app
  sudo -u postgres psql -d "$DB_NAME" >/dev/null <<'RADNAS_SQL'
CREATE TABLE IF NOT EXISTS radnas (
  id         SERIAL PRIMARY KEY,
  nasname    VARCHAR(128) NOT NULL UNIQUE,
  shortname  VARCHAR(32),
  secret     VARCHAR(64)  NOT NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);
RADNAS_SQL
  ok "radnas table ready"
fi

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

# ── Optional modules ──────────────────────────────────────────────────────────
OPENVPN_ENABLED=${INSTALL_VPN}
EOF

  ok ".env written to $ENV_FILE"
fi

# Ensure optional flags are in .env on upgrade too
if [[ "$INSTALL_VPN" == "true" ]] && ! grep -q "OPENVPN_ENABLED" "$ENV_FILE"; then
  echo "OPENVPN_ENABLED=true" >> "$ENV_FILE"
  ok "OPENVPN_ENABLED=true added to .env"
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

# ─────────────────────────────────────────────────────────────────────────────
if [[ "$INSTALL_RADIUS" == "true" ]]; then
step "Configuring FreeRADIUS (SQL backend → PostgreSQL)"
# ─────────────────────────────────────────────────────────────────────────────
FR_DIR="/etc/freeradius/3.0"

cat > "${FR_DIR}/mods-available/sql" <<FR_SQL
sql {
    driver    = "rlm_sql_postgresql"
    dialect   = "postgresql"

    server    = "localhost"
    port      = 5432
    login     = "${DB_USER}"
    password  = "${DB_PASSWORD}"
    radius_db = "${DB_NAME}"

    acct_table1       = "radacct"
    acct_table2       = "radacct"
    postauth_table    = "radpostauth"
    authcheck_table   = "radcheck"
    groupcheck_table  = "radgroupcheck"
    authreply_table   = "radreply"
    groupreply_table  = "radgroupreply"
    usergroup_table   = "radusergroup"
    delete_stale_sessions = yes
    read_clients      = yes
    client_table      = "radnas"

    pool {
        start        = 5
        min          = 4
        max          = 32
        spare        = 3
        uses         = 0
        lifetime     = 0
        idle_timeout = 60
    }
}
FR_SQL

[[ -L "${FR_DIR}/mods-enabled/sql" ]] || \
  ln -sf "${FR_DIR}/mods-available/sql" "${FR_DIR}/mods-enabled/sql"

# Enable sql in authorize, accounting, session sections (idempotent via Python)
python3 - "${FR_DIR}/sites-available/default" \
          "${FR_DIR}/sites-available/inner-tunnel" <<'PYEOF'
import sys, re

def enable_sql_in_sections(path, sections):
    try:
        with open(path) as f:
            text = f.read()
    except FileNotFoundError:
        print(f"  skip {path} (not found)")
        return
    original = text
    for section in sections:
        pat = re.compile(
            rf'(\b{re.escape(section)}\b\s*\{{)(.*?)(^\}})',
            re.DOTALL | re.MULTILINE
        )
        def replacer(m):
            header, body, close = m.group(1), m.group(2), m.group(3)
            if re.search(r'(?m)^[ \t]+sql\b', body):
                return m.group(0)
            body = re.sub(r'\n[ \t]*#[ \t]*sql\b[^\n]*', '', body)
            return header + body + '\tsql\n' + close
        text = pat.sub(replacer, text)
    if text != original:
        with open(path, 'w') as f:
            f.write(text)
        print(f"  sql enabled in authorize/accounting/session: {path}")
    else:
        print(f"  sql already enabled: {path}")

for path in sys.argv[1:]:
    enable_sql_in_sections(path, ['authorize', 'accounting', 'session'])
PYEOF

freeradius -C -d "${FR_DIR}" 2>/dev/null && ok "FreeRADIUS config valid" || \
  warn "FreeRADIUS config warning — run: freeradius -C -d ${FR_DIR}"

systemctl enable freeradius --quiet
systemctl restart freeradius
ok "FreeRADIUS running (port 1812 UDP)"
fi

# ─────────────────────────────────────────────────────────────────────────────
if [[ "$INSTALL_VPN" == "true" ]]; then
step "Setting up OpenVPN PKI and management helpers"
# ─────────────────────────────────────────────────────────────────────────────
EASYRSA_DIR="/etc/openvpn/easy-rsa"
OVPN_DIR="/etc/openvpn"
mkdir -p /var/log/openvpn

if [[ ! -d "${EASYRSA_DIR}/pki" ]]; then
  info "Initialising PKI — CA, server cert, DH params (this takes ~2 min)..."
  if command -v make-cadir &>/dev/null; then
    make-cadir "$EASYRSA_DIR"
  else
    cp -r /usr/share/easy-rsa "$EASYRSA_DIR"
  fi

  SERVER_IP=$(hostname -I | awk '{print $1}')
  cat > "${EASYRSA_DIR}/vars" <<EASYRSA_VARS
set_var EASYRSA_BATCH        "yes"
set_var EASYRSA_REQ_CN       "NetPulse-CA"
set_var EASYRSA_REQ_COUNTRY  "KE"
set_var EASYRSA_REQ_PROVINCE "Nairobi"
set_var EASYRSA_REQ_CITY     "Nairobi"
set_var EASYRSA_REQ_ORG      "NetPulse ISP"
set_var EASYRSA_REQ_EMAIL    "admin@${SERVER_DOMAIN:-localhost}"
set_var EASYRSA_REQ_OU       "ISP"
set_var EASYRSA_KEY_SIZE     2048
set_var EASYRSA_CA_EXPIRE    3650
set_var EASYRSA_CERT_EXPIRE  825
EASYRSA_VARS

  cd "$EASYRSA_DIR"
  ./easyrsa init-pki
  ./easyrsa build-ca nopass
  ./easyrsa gen-req server nopass
  ./easyrsa sign-req server server
  ./easyrsa gen-dh
  openvpn --genkey secret "${EASYRSA_DIR}/pki/ta.key"
  ok "PKI initialised"
else
  info "PKI already initialised — skipping"
fi

# Copy PKI files to /etc/openvpn
cp -f "${EASYRSA_DIR}/pki/ca.crt"             "$OVPN_DIR/ca.crt"
cp -f "${EASYRSA_DIR}/pki/issued/server.crt"  "$OVPN_DIR/server.crt"
cp -f "${EASYRSA_DIR}/pki/private/server.key" "$OVPN_DIR/server.key"
cp -f "${EASYRSA_DIR}/pki/dh.pem"             "$OVPN_DIR/dh.pem"
cp -f "${EASYRSA_DIR}/pki/ta.key"             "$OVPN_DIR/ta.key"
mkdir -p "${OVPN_DIR}/ccd"

if [[ ! -f "${OVPN_DIR}/server.conf" ]]; then
  cat > "${OVPN_DIR}/server.conf" <<OVPN_CONF
port 1194
proto udp
dev tun

ca   /etc/openvpn/ca.crt
cert /etc/openvpn/server.crt
key  /etc/openvpn/server.key
dh   /etc/openvpn/dh.pem
tls-auth /etc/openvpn/ta.key 0

server 10.8.0.0 255.255.255.0
ifconfig-pool-persist /var/log/openvpn/ipp.txt
client-config-dir /etc/openvpn/ccd
crl-verify /etc/openvpn/crl.pem

push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 8.8.4.4"

keepalive 10 120
cipher AES-256-GCM
auth SHA256
compress lz4-v2
push "compress lz4-v2"
max-clients 500

user  nobody
group nogroup
persist-key
persist-tun

status /var/log/openvpn/status.log 60
log    /var/log/openvpn/openvpn.log
verb 3
OVPN_CONF
fi

# Initial CRL (required by crl-verify on startup)
if [[ ! -f "${OVPN_DIR}/crl.pem" ]]; then
  cd "$EASYRSA_DIR"
  ./easyrsa gen-crl
  cp -f "${EASYRSA_DIR}/pki/crl.pem" "${OVPN_DIR}/crl.pem"
  chmod 644 "${OVPN_DIR}/crl.pem"
fi

# IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward
sed -i 's|^#*net.ipv4.ip_forward.*|net.ipv4.ip_forward=1|' /etc/sysctl.conf
sysctl -p --quiet

systemctl enable openvpn@server --quiet
systemctl restart openvpn@server
ok "OpenVPN server running (UDP 1194)"

# ── VPN management helpers (called by NetPulse API) ───────────────────────────
cat > /usr/local/bin/netpulse-vpn-issue <<'VPN_ISSUE'
#!/usr/bin/env bash
# Usage: netpulse-vpn-issue <common-name>
# Prints the full .ovpn config to stdout
set -euo pipefail

CN="${1:-}"
[[ "$CN" =~ ^[a-zA-Z0-9_.-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/easy-rsa"
OVPN_DIR="/etc/openvpn"

cd "$EASYRSA_DIR"
./easyrsa gen-req   "$CN" nopass 2>/dev/null
./easyrsa sign-req client "$CN"  2>/dev/null

SERVER_IP=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

CA=$(cat "$OVPN_DIR/ca.crt")
CERT=$(openssl x509 -in "${EASYRSA_DIR}/pki/issued/${CN}.crt")
KEY=$(cat "${EASYRSA_DIR}/pki/private/${CN}.key")
TA=$(cat "$OVPN_DIR/ta.key")

cat <<OVPN
client
dev tun
proto udp
remote ${SERVER_IP} 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-256-GCM
auth SHA256
compress lz4-v2
verb 3
key-direction 1
<ca>
${CA}
</ca>
<cert>
${CERT}
</cert>
<key>
${KEY}
</key>
<tls-auth>
${TA}
</tls-auth>
OVPN
VPN_ISSUE
chmod 755 /usr/local/bin/netpulse-vpn-issue
ok "/usr/local/bin/netpulse-vpn-issue"

cat > /usr/local/bin/netpulse-vpn-revoke <<'VPN_REVOKE'
#!/usr/bin/env bash
# Usage: netpulse-vpn-revoke <common-name>
set -euo pipefail

CN="${1:-}"
[[ "$CN" =~ ^[a-zA-Z0-9_.-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/easy-rsa"
cd "$EASYRSA_DIR"
./easyrsa revoke "$CN" 2>/dev/null
./easyrsa gen-crl       2>/dev/null
cp -f "${EASYRSA_DIR}/pki/crl.pem" /etc/openvpn/crl.pem
chmod 644 /etc/openvpn/crl.pem
systemctl reload openvpn@server
echo "Revoked $CN and reloaded OpenVPN CRL"
VPN_REVOKE
chmod 755 /usr/local/bin/netpulse-vpn-revoke
ok "/usr/local/bin/netpulse-vpn-revoke"

# Allow the PM2 process user (root in this installer) to run helpers passwordlessly
echo "root ALL=(root) NOPASSWD: /usr/local/bin/netpulse-vpn-issue, /usr/local/bin/netpulse-vpn-revoke" \
  > /etc/sudoers.d/netpulse-vpn
chmod 440 /etc/sudoers.d/netpulse-vpn
ok "sudoers rule for VPN helpers"
fi

# ── Firewall ──────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   comment "SSH"          >/dev/null 2>&1 || true
  ufw allow 80/tcp   comment "HTTP"         >/dev/null 2>&1 || true
  ufw allow 443/tcp  comment "HTTPS"        >/dev/null 2>&1 || true
  if [[ "$INSTALL_VPN" == "true" ]]; then
    ufw allow 1194/udp comment "OpenVPN"    >/dev/null 2>&1 || true
  fi
  if [[ "$INSTALL_RADIUS" == "true" ]]; then
    ufw allow 1812/udp comment "RADIUS"     >/dev/null 2>&1 || true
    ufw allow 1813/udp comment "RADIUS-Acct" >/dev/null 2>&1 || true
  fi
  echo "y" | ufw enable >/dev/null 2>&1 || true
  _fw_ports="22, 80, 443"
  [[ "$INSTALL_VPN"    == "true" ]] && _fw_ports+=" + 1194/udp (OpenVPN)"
  [[ "$INSTALL_RADIUS" == "true" ]] && _fw_ports+=" + 1812-1813/udp (RADIUS)"
  ok "Firewall configured (${_fw_ports})"
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
echo -e "${GREEN}${BOLD}║  ${NC}${BOLD}Services:${NC}                                                ${GREEN}${BOLD}║${NC}"
_np_status=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; procs=json.load(sys.stdin); p=next((x for x in procs if x.get('name')=='netpulse'),None); print(p['pm2_env']['status'] if p else 'unknown')" 2>/dev/null || echo "unknown")
echo -e "${GREEN}${BOLD}║  ${DIM}  netpulse (PM2)    ${_np_status}${NC}                        ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  nginx             $(systemctl is-active nginx 2>/dev/null || echo unknown)${NC}                           ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║  ${DIM}  postgresql        $(systemctl is-active postgresql 2>/dev/null || echo unknown)${NC}                           ${GREEN}${BOLD}║${NC}"
if [[ "$INSTALL_RADIUS" == "true" ]]; then
  echo -e "${GREEN}${BOLD}║  ${DIM}  freeradius        $(systemctl is-active freeradius 2>/dev/null || echo unknown)${NC}                           ${GREEN}${BOLD}║${NC}"
fi
if [[ "$INSTALL_VPN" == "true" ]]; then
  echo -e "${GREEN}${BOLD}║  ${DIM}  openvpn@server    $(systemctl is-active openvpn@server 2>/dev/null || echo unknown)${NC}                           ${GREEN}${BOLD}║${NC}"
fi
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
