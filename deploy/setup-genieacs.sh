#!/usr/bin/env bash
# NetPulse — idempotent GenieACS single-server installer
#
# Run on the existing Ubuntu control-plane server as root:
#   sudo bash /opt/netpulse/deploy/setup-genieacs.sh
#
# This script deliberately does not install NetPulse, alter PostgreSQL, or
# replace the existing nginx virtual host. It installs GenieACS beside the
# application and adds a dedicated, authenticated ACS virtual host.
set -euo pipefail

GENIEACS_VERSION="${GENIEACS_VERSION:-1.2.16}"
ACS_DOMAIN="${GENIEACS_DOMAIN:-acs.netpulse.co.ke}"
CWMP_PORT="${GENIEACS_CWMP_PORT:-7547}"
NBI_PORT="${GENIEACS_NBI_PORT:-7557}"
FS_PORT="${GENIEACS_FS_PORT:-7567}"
UI_PORT="${GENIEACS_UI_PORT:-3001}"
MONGODB_MAJOR="${GENIEACS_MONGODB_MAJOR:-8.0}"
CWMP_ALLOWED_CIDRS="${GENIEACS_CWMP_ALLOWED_CIDRS:-}"
GENIEACS_DIR="/opt/genieacs"
GENIEACS_ENV="/etc/genieacs/genieacs.env"
GENIEACS_CREDENTIALS="/etc/genieacs/nbi-credentials"
GENIEACS_HTPASSWD="/etc/nginx/genieacs-nbi.htpasswd"
GENIEACS_NGINX="/etc/nginx/sites-available/genieacs-nbi"
GENIEACS_NGINX_LINK="/etc/nginx/sites-enabled/genieacs-nbi"
CERTBOT_WEBROOT="/var/www/certbot"
LOG_DIR="/var/log/genieacs"
NGINX_BACKUP_DIR=""
NGINX_COMMITTED=false
INSTALL_COMMITTED=false
GENIEACS_PREEXISTING=false
CWMP_ALLOW_RULES_APPLIED=false
FIREWALL_TRANSACTION_OPEN=false
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib/genieacs-firewall.sh
source "${SCRIPT_DIR}/lib/genieacs-firewall.sh"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Cannot identify the operating system." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This installer supports Ubuntu only (found ${PRETTY_NAME:-unknown})." >&2
  exit 1
fi
if [[ "${VERSION_ID%%.*}" -lt 22 ]]; then
  echo "Ubuntu 22.04 or newer is required (found ${VERSION_ID:-unknown})." >&2
  exit 1
fi

