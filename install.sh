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
#    sudo bash install.sh --uninstall
# =============================================================================
set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────
NETPULSE_DIR="/opt/netpulse"
NETPULSE_USER="netpulse"
DB_NAME="netpulse"
DB_USER="netpulse"
API_PORT="5000"
REPO_URL="https://github.com/jamboso/NetPulse-ISP.git"
NODE_VERSION="24"
PNPM_VERSION="10"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

banner()  { echo -e "\n${CYAN}${BOLD}══ $* ══${RESET}"; }
ok()      { echo -e "  ${GREEN}✓${RESET} $*"; }
info()    { echo -e "  ${YELLOW}→${RESET} $*"; }
err()     { echo -e "  ${RED}✗ ERROR:${RESET} $*" >&2; exit 1; }
skip()    { echo -e "  ${YELLOW}↷${RESET} $* (already done — skipping)"; }

# ── Uninstall ─────────────────────────────────────────────────────────────────
uninstall() {
  banner "NetPulse Uninstaller"
  read -rp "  This will remove NetPulse, FreeRADIUS config, and OpenVPN. Continue? [y/N] " CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

  systemctl stop  netpulse-api netpulse-web freeradius openvpn@server 2>/dev/null || true
  systemctl disable netpulse-api netpulse-web 2>/dev/null || true

  rm -f /etc/systemd/system/netpulse-api.service
  rm -f /etc/systemd/system/netpulse-web.service
  systemctl daemon-reload

  rm -f /etc/nginx/sites-enabled/netpulse
  rm -f /etc/nginx/sites-available/netpulse
  nginx -s reload 2>/dev/null || true

  rm -rf "$NETPULSE_DIR"
  rm -f /usr/local/bin/netpulse-vpn-issue
  rm -f /usr/local/bin/netpulse-vpn-revoke

  id -u "$NETPULSE_USER" &>/dev/null && userdel "$NETPULSE_USER" || true

  echo ""
  ok "NetPulse uninstalled. PostgreSQL data, FreeRADIUS, and OpenVPN packages were left in place."
  echo "  Run: sudo apt-get remove --purge freeradius* openvpn easy-rsa postgresql*"
  echo "  And: sudo -u postgres dropdb $DB_NAME && sudo -u postgres dropuser $DB_USER"
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

# ── Preflight ─────────────────────────────────────────────────────────────────
banner "Preflight"

[[ "$(id -u)" -eq 0 ]] || err "Must run as root. Use: sudo bash install.sh"

. /etc/os-release 2>/dev/null || err "Cannot read /etc/os-release"
[[ "$ID" == "ubuntu" ]] || err "Only Ubuntu is supported (detected: $ID)"
[[ "$VERSION_ID" == "22.04" || "$VERSION_ID" == "24.04" ]] || \
  err "Requires Ubuntu 22.04 or 24.04 (detected: $VERSION_ID)"
ok "Ubuntu $VERSION_ID detected"

# Prompt for config values
read -rp "  Domain / IP for this server (e.g. isp.example.com or 192.168.1.10): " NP_DOMAIN
NP_DOMAIN="${NP_DOMAIN:-localhost}"

BETTER_AUTH_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)
DB_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

ok "Generated random secrets (stored in $NETPULSE_DIR/.env)"

# ── System packages ───────────────────────────────────────────────────────────
banner "System packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Node.js via NodeSource
if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  info "Installing Node.js $NODE_VERSION..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
  ok "Node.js $(node --version)"
else
  skip "Node.js $(node --version)"
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g "pnpm@$PNPM_VERSION" --quiet
  ok "pnpm $(pnpm --version)"
else
  skip "pnpm $(pnpm --version)"
fi

# Core packages
PKGS=(git nginx postgresql postgresql-client freeradius freeradius-postgresql
      freeradius-utils openvpn easy-rsa certbot python3-certbot-nginx ufw curl)
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
PG_HBA="/etc/postgresql/${PG_VER}/main/pg_hba.conf"

systemctl is-active postgresql &>/dev/null || systemctl start postgresql
systemctl enable postgresql --quiet

