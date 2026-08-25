#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  NetPulse ISP Manager — Enable OpenVPN (post-install)                        ║
# ║                                                                              ║
# ║  Run this if you skipped OpenVPN during initial setup.                       ║
# ║  Sets up a full PKI, OpenVPN server on TCP 1194, and wires the               ║
# ║  cert-issue/revoke helpers used by the NetPulse dashboard.                   ║
# ║                                                                              ║
# ║  Usage: sudo bash /opt/netpulse/deploy/enable-vpn.sh                         ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

APP_DIR="${NETPULSE_DIR:-/opt/netpulse}"
EASYRSA_DIR="/etc/openvpn/netpulse-easy-rsa"
OVPN_DIR="/etc/openvpn/netpulse"
CONFIG_DIR="/etc/openvpn/server"
CONFIG_FILE="${CONFIG_DIR}/netpulse.conf"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "  ${RED}✗  $*${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo bash $0"
[[ "$(stat -c '%U:%a' "$APP_DIR/deploy" 2>/dev/null || true)" == "root:755" ]] \
  || die "NetPulse deployment scripts are not root-owned. Run the verified production updater before enabling VPN."
[[ "$(stat -c '%U' "$APP_DIR/deploy/repair-openvpn.sh" 2>/dev/null || true)" == "root" ]] \
  || die "VPN repair helper source is not root-owned."

echo ""
echo -e "${BOLD}NetPulse — Enable OpenVPN — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo "──────────────────────────────────────────"
echo ""

# ── 1. Install packages ────────────────────────────────────────────────────────
info "Installing openvpn + easy-rsa..."
apt-get update -qq
apt-get install -y -qq openvpn easy-rsa
ok "Packages installed"

# ── 2. Initialise PKI (skip if already done) ──────────────────────────────────
mkdir -p /var/log/openvpn "$OVPN_DIR" "$CONFIG_DIR"

if [[ ! -d "${EASYRSA_DIR}/pki" ]]; then
  info "Initialising PKI — CA, server cert, DH params (~2 min)..."
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
set_var EASYRSA_REQ_EMAIL    "admin@netpulse.local"
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
  info "PKI already exists — skipping init"
fi

# ── 3. Copy PKI files into NetPulse's dedicated directory ─────────────────────
cp -f "${EASYRSA_DIR}/pki/ca.crt"             "$OVPN_DIR/ca.crt"
cp -f "${EASYRSA_DIR}/pki/issued/server.crt"  "$OVPN_DIR/server.crt"
cp -f "${EASYRSA_DIR}/pki/private/server.key" "$OVPN_DIR/server.key"
cp -f "${EASYRSA_DIR}/pki/dh.pem"             "$OVPN_DIR/dh.pem"
mkdir -p "${OVPN_DIR}/ccd"
ok "PKI files copied"

# ── 4. Write server config ────────────────────────────────────────────────────
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
  ok "Dedicated NetPulse server config written"
elif ! grep -Fxq "# Managed by NetPulse: RouterOS management VPN" "$CONFIG_FILE"; then
  die "Refusing to use unmarked $CONFIG_FILE. It may belong to another OpenVPN deployment."
else
  info "Dedicated NetPulse server config already exists — skipping"
fi

# ── 5. Initial CRL ────────────────────────────────────────────────────────────
if [[ ! -f "${OVPN_DIR}/crl.pem" ]]; then
  cd "$EASYRSA_DIR"
  ./easyrsa gen-crl
  cp -f "${EASYRSA_DIR}/pki/crl.pem" "${OVPN_DIR}/crl.pem"
  chmod 644 "${OVPN_DIR}/crl.pem"
  ok "CRL generated"
fi

# ── 6. IP forwarding ──────────────────────────────────────────────────────────
echo 1 > /proc/sys/net/ipv4/ip_forward
sed -i 's|^#*net.ipv4.ip_forward.*|net.ipv4.ip_forward=1|' /etc/sysctl.conf
sysctl -p --quiet
ok "IP forwarding enabled"

# ── 7. Start OpenVPN ──────────────────────────────────────────────────────────
systemctl enable openvpn-server@netpulse --quiet
if systemctl restart openvpn-server@netpulse 2>/tmp/ovpn_start.err; then
  ok "OpenVPN server running on TCP 1194"
else
  warn "OpenVPN failed to start — check: journalctl -u openvpn-server@netpulse"
  head -10 /tmp/ovpn_start.err >&2 || true
fi