if [[ ! "${ACS_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ || "${ACS_DOMAIN}" == .* || "${ACS_DOMAIN}" == *..* ]]; then
  echo "GENIEACS_DOMAIN must be a hostname such as acs.netpulse.co.ke." >&2
  exit 1
fi
if [[ ! "${CWMP_PORT}" =~ ^[0-9]+$ || ! "${NBI_PORT}" =~ ^[0-9]+$ || ! "${FS_PORT}" =~ ^[0-9]+$ || ! "${UI_PORT}" =~ ^[0-9]+$ ]]; then
  echo "GenieACS ports must be numeric." >&2
  exit 1
fi
for port in "${CWMP_PORT}" "${NBI_PORT}" "${FS_PORT}" "${UI_PORT}"; do
  (( port >= 1 && port <= 65535 )) || { echo "GenieACS ports must be between 1 and 65535." >&2; exit 1; }
done
if [[ "${CWMP_PORT}" == "${NBI_PORT}" || "${CWMP_PORT}" == "${FS_PORT}" || "${CWMP_PORT}" == "${UI_PORT}" || "${NBI_PORT}" == "${FS_PORT}" || "${NBI_PORT}" == "${UI_PORT}" || "${FS_PORT}" == "${UI_PORT}" ]]; then
  echo "CWMP, NBI, file-server, and UI ports must be distinct." >&2
  exit 1
fi

log()  { printf '  → %s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

cleanup_unfinished_install() {
  if [[ -n "${NGINX_BACKUP_DIR}" && "${NGINX_COMMITTED}" != "true" ]]; then
    rm -f "${GENIEACS_NGINX_LINK}"
    if [[ -f "${NGINX_BACKUP_DIR}/site" ]]; then
      cp -a "${NGINX_BACKUP_DIR}/site" "${GENIEACS_NGINX}"
    else
      rm -f "${GENIEACS_NGINX}"
    fi
    if [[ -f "${NGINX_BACKUP_DIR}/link-target" ]]; then
      ln -s "$(cat "${NGINX_BACKUP_DIR}/link-target")" "${GENIEACS_NGINX_LINK}"
    fi
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
  fi
  [[ -n "${NGINX_BACKUP_DIR}" ]] && rm -rf "${NGINX_BACKUP_DIR}"

  if [[ "${FIREWALL_TRANSACTION_OPEN:-false}" == "true" ]]; then
    # Never remove the candidate protection while a public CWMP listener is
    # running. On a failed rerun, restore the preexisting service after its
    # original firewall state is back in place.
    firewall_rollback_around_cwmp_service "${GENIEACS_PREEXISTING}"
  fi
  if [[ "${INSTALL_COMMITTED}" != "true" && "${GENIEACS_PREEXISTING}" != "true" ]]; then
    for service in genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui; do
      systemctl disable --now "${service}" >/dev/null 2>&1 || true
    done
  fi
}
trap cleanup_unfinished_install EXIT

if [[ ! -d /opt/netpulse || ! -f /opt/netpulse/.env ]]; then
  die "The existing NetPulse installation at /opt/netpulse was not found."
fi
if [[ ! -x /usr/sbin/nginx && ! -x /usr/sbin/nginx-debug ]]; then
  die "nginx must already be installed for the shared HTTPS endpoint."
fi

if ! command -v systemctl >/dev/null 2>&1; then
  die "systemd is required."
fi
if [[ -f "${GENIEACS_ENV}" || -f /etc/systemd/system/genieacs-cwmp.service ]]; then
  GENIEACS_PREEXISTING=true
fi

# Update exactly one application environment key while preserving comments,
# ordering, and every unrelated secret/value in the existing .env.
upsert_env_key() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ ("^" key "=") {
      if (!replaced) {
        print key "=" value
        replaced = 1
      }
      next
    }
    { print }
    END {
      if (!replaced) print key "=" value
    }
  ' "$file" > "$tmp"
  chmod --reference="$file" "$tmp"
  chown --reference="$file" "$tmp"
  mv "$tmp" "$file"
}

read_credential_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "${GENIEACS_CREDENTIALS}"
}

check_listener_conflict() {
  local port="$1" expected="$2"
  if command -v ss >/dev/null 2>&1 && ss -H -ltn "( sport = :${port} )" 2>/dev/null | grep -q .; then
    if ! ss -H -ltnp "( sport = :${port} )" 2>/dev/null | grep -Eq "${expected}"; then
      die "TCP port ${port} is already in use by another service. Refusing to overwrite it."
    fi
    warn "TCP port ${port} is already held by the expected service; continuing."
  fi
}

assert_loopback_listener() {
  local port="$1" label="$2" unit="${3:-}" addresses="" attempt
  # A freshly (re)started service may take a moment to finish connecting to
  # MongoDB and open its listening socket. Poll briefly before judging the
  # bind address so a slow-but-healthy start isn't mistaken for a public
  # bind and isn't reported with a misleading security error.
  for attempt in $(seq 1 20); do
    addresses="$(ss -H -ltn "( sport = :${port} )" 2>/dev/null | awk '{print $4}' | sort -u)"
    [[ -n "${addresses}" ]] && break
    sleep 0.5
  done
  if [[ -z "${addresses}" ]]; then
    die "${label} is not listening on port ${port} after 10s.${unit:+ Check: journalctl -u ${unit} -n 100}"
  fi
  [[ "${addresses}" != *"0.0.0.0:${port}"* && "${addresses}" != *"[::]:${port}"* ]] \
    || die "${label} is not restricted to localhost."
  printf '%s\n' "${addresses}" | grep -Eq "(127\.0\.0\.1|::1):${port}$" \
    || die "${label} is not restricted to localhost."
}

if [[ -z "${CWMP_ALLOWED_CIDRS}" ]]; then
  die "Set GENIEACS_CWMP_ALLOWED_CIDRS to the approved IPv4 ranges used by your CPEs (private CIDRs are allowed for isolated tests). CWMP will not be opened to the whole internet."
fi
IFS=',' read -r -a CWMP_CIDR_ARRAY <<< "${CWMP_ALLOWED_CIDRS}"
for cidr in "${CWMP_CIDR_ARRAY[@]}"; do
  cidr="${cidr//[[:space:]]/}"
  [[ -n "${cidr}" ]] || die "GENIEACS_CWMP_ALLOWED_CIDRS contains an empty entry."
  [[ "${cidr}" != "0.0.0.0/0" ]] || die "A whole-internet CWMP allow rule is not permitted."
  node -e '
    const [ip, prefix] = process.argv[1].split("/");
    const octets = ip.split(".");
    process.exit(
      octets.length === 4 &&
      octets.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255) &&
      /^\d+$/.test(prefix || "") && Number(prefix) >= 8 && Number(prefix) <= 32
        ? 0 : 1,
    );
  ' "${cidr}" || die "Invalid CPE source range: ${cidr}. Use an IPv4 CIDR from /8 through /32."
