#!/usr/bin/env bash
# =============================================================================
#  NetPulse ISP Manager — Single-Command Installer
#  Supports: Ubuntu 22.04 (Jammy) and Ubuntu 24.04 (Noble)
#
#  Usage:
#    curl -sSL https://raw.githubusercontent.com/jamboso/NetPulse-ISP/main/install.sh | sudo bash
#
#  Or locally:
#    sudo bash install.sh
#    sudo bash install.sh --upgrade
#    sudo bash install.sh --uninstall
# =============================================================================
set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────
NETPULSE_DIR="/opt/netpulse"
NETPULSE_USER="netpulse"
DB_NAME="netpulse"
DB_USER="netpulse"
API_PORT="5000"
WEB_PORT="3001"
REPO_URL="https://github.com/jamboso/NetPulse-ISP.git"
NODE_VERSION="20"
PNPM_VERSION="10"
# Explicit PostgreSQL 16 for RADIUS extension compatibility
PG_VERSION="16"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

banner() { echo -e "\n${CYAN}${BOLD}══ $* ══${RESET}"; }
ok()     { echo -e "  ${GREEN}✓${RESET} $*"; }
info()   { echo -e "  ${YELLOW}→${RESET} $*"; }
err()    { echo -e "  ${RED}✗ ERROR:${RESET} $*" >&2; exit 1; }
skip()   { echo -e "  ${YELLOW}↷${RESET} $* (already done — skipping)"; }

# ── Helpers ───────────────────────────────────────────────────────────────────
# Safe random string — avoids SIGPIPE from tr | head under pipefail
rand_hex()  { openssl rand -hex "${1:-16}"; }               # e.g. rand_hex 8 → 16 chars
rand_b64()  { openssl rand -base64 "${1:-32}"; }            # for auth secrets

lock_release_control_files() {
  chown -R root:root "$NETPULSE_DIR/.git" "$NETPULSE_DIR/deploy"
  find "$NETPULSE_DIR/.git" "$NETPULSE_DIR/deploy" -type d -exec chmod 755 {} +
  find "$NETPULSE_DIR/.git" "$NETPULSE_DIR/deploy" -type f -exec chmod go-w {} +
}

require_trusted_vpn_helper_source() {
  [[ "$(stat -c '%U:%a' "$NETPULSE_DIR/deploy")" == "root:755" ]] \
    || err "NetPulse deployment scripts must be root-owned before installing a privileged helper."
  [[ "$(stat -c '%U' "$NETPULSE_DIR/deploy/repair-openvpn.sh")" == "root" ]] \
    || err "VPN repair helper source is not root-owned."
}

# ── Uninstall ─────────────────────────────────────────────────────────────────
uninstall() {
  banner "NetPulse Uninstaller"
  read -rp "  Remove ALL NetPulse components, packages, DB, and data? [y/N] " CONFIRM </dev/tty
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

  # Stop and disable services
  for svc in netpulse-api netpulse-web freeradius "openvpn-server@netpulse"; do
    systemctl stop "$svc" 2>/dev/null || true
    systemctl disable "$svc" 2>/dev/null || true
  done

  # Remove systemd units
  rm -f /etc/systemd/system/netpulse-api.service
  rm -f /etc/systemd/system/netpulse-web.service
  systemctl daemon-reload

  # Remove Nginx config
  rm -f /etc/nginx/sites-enabled/netpulse
  rm -f /etc/nginx/sites-available/netpulse
  systemctl reload nginx 2>/dev/null || true

  # Remove VPN helpers and sudoers rule
  rm -f /usr/local/bin/netpulse-vpn-issue
  rm -f /usr/local/bin/netpulse-vpn-revoke
  rm -f /usr/local/bin/netpulse-vpn-repair
  rm -f /usr/local/bin/netpulse-vpn-read-certificates
  rm -f /etc/sudoers.d/netpulse-vpn

  # Drop DB and user
  if systemctl is-active postgresql &>/dev/null; then
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null || true
    sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};"      2>/dev/null || true
    ok "Database and user removed"
  fi

  # Remove only NetPulse's dedicated VPN files. Other OpenVPN deployments are untouched.
  rm -rf /etc/openvpn/netpulse-easy-rsa /etc/openvpn/netpulse \
         /etc/openvpn/server/netpulse.conf \
         /var/log/openvpn/netpulse-ipp.txt /var/log/openvpn/netpulse-status.log \
         /var/log/openvpn/netpulse-server.log /run/openvpn/netpulse-routeros.pid

  # Remove app directory and system user
  rm -rf "$NETPULSE_DIR"
  id -u "$NETPULSE_USER" &>/dev/null && userdel -r "$NETPULSE_USER" 2>/dev/null || true

  # Remove packages
  DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y -qq \
    freeradius freeradius-postgresql freeradius-utils \
    openvpn easy-rsa \
    "postgresql-${PG_VERSION}" postgresql-client \
    nginx certbot python3-certbot-nginx 2>/dev/null || true
  apt-get autoremove -y -qq 2>/dev/null || true

  ok "NetPulse fully uninstalled."
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