# Create DB user
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  info "Creating DB user $DB_USER..."
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  ok "DB user created"
else
  # Update password in case it changed
  sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" >/dev/null
  skip "DB user $DB_USER"
fi

# Create database
if ! sudo -u postgres psql -lqt | cut -d\| -f1 | grep -qw "$DB_NAME"; then
  info "Creating database $DB_NAME..."
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  ok "Database $DB_NAME created"
else
  skip "Database $DB_NAME"
fi

# Apply FreeRADIUS schema (idempotent: skip if radcheck exists)
FR_SCHEMA="/etc/freeradius/3.0/mods-config/sql/main/postgresql/schema.sql"
if [[ -f "$FR_SCHEMA" ]]; then
  if ! sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='radcheck'" | grep -q 1; then
    info "Applying FreeRADIUS schema..."
    sudo -u postgres psql -d "$DB_NAME" -f "$FR_SCHEMA" >/dev/null
    # Extra table for NAS secrets
    sudo -u postgres psql -d "$DB_NAME" <<'SQL'
      CREATE TABLE IF NOT EXISTS radnas (
        id        SERIAL PRIMARY KEY,
        nasname   INET          NOT NULL UNIQUE,
        shortname VARCHAR(32),
        secret    VARCHAR(64)   NOT NULL,
        created_at TIMESTAMPTZ  DEFAULT NOW()
      );
      GRANT ALL ON radnas TO netpulse;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO netpulse;
SQL
    ok "FreeRADIUS schema applied"
  else
    skip "FreeRADIUS schema"
  fi
fi

# Grant permissions on all tables
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;" >/dev/null
sudo -u postgres psql -d "$DB_NAME" -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;" >/dev/null
ok "DB permissions granted"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

# ── Application ───────────────────────────────────────────────────────────────
banner "NetPulse Application"

# System user
id -u "$NETPULSE_USER" &>/dev/null || useradd -r -m -s /bin/bash "$NETPULSE_USER"
ok "System user $NETPULSE_USER"

# Clone / update repo
if [[ -d "$NETPULSE_DIR/.git" ]]; then
  info "Updating existing repo..."
  git -C "$NETPULSE_DIR" fetch origin main --quiet
  git -C "$NETPULSE_DIR" reset --hard origin/main --quiet
  ok "Repo updated"
else
  info "Cloning repo..."
  git clone --depth=1 "$REPO_URL" "$NETPULSE_DIR" --quiet
  ok "Repo cloned to $NETPULSE_DIR"
fi