done
# A managed port is immutable. Reject a changed rerun before package installs,
# environment rewrites, unit-file writes, or any service mutation.
firewall_reject_port_change "${CWMP_PORT}"

log "Checking DNS for ${ACS_DOMAIN}..."
DNS_ADDRESSES="$(getent ahostsv4 "${ACS_DOMAIN}" 2>/dev/null | awk '{print $1}' | sort -u || true)"
if [[ -z "${DNS_ADDRESSES}" ]]; then
  die "${ACS_DOMAIN} has no IPv4 DNS record. Point it to this server before running the installer."
fi
if [[ "${DNS_ADDRESSES}" == *$'\n'* ]] || [[ "$(printf '%s\n' "${DNS_ADDRESSES}" | wc -l)" -ne 1 ]]; then
  die "${ACS_DOMAIN} must resolve to exactly one public IPv4 address; found: ${DNS_ADDRESSES//$'\n'/ }"
fi
if [[ "${DNS_ADDRESSES}" =~ ^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.) ]]; then
  die "${ACS_DOMAIN} resolves to a private address (${DNS_ADDRESSES}). CPEs need a public address."
fi
PUBLIC_IP="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
[[ -n "${PUBLIC_IP}" ]] || die "Could not determine this server's public IPv4 address to verify ${ACS_DOMAIN}."
if [[ "${DNS_ADDRESSES}" != "${PUBLIC_IP}" ]]; then
  die "${ACS_DOMAIN} resolves to ${DNS_ADDRESSES}, but this server's detected public address is ${PUBLIC_IP}."
fi
ok "${ACS_DOMAIN} → ${DNS_ADDRESSES}"

check_listener_conflict "${CWMP_PORT}" "genieacs-cwmp|node"
check_listener_conflict "${NBI_PORT}" "genieacs-nbi|node"
check_listener_conflict "${FS_PORT}" "genieacs-fs|node"
check_listener_conflict "${UI_PORT}" "genieacs-ui|node"
if command -v ss >/dev/null 2>&1 && ss -H -ltn "( sport = :80 or sport = :443 )" 2>/dev/null | grep -q .; then
  ok "Ports 80/443 are already served by the existing web server"
else
  die "nginx is not listening on ports 80/443. Refusing to configure a public ACS hostname."
fi

export DEBIAN_FRONTEND=noninteractive
log "Installing MongoDB and HTTPS authentication dependencies..."
if { command -v mongod >/dev/null 2>&1 || systemctl list-unit-files --no-legend 2>/dev/null | grep -q '^mongod\.service'; } \
  && [[ ! -f "${GENIEACS_ENV}" ]]; then
  die "An existing MongoDB deployment was detected. Refusing to alter another application's datastore."
fi
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg apache2-utils certbot logrotate

install -d -m 0755 /etc/apt/keyrings
MONGO_KEYRING="/etc/apt/keyrings/mongodb-server-${MONGODB_MAJOR}.gpg"
if [[ ! -s "${MONGO_KEYRING}" ]]; then
  curl -fsSL "https://www.mongodb.org/static/pgp/server-${MONGODB_MAJOR}.asc" \
    | gpg --dearmor --yes -o "${MONGO_KEYRING}"
  chmod 0644 "${MONGO_KEYRING}"
fi
MONGO_LIST="/etc/apt/sources.list.d/mongodb-org-${MONGODB_MAJOR}.list"
MONGO_REPO="deb [ arch=amd64,arm64 signed-by=${MONGO_KEYRING} ] https://repo.mongodb.org/apt/ubuntu ${VERSION_CODENAME}/mongodb-org/${MONGODB_MAJOR} multiverse"
if [[ ! -f "${MONGO_LIST}" ]] || ! grep -Fxq "${MONGO_REPO}" "${MONGO_LIST}"; then
  printf '%s\n' "${MONGO_REPO}" > "${MONGO_LIST}"