# ── Upgrade (pull + rebuild + migrate + restart) ───────────────────────────────
upgrade() {
  banner "NetPulse Upgrade"
  [[ "$(id -u)" -eq 0 ]] || err "Run upgrades as root: sudo bash install.sh --upgrade"
  [[ -d "$NETPULSE_DIR/.git" ]] || err "NetPulse is not installed at $NETPULSE_DIR"

  PREV_SHA=$(git -C "$NETPULSE_DIR" rev-parse --short HEAD)
  info "Current: $PREV_SHA — pulling latest..."
  git -C "$NETPULSE_DIR" fetch origin main --quiet
  git -C "$NETPULSE_DIR" reset --hard origin/main --quiet
  lock_release_control_files
  require_trusted_vpn_helper_source
  NEW_SHA=$(git -C "$NETPULSE_DIR" rev-parse --short HEAD)

  cd "$NETPULSE_DIR"
  . "$NETPULSE_DIR/.env"

  sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" pnpm install --frozen-lockfile --silent
  sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" \
    env NODE_ENV=production pnpm --filter @workspace/api-server run build --silent
  sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" \
    env NODE_ENV=production PORT=3000 BASE_PATH=/ \
    pnpm --filter @workspace/isp-portal run build --silent
  sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" \
    env DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push --force

  install -o root -g root -m 0755 "$NETPULSE_DIR/deploy/repair-openvpn.sh" /usr/local/bin/.netpulse-vpn-repair.new
  mv -f /usr/local/bin/.netpulse-vpn-repair.new /usr/local/bin/netpulse-vpn-repair
  install -o root -g root -m 0755 "$NETPULSE_DIR/deploy/read-openvpn-certificates.sh" /usr/local/bin/.netpulse-vpn-read-certificates.new
  mv -f /usr/local/bin/.netpulse-vpn-read-certificates.new /usr/local/bin/netpulse-vpn-read-certificates
  echo "${NETPULSE_USER} ALL=(root) NOPASSWD: /usr/local/bin/netpulse-vpn-issue, /usr/local/bin/netpulse-vpn-revoke, /usr/local/bin/netpulse-vpn-repair, /usr/local/bin/netpulse-vpn-read-certificates" \
    > /etc/sudoers.d/netpulse-vpn
  chmod 440 /etc/sudoers.d/netpulse-vpn
  visudo -cf /etc/sudoers.d/netpulse-vpn >/dev/null || err "Could not validate the NetPulse VPN sudo rule."

  chown -R "$NETPULSE_USER:$NETPULSE_USER" "$NETPULSE_DIR"
  lock_release_control_files
  systemctl restart netpulse-api netpulse-web

  echo ""
  ok "Upgrade complete: $PREV_SHA → $NEW_SHA"
  exit 0
}

[[ "${1:-}" == "--upgrade" ]] && upgrade

# ── Preflight ─────────────────────────────────────────────────────────────────
banner "Preflight"

[[ "$(id -u)" -eq 0 ]] || err "Must run as root. Use: sudo bash install.sh"