# Write .env
BETTER_AUTH_URL="http${NP_DOMAIN:+s}://${NP_DOMAIN}/api"
[[ "$NP_DOMAIN" == "localhost" || "$NP_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && \
  BETTER_AUTH_URL="http://${NP_DOMAIN}/api"

cat > "$NETPULSE_DIR/.env" <<ENV
NODE_ENV=production
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${BETTER_AUTH_URL}
SESSION_SECRET=${SESSION_SECRET}
OPENVPN_ENABLED=true
OPENVPN_EASY_RSA_DIR=/etc/openvpn/easy-rsa
ENV
chmod 600 "$NETPULSE_DIR/.env"
chown "$NETPULSE_USER:$NETPULSE_USER" "$NETPULSE_DIR/.env"
ok ".env written"

# Install dependencies + build
info "Installing pnpm dependencies (this may take a few minutes)..."
cd "$NETPULSE_DIR"
sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" pnpm install --frozen-lockfile --silent
ok "Dependencies installed"

info "Building API server..."
sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" \
  env NODE_ENV=production \
  pnpm --filter @workspace/api-server run build --silent
ok "API server built"

info "Building frontend..."
sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" \
  env NODE_ENV=production PORT=3000 BASE_PATH=/ \
  pnpm --filter @workspace/isp-portal run build --silent
ok "Frontend built"

info "Running database migrations..."
sudo -u "$NETPULSE_USER" HOME="/home/$NETPULSE_USER" \
  env DATABASE_URL="$DATABASE_URL" \
  pnpm --filter @workspace/db run push --force
ok "Database migrations applied"

chown -R "$NETPULSE_USER:$NETPULSE_USER" "$NETPULSE_DIR"

# ── Systemd services ──────────────────────────────────────────────────────────
banner "Systemd services"

cat > /etc/systemd/system/netpulse-api.service <<UNIT
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
UNIT

systemctl daemon-reload
systemctl enable netpulse-api --quiet
systemctl restart netpulse-api
ok "netpulse-api service started"

# Wait for API to be up
info "Waiting for API to respond..."
for i in $(seq 1 20); do
  curl -sf "http://localhost:${API_PORT}/api/healthz" >/dev/null 2>&1 && break
  sleep 2
done
curl -sf "http://localhost:${API_PORT}/api/healthz" >/dev/null 2>&1 && ok "API healthz OK" || \
  info "API not yet responding — check: journalctl -u netpulse-api -n 50"

# ── Nginx ─────────────────────────────────────────────────────────────────────
banner "Nginx"

FRONTEND_DIR="${NETPULSE_DIR}/artifacts/isp-portal/dist/public"

cat > /etc/nginx/sites-available/netpulse <<NGINX
server {
    listen 80;
    server_name ${NP_DOMAIN};

    # API — proxy to Express
    location /api/ {
        proxy_pass         http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    # Frontend — static files
    location / {
        root  ${FRONTEND_DIR};
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
ln -sf /etc/nginx/sites-available/netpulse /etc/nginx/sites-enabled/netpulse
nginx -t -q && systemctl reload nginx
ok "Nginx configured and reloaded"

# Optional: TLS via certbot (skip if localhost or bare IP)
if [[ "$NP_DOMAIN" != "localhost" && ! "$NP_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  info "Obtaining TLS certificate for $NP_DOMAIN..."
  certbot --nginx -d "$NP_DOMAIN" --non-interactive --agree-tos \
    --email "admin@${NP_DOMAIN}" --redirect --quiet && ok "TLS certificate obtained" || \
    info "TLS setup skipped (DNS not resolving yet?) — run: certbot --nginx -d $NP_DOMAIN"
fi

# ── FreeRADIUS ────────────────────────────────────────────────────────────────
banner "FreeRADIUS"

FR_DIR="/etc/freeradius/3.0"

# Enable SQL module
if [[ ! -L "${FR_DIR}/mods-enabled/sql" ]]; then
  ln -s "${FR_DIR}/mods-available/sql" "${FR_DIR}/mods-enabled/sql"
fi

# Configure SQL module for PostgreSQL
cat > "${FR_DIR}/mods-available/sql" <<'FR_SQL'
sql {
    driver = "rlm_sql_postgresql"
    dialect = "postgresql"

    server = "localhost"
    port = 5432
    login = "PLACEHOLDER_USER"
    password = "PLACEHOLDER_PASS"
    radius_db = "PLACEHOLDER_DB"

    acct_table1     = "radacct"
    acct_table2     = "radacct"
    postauth_table  = "radpostauth"
    authcheck_table = "radcheck"
    groupcheck_table = "radgroupcheck"
    authreply_table  = "radreply"
    groupreply_table = "radgroupreply"
    usergroup_table  = "radusergroup"
    delete_stale_sessions = yes

    pool {
        start = 5
        min   = 4
        max   = 32
        spare = 3
        uses  = 0
        lifetime   = 0
        idle_timeout = 60
    }

    client_table = "radnas"
    read_clients = yes
}
FR_SQL

sed -i "s/PLACEHOLDER_USER/${DB_USER}/g" "${FR_DIR}/mods-available/sql"
sed -i "s/PLACEHOLDER_PASS/${DB_PASS}/g" "${FR_DIR}/mods-available/sql"
sed -i "s/PLACEHOLDER_DB/${DB_NAME}/g"   "${FR_DIR}/mods-available/sql"

# Enable sql in authorize / accounting / session in default virtual server
for SECTION in authorize accounting session; do
  if ! grep -q "^[[:space:]]*sql$" "${FR_DIR}/sites-available/default" 2>/dev/null; then
    sed -i "/^${SECTION}[[:space:]]*{/,/^}/ s/#[[:space:]]*sql/\tsql/" \
      "${FR_DIR}/sites-available/default" 2>/dev/null || true
  fi
done

# inner-tunnel — enable sql in authorize
sed -i 's/#[[:space:]]*sql/\tsql/' "${FR_DIR}/sites-available/inner-tunnel" 2>/dev/null || true

# FreeRADIUS needs to read the DB socket — add to postgres group
usermod -aG ssl-cert freerad 2>/dev/null || true

systemctl enable freeradius --quiet
systemctl restart freeradius
ok "FreeRADIUS configured and restarted"

# ── OpenVPN PKI ───────────────────────────────────────────────────────────────
banner "OpenVPN"

EASYRSA_DIR="/etc/openvpn/easy-rsa"
OVPN_DIR="/etc/openvpn"

if [[ ! -d "$EASYRSA_DIR/pki" ]]; then
  info "Initialising PKI (this takes ~2 minutes for DH params)..."
  make-cadir "$EASYRSA_DIR" 2>/dev/null || cp -r /usr/share/easy-rsa "$EASYRSA_DIR"
  cd "$EASYRSA_DIR"

  # easy-rsa vars
  cat > "$EASYRSA_DIR/vars" <<EASYRSA_VARS
set_var EASYRSA_BATCH         "yes"
set_var EASYRSA_REQ_CN        "NetPulse-CA"
set_var EASYRSA_REQ_COUNTRY   "KE"
set_var EASYRSA_REQ_PROVINCE  "Nairobi"
set_var EASYRSA_REQ_CITY      "Nairobi"
set_var EASYRSA_REQ_ORG       "NetPulse ISP"
set_var EASYRSA_REQ_EMAIL     "admin@${NP_DOMAIN}"
set_var EASYRSA_REQ_OU        "ISP"
set_var EASYRSA_KEY_SIZE      2048
set_var EASYRSA_CA_EXPIRE     3650
set_var EASYRSA_CERT_EXPIRE   825
EASYRSA_VARS

  ./easyrsa init-pki
  ./easyrsa build-ca nopass
  ./easyrsa gen-req server nopass
  ./easyrsa sign-req server server
  ./easyrsa gen-dh
  openvpn --genkey secret "$EASYRSA_DIR/pki/ta.key"
  ok "PKI initialised"
else
  skip "PKI already initialised"
fi

cd "$OVPN_DIR"
cp -f "$EASYRSA_DIR/pki/ca.crt"                   "$OVPN_DIR/ca.crt"
cp -f "$EASYRSA_DIR/pki/issued/server.crt"         "$OVPN_DIR/server.crt"
cp -f "$EASYRSA_DIR/pki/private/server.key"        "$OVPN_DIR/server.key"
cp -f "$EASYRSA_DIR/pki/dh.pem"                    "$OVPN_DIR/dh.pem"
cp -f "$EASYRSA_DIR/pki/ta.key"                    "$OVPN_DIR/ta.key"

mkdir -p "$OVPN_DIR/ccd"

if [[ ! -f "$OVPN_DIR/server.conf" ]]; then
  cat > "$OVPN_DIR/server.conf" <<OVPN_CONF
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

status /var/log/openvpn/status.log
log    /var/log/openvpn/openvpn.log
verb 3
OVPN_CONF
fi

mkdir -p /var/log/openvpn
systemctl enable openvpn@server --quiet
systemctl restart openvpn@server
ok "OpenVPN server running on UDP 1194"

# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
sysctl -p --quiet
ok "IP forwarding enabled"

# ── VPN management helpers ────────────────────────────────────────────────────
banner "VPN management helpers"

cat > /usr/local/bin/netpulse-vpn-issue <<'VPN_ISSUE'
#!/usr/bin/env bash
# Usage: netpulse-vpn-issue <common-name>
# Prints the full .ovpn config to stdout
set -euo pipefail

CN="${1:-}"
[[ "$CN" =~ ^[a-zA-Z0-9_-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/easy-rsa"
OVPN_DIR="/etc/openvpn"

cd "$EASYRSA_DIR"
./easyrsa gen-req "$CN" nopass
./easyrsa sign-req client "$CN"

SERVER_IP=$(curl -sf https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

CA=$(cat "$OVPN_DIR/ca.crt")
CERT=$(openssl x509 -in "$EASYRSA_DIR/pki/issued/${CN}.crt")
KEY=$(cat "$EASYRSA_DIR/pki/private/${CN}.key")
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
[[ "$CN" =~ ^[a-zA-Z0-9_-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/easy-rsa"
cd "$EASYRSA_DIR"

./easyrsa revoke "$CN"
./easyrsa gen-crl
cp -f "$EASYRSA_DIR/pki/crl.pem" /etc/openvpn/crl.pem
chmod 644 /etc/openvpn/crl.pem
systemctl reload openvpn@server
echo "Revoked $CN and reloaded OpenVPN CRL"
VPN_REVOKE
chmod 755 /usr/local/bin/netpulse-vpn-revoke
ok "/usr/local/bin/netpulse-vpn-revoke"

# Allow API server (netpulse user) to run helpers as root via sudoers
SUDOERS_LINE="${NETPULSE_USER} ALL=(root) NOPASSWD: /usr/local/bin/netpulse-vpn-issue, /usr/local/bin/netpulse-vpn-revoke"
echo "$SUDOERS_LINE" > /etc/sudoers.d/netpulse-vpn
chmod 440 /etc/sudoers.d/netpulse-vpn
ok "sudoers rule for VPN helpers"

# ── Firewall ──────────────────────────────────────────────────────────────────
banner "Firewall (ufw)"

ufw --force reset >/dev/null
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp   comment "SSH"       >/dev/null
ufw allow 80/tcp   comment "HTTP"      >/dev/null
ufw allow 443/tcp  comment "HTTPS"     >/dev/null
ufw allow 1194/udp comment "OpenVPN"   >/dev/null
ufw allow 1812/udp comment "RADIUS"    >/dev/null
ufw allow 1813/udp comment "RADIUS acct" >/dev/null
ufw --force enable >/dev/null
ok "Firewall active (22, 80, 443, 1194/udp, 1812-1813/udp)"

# ── Post-install summary ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗"
echo -e "║          NetPulse ISP Manager — Installation Complete     ║"
echo -e "╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

PROTO="http"
[[ "$NP_DOMAIN" != "localhost" && ! "$NP_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && PROTO="https"

echo -e "  ${BOLD}Admin URL:${RESET}        ${PROTO}://${NP_DOMAIN}/"
echo -e "  ${BOLD}API endpoint:${RESET}     ${PROTO}://${NP_DOMAIN}/api"
echo ""
echo -e "  ${BOLD}First login:${RESET}"
echo -e "    Go to ${PROTO}://${NP_DOMAIN}/ and use the setup page"
echo -e "    to create your first admin account."
echo ""
echo -e "  ${BOLD}Services:${RESET}"
echo -e "    netpulse-api   $(systemctl is-active netpulse-api)"
echo -e "    nginx          $(systemctl is-active nginx)"
echo -e "    freeradius     $(systemctl is-active freeradius)"
echo -e "    openvpn@server $(systemctl is-active openvpn@server)"
echo -e "    postgresql     $(systemctl is-active postgresql)"
echo ""
echo -e "  ${BOLD}Config file:${RESET}      ${NETPULSE_DIR}/.env"
echo -e "  ${BOLD}App directory:${RESET}    ${NETPULSE_DIR}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "    1. Create your admin account at the URL above"
echo -e "    2. Add your first router in Settings → Network"
echo -e "    3. Configure SMTP in Settings → Email for notifications"
echo -e "    4. Point your NAS devices at this server for RADIUS (port 1812)"
echo -e "       and add the NAS secret in Settings → RADIUS"
echo ""
echo -e "  ${BOLD}Uninstall:${RESET}        sudo bash ${NETPULSE_DIR}/install.sh --uninstall"
echo -e "  ${BOLD}Logs:${RESET}             journalctl -u netpulse-api -f"
echo ""