fi
apt-get update -qq
apt-get install -y -qq mongodb-org
if [[ -f /etc/mongod.conf ]]; then
  if grep -Eq '^[[:space:]]*bindIpAll:[[:space:]]*true' /etc/mongod.conf; then
    die "MongoDB is configured to listen beyond localhost. Refusing to expose or alter an existing MongoDB deployment."
  fi
  MONGO_BIND_ADDRESSES="$(awk '/^[[:space:]]*bindIp:[[:space:]]*/ { sub(/^[[:space:]]*bindIp:[[:space:]]*/, ""); print; exit }' /etc/mongod.conf)"
  if [[ -n "${MONGO_BIND_ADDRESSES}" ]]; then
    IFS=',' read -r -a MONGO_BIND_ARRAY <<< "${MONGO_BIND_ADDRESSES}"
    for bind_address in "${MONGO_BIND_ARRAY[@]}"; do
      bind_address="${bind_address//[[:space:]]/}"
      [[ "${bind_address}" == "127.0.0.1" || "${bind_address}" == "::1" || "${bind_address}" == "localhost" ]] \
        || die "MongoDB is configured to listen on ${bind_address}, not localhost. Refusing to alter an existing MongoDB deployment."
    done
  fi
fi
systemctl enable --now mongod
systemctl is-active --quiet mongod || die "MongoDB did not start. Check: journalctl -u mongod -n 100"
ok "MongoDB is running locally"

if ! id genieacs >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --no-create-home --user-group --shell /usr/sbin/nologin genieacs
fi
install -d -o genieacs -g genieacs -m 0750 "${GENIEACS_DIR}" "${GENIEACS_DIR}/ext"
install -d -o genieacs -g genieacs -m 0750 "${LOG_DIR}"
install -d -o root -g root -m 0750 /etc/genieacs
install -d -o root -g root -m 0755 "${CERTBOT_WEBROOT}"
install -d -o root -g root -m 0755 "${CERTBOT_WEBROOT}/.well-known/acme-challenge"

log "Installing GenieACS ${GENIEACS_VERSION}..."
if command -v genieacs-cwmp >/dev/null 2>&1; then
  INSTALLED_GENIEACS="$(npm list --global --depth=0 --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).dependencies?.genieacs?.version||"unknown")}catch{console.log("unknown")}})' || true)"
else
  INSTALLED_GENIEACS=""
fi
if [[ "${INSTALLED_GENIEACS}" != "${GENIEACS_VERSION}" ]]; then
  npm install --global --omit=dev "genieacs@${GENIEACS_VERSION}"
fi
GENIEACS_BIN_DIR="$(dirname "$(command -v genieacs-cwmp)")"
for binary in genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui; do
  [[ -x "${GENIEACS_BIN_DIR}/${binary}" ]] || die "GenieACS binary ${binary} was not installed."
done
ok "GenieACS ${GENIEACS_VERSION} installed"

if [[ ! -f "${GENIEACS_ENV}" ]]; then
  JWT_SECRET="$(openssl rand -hex 64)"
  cat > "${GENIEACS_ENV}" <<EOF
# GenieACS production configuration. Keep mode 0600.
GENIEACS_MONGODB_CONNECTION_URL=mongodb://127.0.0.1/genieacs
GENIEACS_EXT_DIR=${GENIEACS_DIR}/ext
GENIEACS_CWMP_INTERFACE=0.0.0.0
GENIEACS_CWMP_PORT=${CWMP_PORT}
GENIEACS_NBI_INTERFACE=127.0.0.1
GENIEACS_NBI_PORT=${NBI_PORT}
GENIEACS_FS_INTERFACE=127.0.0.1
GENIEACS_FS_PORT=${FS_PORT}
GENIEACS_UI_INTERFACE=127.0.0.1
GENIEACS_UI_PORT=${UI_PORT}
GENIEACS_CWMP_ACCESS_LOG_FILE=${LOG_DIR}/genieacs-cwmp-access.log
GENIEACS_NBI_ACCESS_LOG_FILE=${LOG_DIR}/genieacs-nbi-access.log
GENIEACS_FS_ACCESS_LOG_FILE=${LOG_DIR}/genieacs-fs-access.log
GENIEACS_UI_ACCESS_LOG_FILE=${LOG_DIR}/genieacs-ui-access.log
GENIEACS_DEBUG_FILE=${LOG_DIR}/genieacs-debug.yaml
GENIEACS_UI_JWT_SECRET=${JWT_SECRET}
NODE_OPTIONS=--enable-source-maps
EOF
  chown root:genieacs "${GENIEACS_ENV}"
  chmod 0640 "${GENIEACS_ENV}"