# ── 8. Write VPN helpers ──────────────────────────────────────────────────────
install -o root -g root -m 0755 "$APP_DIR/deploy/repair-openvpn.sh" /usr/local/bin/netpulse-vpn-repair
ok "netpulse-vpn-repair helper installed"

cat > /usr/local/bin/netpulse-vpn-issue <<'VPN_ISSUE'
#!/usr/bin/env bash
# Usage: netpulse-vpn-issue <common-name>
# Prints the full .ovpn config to stdout
set -euo pipefail

CN="${1:-}"
[[ "$CN" =~ ^[a-zA-Z0-9_.-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/netpulse-easy-rsa"
OVPN_DIR="/etc/openvpn/netpulse"

cd "$EASYRSA_DIR"
./easyrsa gen-req   "$CN" nopass 2>/dev/null
./easyrsa sign-req client "$CN"  2>/dev/null

SERVER_IP=$(hostname -I | awk '{print $1}')

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
ok "netpulse-vpn-issue helper installed"

# ── 9. Write cert-revoke helper ───────────────────────────────────────────────
cat > /usr/local/bin/netpulse-vpn-revoke <<'VPN_REVOKE'
#!/usr/bin/env bash
# Usage: netpulse-vpn-revoke <common-name>
set -euo pipefail

CN="${1:-}"
[[ "$CN" =~ ^[a-zA-Z0-9_.-]{2,64}$ ]] || { echo "Invalid CN: $CN" >&2; exit 1; }

EASYRSA_DIR="/etc/openvpn/netpulse-easy-rsa"
cd "$EASYRSA_DIR"
./easyrsa revoke "$CN" 2>/dev/null
./easyrsa gen-crl       2>/dev/null
cp -f "${EASYRSA_DIR}/pki/crl.pem" /etc/openvpn/netpulse/crl.pem
chmod 644 /etc/openvpn/netpulse/crl.pem
systemctl reload openvpn-server@netpulse
echo "Revoked $CN and reloaded CRL"
VPN_REVOKE
chmod 755 /usr/local/bin/netpulse-vpn-revoke
ok "netpulse-vpn-revoke helper installed"

# ── 10. Sudoers rule (API runs as non-root, helpers need root) ────────────────
REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
echo "${REAL_USER} ALL=(root) NOPASSWD: /usr/local/bin/netpulse-vpn-issue, /usr/local/bin/netpulse-vpn-revoke, /usr/local/bin/netpulse-vpn-repair" \
  > /etc/sudoers.d/netpulse-vpn
chmod 440 /etc/sudoers.d/netpulse-vpn
visudo -cf /etc/sudoers.d/netpulse-vpn >/dev/null || die "Could not validate the NetPulse VPN sudo rule."
ok "Sudoers rule written for ${REAL_USER}"

# ── 11. Open firewall port ────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow 1194/tcp comment "OpenVPN" >/dev/null 2>&1 || true
  ok "Firewall: TCP 1194 open"
fi

# ── 12. Enable in .env and restart app ───────────────────────────────────────
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q "OPENVPN_ENABLED" "$ENV_FILE"; then
    sed -i 's/^OPENVPN_ENABLED=.*/OPENVPN_ENABLED=true/' "$ENV_FILE"
  else
    echo "OPENVPN_ENABLED=true" >> "$ENV_FILE"
  fi
  ok "OPENVPN_ENABLED=true set in .env"
fi

# Restart as real user
REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
sudo -u "$REAL_USER" pm2 restart netpulse 2>/dev/null || true
ok "NetPulse restarted"

echo ""
echo -e "${GREEN}${BOLD}✓ OpenVPN is ready!${NC}"
echo ""
echo -e "  What to do next:"
echo -e "  ${CYAN}1.${NC} Go to NetPulse → Customer detail page → VPN tab"
echo -e "  ${CYAN}2.${NC} Click 'Issue VPN Config' — downloads a .ovpn file and a .rsc script"
echo -e "  ${CYAN}3.${NC} On your MikroTik: open Terminal and import the .rsc file"
echo -e "       /import file=netpulse-vpn-router-<id>.rsc"
echo -e "  ${CYAN}4.${NC} The router will connect to this server on TCP 1194 automatically"
echo ""
echo -e "  Server VPN subnet: ${CYAN}10.8.0.0/24${NC}  (routers get IPs in this range)"
echo -e "  OpenVPN log:       ${CYAN}sudo journalctl -u openvpn-server@netpulse -f${NC}"
echo ""