. /etc/os-release 2>/dev/null || err "Cannot read /etc/os-release"
[[ "$ID" == "ubuntu" ]] || err "Only Ubuntu is supported (detected: $ID)"
[[ "$VERSION_ID" == "22.04" || "$VERSION_ID" == "24.04" ]] || \
  err "Requires Ubuntu 22.04 or 24.04 (detected: $VERSION_ID)"
ok "Ubuntu $VERSION_ID detected"

read -rp "  Domain or IP for this server (e.g. isp.example.com or 192.168.1.10): " NP_DOMAIN </dev/tty
NP_DOMAIN="${NP_DOMAIN:-localhost}"

# Secrets — use openssl rand without pipes to avoid SIGPIPE under pipefail
DB_PASS=$(rand_hex 12)           # 24 hex chars, safe characters
BETTER_AUTH_SECRET=$(rand_b64 32)
SESSION_SECRET=$(rand_b64 32)

ok "Random secrets generated"

# ── System packages ───────────────────────────────────────────────────────────
banner "System packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Node.js via NodeSource
if ! command -v node &>/dev/null || \
   [[ "$(node --version 2>/dev/null | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  info "Installing Node.js $NODE_VERSION..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
  ok "Node.js $(node --version)"
else
  skip "Node.js $(node --version)"
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  npm install -g "pnpm@$PNPM_VERSION" --quiet
  ok "pnpm $(pnpm --version)"
else
  skip "pnpm $(pnpm --version)"
fi

# PostgreSQL 16 (pinned for freeradius-postgresql compatibility)
# Ubuntu 22.04 ships PG14 by default; add the official PGDG repo for PG16
if ! apt-cache show "postgresql-${PG_VERSION}" &>/dev/null; then
  info "Adding PostgreSQL APT repository (PGDG)..."
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
fi
if ! dpkg -s "postgresql-${PG_VERSION}" &>/dev/null; then
  info "Installing PostgreSQL ${PG_VERSION}..."
  apt-get install -y -qq \
    "postgresql-${PG_VERSION}" \
    "postgresql-client-${PG_VERSION}"
else
  skip "PostgreSQL ${PG_VERSION}"
fi

# Other packages
PKGS=(git nginx freeradius freeradius-postgresql freeradius-utils
      openvpn easy-rsa certbot python3-certbot-nginx ufw curl openssl)
MISSING=()
for pkg in "${PKGS[@]}"; do
  dpkg -s "$pkg" &>/dev/null || MISSING+=("$pkg")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  info "Installing: ${MISSING[*]}"
  apt-get install -y -qq "${MISSING[@]}"
fi
ok "All system packages present"

# ── PostgreSQL ────────────────────────────────────────────────────────────────
banner "PostgreSQL"

PG_VER=$(psql --version | grep -oP '\d+' | head -1)

systemctl is-active "postgresql@${PG_VER}-main" &>/dev/null || \
  systemctl is-active postgresql &>/dev/null || \
  systemctl start "postgresql@${PG_VER}-main" 2>/dev/null || \
  systemctl start postgresql
systemctl enable "postgresql@${PG_VER}-main" --quiet 2>/dev/null || \
  systemctl enable postgresql --quiet

# Create DB user (idempotent)
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
  skip "DB user ${DB_USER} (password updated)"
else
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
  ok "DB user created"
fi

# Create database (idempotent)
if sudo -u postgres psql -lqt | cut -d\| -f1 | grep -qw "${DB_NAME}"; then
  skip "Database ${DB_NAME}"
else
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
  ok "Database ${DB_NAME} created"
fi

# Apply FreeRADIUS schema (once only)
FR_SCHEMA="/etc/freeradius/3.0/mods-config/sql/main/postgresql/schema.sql"
if [[ -f "$FR_SCHEMA" ]]; then
  if ! sudo -u postgres psql -d "${DB_NAME}" -tAc \
       "SELECT 1 FROM information_schema.tables WHERE table_name='radcheck'" | grep -q 1; then
    info "Applying FreeRADIUS schema..."
    sudo -u postgres psql -d "${DB_NAME}" -f "$FR_SCHEMA" >/dev/null
    ok "FreeRADIUS schema applied"
  else
    skip "FreeRADIUS schema"
  fi
fi

# radnas table (NAS secrets managed by the app)
sudo -u postgres psql -d "${DB_NAME}" <<'RADNAS_SQL' >/dev/null
CREATE TABLE IF NOT EXISTS radnas (
  id         SERIAL PRIMARY KEY,
  nasname    VARCHAR(128)  NOT NULL UNIQUE,
  shortname  VARCHAR(32),
  secret     VARCHAR(64)   NOT NULL,
  created_at TIMESTAMPTZ   DEFAULT NOW()
);
RADNAS_SQL

# Permissions
sudo -u postgres psql -d "${DB_NAME}" \
  -c "GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO ${DB_USER};" >/dev/null
sudo -u postgres psql -d "${DB_NAME}" \
  -c "GRANT USAGE, SELECT ON ALL SEQUENCES  IN SCHEMA public TO ${DB_USER};" >/dev/null
ok "DB permissions granted"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

# ── Application ───────────────────────────────────────────────────────────────
banner "NetPulse Application"

id -u "$NETPULSE_USER" &>/dev/null || \
  useradd -r -m -d "/home/${NETPULSE_USER}" -s /bin/bash "$NETPULSE_USER"
ok "System user ${NETPULSE_USER}"

# Clone / update
if [[ -d "${NETPULSE_DIR}/.git" ]]; then
  info "Updating existing repo..."
  git -C "$NETPULSE_DIR" fetch origin main --quiet
  git -C "$NETPULSE_DIR" reset --hard origin/main --quiet
  ok "Repo updated"
else
  info "Cloning repo..."
  git clone --depth=1 "$REPO_URL" "$NETPULSE_DIR" --quiet
  ok "Repo cloned"
fi

# BETTER_AUTH_URL always uses https — installer always configures TLS
# (certbot for real domains, self-signed for IP/localhost)
cat > "${NETPULSE_DIR}/.env" <<ENV
NODE_ENV=production
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=https://${NP_DOMAIN}/api
SESSION_SECRET=${SESSION_SECRET}
OPENVPN_ENABLED=true
OPENVPN_EASY_RSA_DIR=/etc/openvpn/netpulse-easy-rsa
ENV
chmod 600 "${NETPULSE_DIR}/.env"

# Build
cd "$NETPULSE_DIR"
chown -R "${NETPULSE_USER}:${NETPULSE_USER}" "$NETPULSE_DIR"
lock_release_control_files

info "Installing pnpm dependencies..."
sudo -u "$NETPULSE_USER" HOME="/home/${NETPULSE_USER}" \
  pnpm install --frozen-lockfile --silent
ok "Dependencies installed"

info "Building API server..."
sudo -u "$NETPULSE_USER" HOME="/home/${NETPULSE_USER}" \
  env NODE_ENV=production \
  pnpm --filter @workspace/api-server run build --silent
ok "API server built → artifacts/api-server/dist/index.mjs"

info "Building frontend..."
sudo -u "$NETPULSE_USER" HOME="/home/${NETPULSE_USER}" \
  env NODE_ENV=production PORT="$WEB_PORT" BASE_PATH=/ \
  pnpm --filter @workspace/isp-portal run build --silent
ok "Frontend built → artifacts/isp-portal/dist/public"

info "Running DB migrations..."
sudo -u "$NETPULSE_USER" HOME="/home/${NETPULSE_USER}" \
  env DATABASE_URL="$DATABASE_URL" \
  pnpm --filter @workspace/db run push --force
ok "DB migrations applied"

chown -R "${NETPULSE_USER}:${NETPULSE_USER}" "$NETPULSE_DIR"
lock_release_control_files

# ── Systemd services ──────────────────────────────────────────────────────────
banner "Systemd services"

# API service
cat > /etc/systemd/system/netpulse-api.service <<UNIT_API
[Unit]
Description=NetPulse API Server
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${NETPULSE_USER}
WorkingDirectory=${NETPULSE_DIR}
EnvironmentFile=${NETPULSE_DIR}/.env
ExecStart=/usr/bin/node --enable-source-maps ${NETPULSE_DIR}/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT_API

# Web / frontend service (vite preview serving the production build)
cat > /etc/systemd/system/netpulse-web.service <<UNIT_WEB
[Unit]
Description=NetPulse Web Frontend (vite preview)
After=network.target

[Service]
Type=simple
User=${NETPULSE_USER}
WorkingDirectory=${NETPULSE_DIR}
Environment=PORT=${WEB_PORT}
Environment=BASE_PATH=/
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm --filter @workspace/isp-portal run serve
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT_WEB

systemctl daemon-reload
for svc in netpulse-api netpulse-web; do
  systemctl enable "$svc" --quiet
  systemctl restart "$svc"
  ok "$svc started"
done

# Wait for API healthz
info "Waiting for API to respond..."
for i in $(seq 1 30); do
  curl -sf "http://localhost:${API_PORT}/api/healthz" >/dev/null 2>&1 && break || sleep 2
done
curl -sf "http://localhost:${API_PORT}/api/healthz" >/dev/null 2>&1 && \
  ok "API healthz OK" || info "API not yet responding — check: journalctl -u netpulse-api -n 50"

# ── Nginx ─────────────────────────────────────────────────────────────────────
banner "Nginx"

cat > /etc/nginx/sites-available/netpulse <<NGINX_CONF
upstream netpulse_api { server 127.0.0.1:${API_PORT}; }
upstream netpulse_web { server 127.0.0.1:${WEB_PORT}; }

server {
    listen 80;
    server_name ${NP_DOMAIN};

    location /api/ {
        proxy_pass         http://netpulse_api;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass         http://netpulse_web;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
NGINX_CONF

rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
ln -sf /etc/nginx/sites-available/netpulse /etc/nginx/sites-enabled/netpulse
nginx -t -q
systemctl reload nginx
ok "Nginx configured"

# ── TLS ───────────────────────────────────────────────────────────────────────
banner "TLS / HTTPS"

IS_REAL_DOMAIN=false
if [[ "$NP_DOMAIN" != "localhost" && ! "$NP_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IS_REAL_DOMAIN=true
fi

if $IS_REAL_DOMAIN; then
  info "Requesting Let's Encrypt certificate for $NP_DOMAIN..."
  certbot --nginx -d "$NP_DOMAIN" --non-interactive --agree-tos \
    --email "admin@${NP_DOMAIN}" --redirect --quiet && \
    ok "TLS certificate obtained (Let's Encrypt)" || {
    info "certbot failed (DNS not resolving yet?) — falling back to self-signed cert"
    IS_REAL_DOMAIN=false
  }
fi

if ! $IS_REAL_DOMAIN; then
  # Self-signed certificate for IP / localhost installations
  SSL_DIR="/etc/ssl/netpulse"
  mkdir -p "$SSL_DIR"
  if [[ ! -f "${SSL_DIR}/server.crt" ]]; then
    # SAN: IP: only for numeric IPv4; DNS: for hostnames and localhost
    if [[ "$NP_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      SAN_VALUE="IP:${NP_DOMAIN}"
    else
      SAN_VALUE="DNS:${NP_DOMAIN}"
    fi
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "${SSL_DIR}/server.key" \
      -out    "${SSL_DIR}/server.crt" \
      -subj   "/C=KE/O=NetPulse ISP/CN=${NP_DOMAIN}" \
      -addext "subjectAltName=${SAN_VALUE}" \
      2>/dev/null
    ok "Self-signed certificate generated (valid 10 years, SAN=${SAN_VALUE})"
  else
    skip "Self-signed certificate"
  fi

  # Append SSL server block to Nginx config
  cat >> /etc/nginx/sites-available/netpulse <<NGINX_SSL

server {
    listen 443 ssl;
    server_name ${NP_DOMAIN};

    ssl_certificate     ${SSL_DIR}/server.crt;
    ssl_certificate_key ${SSL_DIR}/server.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location /api/ {
        proxy_pass         http://netpulse_api;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass         http://netpulse_web;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
    }
}
NGINX_SSL
  nginx -t -q && systemctl reload nginx
  ok "HTTPS on port 443 (self-signed — browser will warn on first visit)"
fi

# ── FreeRADIUS ────────────────────────────────────────────────────────────────
banner "FreeRADIUS"

FR_DIR="/etc/freeradius/3.0"

# SQL module — write a clean config (idempotent)
cat > "${FR_DIR}/mods-available/sql" <<FR_SQL
sql {
    driver    = "rlm_sql_postgresql"
    dialect   = "postgresql"

    server    = "localhost"
    port      = 5432
    login     = "${DB_USER}"
    password  = "${DB_PASS}"
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

# Enable sql in authorize, accounting, and session sections of default and
# inner-tunnel using Python (deterministic; handles commented-out sql lines).
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
        # Match: section_name { ... } (non-greedy, handles nested braces by
        # stopping at the first top-level closing brace at column 0)
        pat = re.compile(
            rf'(\b{re.escape(section)}\b\s*\{{)(.*?)(^\}})',
            re.DOTALL | re.MULTILINE
        )
        def replacer(m, _sec=section):
            header, body, close = m.group(1), m.group(2), m.group(3)
            # Already has an uncommented sql line?
            if re.search(r'(?m)^[ \t]+sql\b', body):
                return m.group(0)
            # Remove any #-commented sql lines then append sql before closing
            body = re.sub(r'\n[ \t]*#[ \t]*sql\b[^\n]*', '', body)
            return header + body + '\tsql\n' + close
        text = pat.sub(replacer, text)

    if text != original:
        with open(path, 'w') as f:
            f.write(text)
        print(f"  enabled sql in authorize/accounting/session: {path}")
    else:
        print(f"  sql already enabled (or sections not found): {path}")

for path in sys.argv[1:]:
    enable_sql_in_sections(path, ['authorize', 'accounting', 'session'])
PYEOF
ok "FreeRADIUS default and inner-tunnel updated with sql"

# Validate config before restarting
freeradius -C -d "${FR_DIR}" 2>/dev/null && ok "FreeRADIUS config valid" || \
  info "FreeRADIUS config warning — check: freeradius -C -d ${FR_DIR}"

systemctl enable freeradius --quiet
systemctl restart freeradius
ok "FreeRADIUS running"

# ── OpenVPN PKI ───────────────────────────────────────────────────────────────
banner "OpenVPN"

EASYRSA_DIR="/etc/openvpn/netpulse-easy-rsa"
OVPN_DIR="/etc/openvpn/netpulse"
CONFIG_DIR="/etc/openvpn/server"
CONFIG_FILE="${CONFIG_DIR}/netpulse.conf"
mkdir -p /var/log/openvpn
mkdir -p "$OVPN_DIR" "$CONFIG_DIR"

if [[ ! -d "${EASYRSA_DIR}/pki" ]]; then
  info "Initialising PKI — CA, server cert, DH params (~2 min)..."

  # easy-rsa 3.x
  if command -v make-cadir &>/dev/null; then
    make-cadir "$EASYRSA_DIR"
  else
    cp -r /usr/share/easy-rsa "$EASYRSA_DIR"
  fi

  cat > "${EASYRSA_DIR}/vars" <<EASYRSA_VARS
set_var EASYRSA_BATCH        "yes"
set_var EASYRSA_REQ_CN       "NetPulse-CA"
set_var EASYRSA_REQ_COUNTRY  "KE"
set_var EASYRSA_REQ_PROVINCE "Nairobi"
set_var EASYRSA_REQ_CITY     "Nairobi"
set_var EASYRSA_REQ_ORG      "NetPulse ISP"
set_var EASYRSA_REQ_EMAIL    "admin@${NP_DOMAIN}"
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
  ok "PKI initialised"
else
  skip "PKI already initialised"
fi

# Copy PKI files into /etc/openvpn
cp -f "${EASYRSA_DIR}/pki/ca.crt"              "$OVPN_DIR/ca.crt"
cp -f "${EASYRSA_DIR}/pki/issued/server.crt"   "$OVPN_DIR/server.crt"
cp -f "${EASYRSA_DIR}/pki/private/server.key"  "$OVPN_DIR/server.key"
cp -f "${EASYRSA_DIR}/pki/dh.pem"              "$OVPN_DIR/dh.pem"
mkdir -p "${OVPN_DIR}/ccd"

if [[ ! -f "$CONFIG_FILE" ]]; then
  cat > "$CONFIG_FILE" <<OVPN_CONF
# Managed by NetPulse: RouterOS management VPN
port 1194
# RouterOS v6 OpenVPN clients support TCP only.
proto tcp-server
dev tun

ca   ${OVPN_DIR}/ca.crt
cert ${OVPN_DIR}/server.crt
key  ${OVPN_DIR}/server.key
dh   ${OVPN_DIR}/dh.pem
# RouterOS v6 clients cannot present a tls-auth static key.
# Client certificates remain required for every connection.

server 10.8.0.0 255.255.255.0
ifconfig-pool-persist /var/log/openvpn/netpulse-ipp.txt
client-config-dir ${OVPN_DIR}/ccd
crl-verify ${OVPN_DIR}/crl.pem
writepid /run/openvpn/netpulse-routeros.pid

keepalive 10 120
# RouterOS 6.49 supports only CBC ciphers and SHA1 for OpenVPN.
cipher AES-128-CBC
data-ciphers AES-128-CBC
data-ciphers-fallback AES-128-CBC
auth SHA1
max-clients 500

user  nobody
group nogroup
persist-key
persist-tun

status /var/log/openvpn/netpulse-status.log 60
log    /var/log/openvpn/netpulse-server.log
verb 3
OVPN_CONF
elif ! grep -Fxq "# Managed by NetPulse: RouterOS management VPN" "$CONFIG_FILE"; then
  err "Refusing to use unmarked $CONFIG_FILE. It may belong to another OpenVPN deployment."
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

systemctl enable openvpn-server@netpulse --quiet
systemctl restart openvpn-server@netpulse
ok "OpenVPN server running on TCP 1194"

# ── VPN management helpers ────────────────────────────────────────────────────
banner "VPN management helpers"

install -o root -g root -m 0755 "${NETPULSE_DIR}/deploy/repair-openvpn.sh" /usr/local/bin/netpulse-vpn-repair
ok "/usr/local/bin/netpulse-vpn-repair"
install -o root -g root -m 0755 "${NETPULSE_DIR}/deploy/read-openvpn-certificates.sh" /usr/local/bin/netpulse-vpn-read-certificates
ok "/usr/local/bin/netpulse-vpn-read-certificates"

cat > /usr/local/bin/netpulse-vpn-issue <<'VPN_ISSUE'
#!/usr/bin/env bash
# Usage: netpulse-vpn-issue <common-name>
# Prints the full .ovpn config to stdout
set -euo pipefail

CN="${1:-}"
[[ "$CN" =~ ^[a-zA-Z0-9_-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/netpulse-easy-rsa"
OVPN_DIR="/etc/openvpn/netpulse"

cd "$EASYRSA_DIR"
./easyrsa gen-req   "$CN" nopass 2>/dev/null
./easyrsa sign-req client "$CN"  2>/dev/null

# Detect public IP (fallback to hostname)
SERVER_IP=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

CA=$(cat "$OVPN_DIR/ca.crt")
CERT=$(openssl x509 -in "${EASYRSA_DIR}/pki/issued/${CN}.crt")
KEY=$(cat "${EASYRSA_DIR}/pki/private/${CN}.key")

cat <<OVPN
client
dev tun
proto tcp-client
remote ${SERVER_IP} 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-128-CBC
data-ciphers AES-128-CBC
data-ciphers-fallback AES-128-CBC
auth SHA1
verb 3
<ca>
${CA}
</ca>
<cert>
${CERT}
</cert>
<key>
${KEY}
</key>
OVPN
VPN_ISSUE
chmod 755 /usr/local/bin/netpulse-vpn-issue
ok "/usr/local/bin/netpulse-vpn-issue"

cat > /usr/local/bin/netpulse-vpn-revoke <<'VPN_REVOKE'
#!/usr/bin/env bash
# Usage: netpulse-vpn-revoke <common-name>
set -euo pipefail

CN="${1:-}"
[[ "$CN" =~ ^[a-zA-Z0-9_-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/netpulse-easy-rsa"
cd "$EASYRSA_DIR"
./easyrsa revoke "$CN" 2>/dev/null
./easyrsa gen-crl       2>/dev/null
cp -f "${EASYRSA_DIR}/pki/crl.pem" /etc/openvpn/netpulse/crl.pem
chmod 644 /etc/openvpn/netpulse/crl.pem
systemctl reload openvpn-server@netpulse
echo "Revoked $CN and reloaded OpenVPN CRL"
VPN_REVOKE
chmod 755 /usr/local/bin/netpulse-vpn-revoke
ok "/usr/local/bin/netpulse-vpn-revoke"

# Sudoers: allow netpulse user to run VPN helpers without password
echo "${NETPULSE_USER} ALL=(root) NOPASSWD: /usr/local/bin/netpulse-vpn-issue, /usr/local/bin/netpulse-vpn-revoke, /usr/local/bin/netpulse-vpn-repair, /usr/local/bin/netpulse-vpn-read-certificates" \
  > /etc/sudoers.d/netpulse-vpn
chmod 440 /etc/sudoers.d/netpulse-vpn
visudo -cf /etc/sudoers.d/netpulse-vpn >/dev/null || err "Could not validate the NetPulse VPN sudo rule."
ok "sudoers rule for VPN helpers"

# ── Firewall ──────────────────────────────────────────────────────────────────
banner "Firewall (ufw)"

ufw --force reset   >/dev/null
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp    comment "SSH"            >/dev/null
ufw allow 80/tcp    comment "HTTP"           >/dev/null
ufw allow 443/tcp   comment "HTTPS"          >/dev/null
ufw allow 1194/tcp  comment "OpenVPN"        >/dev/null
ufw allow 1812/udp  comment "RADIUS auth"    >/dev/null
ufw allow 1813/udp  comment "RADIUS acct"    >/dev/null
ufw --force enable  >/dev/null
ok "Firewall active (22, 80, 443, 1194/tcp, 1812-1813/udp)"

# ── Post-install summary ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗"
echo -e "║        NetPulse ISP Manager — Installation Complete       ║"
echo -e "╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

APP_URL="https://${NP_DOMAIN}"

echo -e "  ${BOLD}App URL:${RESET}           ${APP_URL}/"
echo -e "  ${BOLD}API endpoint:${RESET}      ${APP_URL}/api"
echo ""
echo -e "  ${BOLD}Services:${RESET}"
printf  "    netpulse-api    %s\n"  "$(systemctl is-active netpulse-api)"
printf  "    netpulse-web    %s\n"  "$(systemctl is-active netpulse-web)"
printf  "    nginx           %s\n"  "$(systemctl is-active nginx)"
printf  "    freeradius      %s\n"  "$(systemctl is-active freeradius)"
printf  "    openvpn-server@netpulse  %s\n"  "$(systemctl is-active openvpn-server@netpulse)"
printf  "    postgresql      %s\n"  "$(systemctl is-active postgresql || systemctl is-active "postgresql@${PG_VER}-main")"
echo ""
echo -e "  ${BOLD}Config:${RESET}            ${NETPULSE_DIR}/.env"
echo -e "  ${BOLD}Logs:${RESET}              journalctl -u netpulse-api -f"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "    1. Open ${APP_URL}/ and create your first admin account"
echo -e "    2. Add your first router in Settings → Network"
echo -e "    3. Configure SMTP in Settings → Email"
echo -e "    4. Point your NAS devices at this server (RADIUS port 1812)"
echo ""
echo -e "  ${BOLD}Upgrade:${RESET}           sudo bash ${NETPULSE_DIR}/install.sh --upgrade"
echo -e "  ${BOLD}Uninstall:${RESET}         sudo bash ${NETPULSE_DIR}/install.sh --uninstall"
echo ""