else
  chmod 0640 "${GENIEACS_ENV}"
  chown root:genieacs "${GENIEACS_ENV}"
fi

write_managed_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "${GENIEACS_ENV}"; then
    sed "s|^${key}=.*|${key}=${value}|" "${GENIEACS_ENV}" > "${tmp}"
  else
    cat "${GENIEACS_ENV}" > "${tmp}"
    printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
  fi
  chown root:genieacs "${tmp}"
  chmod 0640 "${tmp}"
  mv "${tmp}" "${GENIEACS_ENV}"
}

# Keep the deployment ports and local bindings deterministic on reruns, while
# retaining any operator-added GenieACS settings in the environment file.
write_managed_env GENIEACS_MONGODB_CONNECTION_URL "mongodb://127.0.0.1/genieacs"
write_managed_env GENIEACS_EXT_DIR "${GENIEACS_DIR}/ext"
write_managed_env GENIEACS_CWMP_INTERFACE "0.0.0.0"
write_managed_env GENIEACS_CWMP_PORT "${CWMP_PORT}"
write_managed_env GENIEACS_NBI_INTERFACE "127.0.0.1"
write_managed_env GENIEACS_NBI_PORT "${NBI_PORT}"
write_managed_env GENIEACS_FS_INTERFACE "127.0.0.1"
write_managed_env GENIEACS_FS_PORT "${FS_PORT}"
write_managed_env GENIEACS_UI_INTERFACE "127.0.0.1"
write_managed_env GENIEACS_UI_PORT "${UI_PORT}"
write_managed_env GENIEACS_CWMP_ACCESS_LOG_FILE "${LOG_DIR}/genieacs-cwmp-access.log"
write_managed_env GENIEACS_NBI_ACCESS_LOG_FILE "${LOG_DIR}/genieacs-nbi-access.log"
write_managed_env GENIEACS_FS_ACCESS_LOG_FILE "${LOG_DIR}/genieacs-fs-access.log"
write_managed_env GENIEACS_UI_ACCESS_LOG_FILE "${LOG_DIR}/genieacs-ui-access.log"
write_managed_env GENIEACS_DEBUG_FILE "${LOG_DIR}/genieacs-debug.yaml"
if ! grep -q '^GENIEACS_UI_JWT_SECRET=' "${GENIEACS_ENV}"; then
  write_managed_env GENIEACS_UI_JWT_SECRET "$(openssl rand -hex 64)"
fi
chown root:genieacs "${GENIEACS_ENV}"
chmod 0640 "${GENIEACS_ENV}"

if [[ ! -f "${GENIEACS_CREDENTIALS}" || "${GENIEACS_ROTATE_NBI_CREDENTIALS:-false}" == "true" ]]; then
  NBI_USERNAME="${GENIEACS_NBI_USERNAME:-netpulse-nbi}"
  NBI_PASSWORD="${GENIEACS_NBI_PASSWORD:-$(openssl rand -hex 24)}"
  [[ "${NBI_USERNAME}" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die "GENIEACS_NBI_USERNAME may contain only letters, numbers, dot, underscore, and hyphen."
  [[ "${NBI_PASSWORD}" =~ ^[A-Za-z0-9._~!+,:=@-]{20,}$ ]] \
    || die "GENIEACS_NBI_PASSWORD must be at least 20 characters and use safe credential characters."
  [[ "${#NBI_PASSWORD}" -ge 20 ]] || die "Generated NBI password was too short."
  umask 077
  cat > "${GENIEACS_CREDENTIALS}" <<EOF
GENIEACS_NBI_URL=https://${ACS_DOMAIN}
GENIEACS_NBI_USERNAME=${NBI_USERNAME}
GENIEACS_NBI_PASSWORD=${NBI_PASSWORD}
EOF
  chmod 0600 "${GENIEACS_CREDENTIALS}"
  printf '%s\n' "${NBI_PASSWORD}" | htpasswd -B -i -c "${GENIEACS_HTPASSWD}" "${NBI_USERNAME}" >/dev/null
  chmod 0640 "${GENIEACS_HTPASSWD}"
  chown root:www-data "${GENIEACS_HTPASSWD}"
else
  # An existing credential file is the source of truth. Do not rotate a live
  # connector silently just because the script was run again.
  NBI_USERNAME="$(read_credential_value GENIEACS_NBI_USERNAME)"
  NBI_PASSWORD="$(read_credential_value GENIEACS_NBI_PASSWORD)"
  [[ -n "${NBI_USERNAME}" && -n "${NBI_PASSWORD}" ]] \
    || die "${GENIEACS_CREDENTIALS} is incomplete. Set GENIEACS_ROTATE_NBI_CREDENTIALS=true to rotate it."
  if [[ ! -s "${GENIEACS_HTPASSWD}" ]]; then
    printf '%s\n' "${NBI_PASSWORD}" | htpasswd -B -i -c "${GENIEACS_HTPASSWD}" "${NBI_USERNAME}" >/dev/null
  fi
  chmod 0640 "${GENIEACS_HTPASSWD}"
  chown root:www-data "${GENIEACS_HTPASSWD}"
fi
unset NBI_PASSWORD GENIEACS_NBI_PASSWORD

log "Creating restart-safe GenieACS services..."
for service in cwmp nbi fs ui; do
  cat > "/etc/systemd/system/genieacs-${service}.service" <<EOF
[Unit]
Description=GenieACS ${service^^}
After=network-online.target mongod.service
Wants=network-online.target
Requires=mongod.service

[Service]
Type=simple
User=genieacs
Group=genieacs
EnvironmentFile=${GENIEACS_ENV}
ExecStart=${GENIEACS_BIN_DIR}/genieacs-${service}
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
done

cat > /etc/logrotate.d/genieacs <<EOF
${LOG_DIR}/*.log ${LOG_DIR}/*.yaml {
    daily
    rotate 30
    compress
    delaycompress
    dateext
    missingok
    notifempty
    copytruncate
}
EOF
chmod 0644 /etc/logrotate.d/genieacs

# Do this before CWMP starts. The transaction never changes the host's default
# policy and installs a source-restricted dispatch before any public listener.
firewall_require_backend
firewall_recover_interrupted_transaction
firewall_apply_cwmp
systemctl daemon-reload
for service in genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui; do
  systemctl enable "${service}" >/dev/null
  systemctl restart "${service}"
  systemctl is-active --quiet "${service}" || die "${service} failed to start. Check: journalctl -u ${service} -n 100"
done
assert_loopback_listener "${NBI_PORT}" "GenieACS NBI" "genieacs-nbi"
assert_loopback_listener "${FS_PORT}" "GenieACS file server" "genieacs-fs"
assert_loopback_listener "${UI_PORT}" "GenieACS UI" "genieacs-ui"
assert_loopback_listener "27017" "MongoDB" "mongod"
ok "All GenieACS services are enabled and running"

if [[ -e "${GENIEACS_NGINX}" ]] && ! grep -q '^# Managed by NetPulse GenieACS$' "${GENIEACS_NGINX}"; then
  die "${GENIEACS_NGINX} already exists but is not managed by this installer."
fi
if [[ -e "${GENIEACS_NGINX_LINK}" && ! -L "${GENIEACS_NGINX_LINK}" ]]; then
  die "${GENIEACS_NGINX_LINK} is not a symlink. Refusing to replace an existing nginx site."
fi
while IFS= read -r nginx_file; do
  [[ -z "${nginx_file}" ]] && continue
  [[ "$(readlink -f "${nginx_file}")" == "${GENIEACS_NGINX}" ]] && continue
  if grep -Eq "^[[:space:]]*server_name[[:space:]].*${ACS_DOMAIN}" "${nginx_file}"; then
    die "${ACS_DOMAIN} is already configured by ${nginx_file}. Refusing to create a conflicting nginx vhost."
  fi
done < <(grep -RIlF "${ACS_DOMAIN}" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true)

NGINX_BACKUP_DIR="$(mktemp -d)"
if [[ -e "${GENIEACS_NGINX}" ]]; then
  cp -a "${GENIEACS_NGINX}" "${NGINX_BACKUP_DIR}/site"
fi
if [[ -L "${GENIEACS_NGINX_LINK}" ]]; then
  readlink "${GENIEACS_NGINX_LINK}" > "${NGINX_BACKUP_DIR}/link-target"
fi

log "Requesting or reusing the HTTPS certificate..."
CERT_DIR="/etc/letsencrypt/live/${ACS_DOMAIN}"
if [[ ! -s "${CERT_DIR}/fullchain.pem" || ! -s "${CERT_DIR}/privkey.pem" ]]; then
  CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
  if [[ -z "${CERTBOT_EMAIL}" && -t 0 ]]; then
    read -rp "Email for Let's Encrypt renewal notices: " CERTBOT_EMAIL </dev/tty
  fi
  [[ "${CERTBOT_EMAIL}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] \
    || die "Set CERTBOT_EMAIL to a valid email address before requesting the certificate."

  cat > "${GENIEACS_NGINX}" <<EOF
# Managed by NetPulse GenieACS
server {
    listen 80;
    listen [::]:80;
    server_name ${ACS_DOMAIN};
    location ^~ /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }
    location / { return 404; }
}
EOF
  ln -sf "${GENIEACS_NGINX}" "${GENIEACS_NGINX_LINK}"
  nginx -t
  systemctl reload nginx
  certbot certonly --webroot -w "${CERTBOT_WEBROOT}" \
    --domain "${ACS_DOMAIN}" --email "${CERTBOT_EMAIL}" \
    --agree-tos --no-eff-email --non-interactive
fi
[[ -s "${CERT_DIR}/fullchain.pem" && -s "${CERT_DIR}/privkey.pem" ]] \
  || die "The HTTPS certificate for ${ACS_DOMAIN} is unavailable."
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-netpulse-nginx <<'EOF'
#!/bin/sh
/usr/sbin/nginx -t && systemctl reload nginx
EOF
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-netpulse-nginx

log "Configuring the authenticated NBI reverse proxy..."
NBI_USERNAME="$(read_credential_value GENIEACS_NBI_USERNAME)"
NBI_PASSWORD="$(read_credential_value GENIEACS_NBI_PASSWORD)"
cat > "${GENIEACS_NGINX}" <<EOF
# Managed by NetPulse GenieACS
# GenieACS NBI only. The GenieACS UI, file server, and local NBI port are not
# exposed by this virtual host.
server {
    listen 80;
    listen [::]:80;
    server_name ${ACS_DOMAIN};
    location ^~ /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${ACS_DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    access_log /var/log/nginx/genieacs-nbi-access.log;
    error_log  /var/log/nginx/genieacs-nbi-error.log;
    client_max_body_size 5m;

    auth_basic "NetPulse GenieACS NBI";
    auth_basic_user_file ${GENIEACS_HTPASSWD};

    location / {
        proxy_pass http://127.0.0.1:${NBI_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
        proxy_buffering off;
    }
}
EOF
ln -sf "${GENIEACS_NGINX}" "${GENIEACS_NGINX_LINK}"
nginx -t
systemctl reload nginx
ok "HTTPS NBI proxy installed at https://${ACS_DOMAIN}"

ok "netfilter-persistent restricts TCP ${CWMP_PORT} to the approved CPE ranges"

log "Updating NetPulse's approved ACS hostname..."
EXISTING_ACS_HOSTS="$(grep -E '^TR069_ACS_ALLOWED_HOSTS=' /opt/netpulse/.env | tail -n 1 | cut -d= -f2- | tr -d '\r' || true)"
case ",${EXISTING_ACS_HOSTS}," in
  *",${ACS_DOMAIN},"*) EFFECTIVE_ACS_HOSTS="${EXISTING_ACS_HOSTS}" ;;
  ",,") EFFECTIVE_ACS_HOSTS="${ACS_DOMAIN}" ;;
  *) EFFECTIVE_ACS_HOSTS="${EXISTING_ACS_HOSTS},${ACS_DOMAIN}" ;;
esac
NETPULSE_USER="$(grep -E '^NETPULSE_PM2_USER=' /opt/netpulse/.env | tail -n 1 | cut -d= -f2- | tr -d '\r' || true)"
if [[ -z "${NETPULSE_USER}" ]]; then
  NETPULSE_USER="$(stat -c '%U' /opt/netpulse)"
fi
PM2_BIN="$(command -v pm2 || true)"
PM2_ECOSYSTEM="/opt/netpulse/deploy/ecosystem.config.cjs"
NETPULSE_ENV_BACKUP="$(mktemp /opt/netpulse/.env.genieacs.XXXXXX)"
cp --preserve=mode,ownership,timestamps /opt/netpulse/.env "${NETPULSE_ENV_BACKUP}"
upsert_env_key "/opt/netpulse/.env" "TR069_ACS_ALLOWED_HOSTS" "${EFFECTIVE_ACS_HOSTS}"
restore_netpulse_env() {
  cp --preserve=mode,ownership,timestamps "${NETPULSE_ENV_BACKUP}" /opt/netpulse/.env
  if [[ -n "${PM2_BIN}" && -n "${NETPULSE_USER}" ]] && id "${NETPULSE_USER}" >/dev/null 2>&1; then
    runuser -u "${NETPULSE_USER}" -- env HOME="${NETPULSE_HOME:-}" "${PM2_BIN}" reload "${PM2_ECOSYSTEM}" --only netpulse --update-env >/dev/null 2>&1 || true
  fi
  rm -f "${NETPULSE_ENV_BACKUP}"
}
if [[ -z "${PM2_BIN}" ]] || ! id "${NETPULSE_USER}" >/dev/null 2>&1; then
  restore_netpulse_env
  die "Could not identify the NetPulse PM2 command and user. The ACS allowlist change was rolled back."
fi
NETPULSE_HOME="$(getent passwd "${NETPULSE_USER}" | cut -d: -f6)"
if [[ ! -f "${PM2_ECOSYSTEM}" ]]; then
  restore_netpulse_env
  die "The NetPulse PM2 ecosystem file is missing. The ACS allowlist change was rolled back."
fi
if ! runuser -u "${NETPULSE_USER}" -- env HOME="${NETPULSE_HOME}" "${PM2_BIN}" reload "${PM2_ECOSYSTEM}" --only netpulse --update-env >/dev/null; then
  restore_netpulse_env
  die "NetPulse did not reload its ecosystem with the ACS allowlist. The .env change was rolled back."
fi
if ! runuser -u "${NETPULSE_USER}" -- env HOME="${NETPULSE_HOME}" "${PM2_BIN}" jlist \
  | node -e 'const host=process.argv[1];let input="";process.stdin.on("data",d=>input+=d).on("end",()=>{try{const app=JSON.parse(input).find(a=>a.name==="netpulse");const hosts=app?.pm2_env?.env?.TR069_ACS_ALLOWED_HOSTS||"";process.exit(hosts.split(",").map(v=>v.trim()).includes(host) ? 0 : 1)}catch{process.exit(1)}});' "${ACS_DOMAIN}"; then
  restore_netpulse_env
  die "PM2 did not load TR069_ACS_ALLOWED_HOSTS. The .env change was rolled back."
fi
NETPULSE_PORT="$(grep -E '^PORT=' /opt/netpulse/.env | tail -n 1 | cut -d= -f2- | tr -d '\r' || true)"
NETPULSE_PORT="${NETPULSE_PORT:-8080}"
if ! curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${NETPULSE_PORT}/api/healthz" >/dev/null; then
  restore_netpulse_env
  die "NetPulse health check failed after updating the ACS allowlist. The .env change was rolled back."
fi
rm -f "${NETPULSE_ENV_BACKUP}"
ok "NetPulse allowlist and health check passed"

log "Running the authenticated NBI health check..."
NBI_HEALTH="$(curl --fail --silent --show-error --max-time 15 \
  --resolve "${ACS_DOMAIN}:443:127.0.0.1" \
  --user "${NBI_USERNAME}:${NBI_PASSWORD}" \
  "https://${ACS_DOMAIN}/devices/?limit=1")" \
  || die "Authenticated NBI health check failed. Check: journalctl -u genieacs-nbi -n 100 and tail -n 100 /var/log/nginx/genieacs-nbi-error.log"
printf '%s' "${NBI_HEALTH}" | grep -q '^\[' \
  || die "NBI health check returned an unexpected response."
ok "Authenticated NBI health check passed"

firewall_commit_cwmp
NGINX_COMMITTED=true
INSTALL_COMMITTED=true
ok "CWMP firewall transaction committed with netfilter-persistent"

cat <<EOF

GenieACS is installed on this NetPulse server.

  NBI URL:       https://${ACS_DOMAIN}
  CWMP endpoint: http://${DNS_ADDRESSES}:${CWMP_PORT}
  NBI details:   sudo cat ${GENIEACS_CREDENTIALS}
  Service logs:  journalctl -u genieacs-cwmp -u genieacs-nbi -u genieacs-fs -u genieacs-ui

Next:
  1. In NetPulse, choose the customer company and open Fiber Access → ACS Settings.
  2. Enter the NBI URL and the credentials from the root-only details file.
  3. Configure the CPE's CWMP URL as http://${DNS_ADDRESSES}:${CWMP_PORT}.
  4. Use the CPE's documented TR-069 username/password, not its Huawei web-login credentials.
EOF