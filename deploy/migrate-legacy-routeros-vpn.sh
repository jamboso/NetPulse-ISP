#!/usr/bin/env bash
# One-time, operator-confirmed migration from the legacy generic OpenVPN unit.
# This script is intentionally never called by the portal or the updater.
set -euo pipefail

LEGACY_CONFIG="/etc/openvpn/server.conf"
LEGACY_UNIT="openvpn@server"
CONFIG_DIR="/etc/openvpn/server"
NETPULSE_CONFIG="${CONFIG_DIR}/netpulse.conf"
NETPULSE_DIR="/etc/openvpn/netpulse"
NETPULSE_EASYRSA="/etc/openvpn/netpulse-easy-rsa"
NETPULSE_UNIT="openvpn-server@netpulse"
MARKER="# Managed by NetPulse: RouterOS management VPN"

[[ $EUID -eq 0 ]] || { echo "Run this migration with sudo." >&2; exit 1; }
[[ "${1:-}" == "--confirm-legacy-netpulse-vpn" && $# -eq 1 ]] || {
  cat >&2 <<'USAGE'
This one-time migration is for a VERIFIED legacy NetPulse RouterOS VPN only.
It will stop openvpn@server after copying its configuration into NetPulse's
dedicated instance. Do not run it for Tabana-VPN or any unrelated OpenVPN service.

After verifying /etc/openvpn/server.conf belongs to NetPulse, run:
  sudo bash deploy/migrate-legacy-routeros-vpn.sh --confirm-legacy-netpulse-vpn
USAGE
  exit 2
}

[[ -f "$LEGACY_CONFIG" ]] || { echo "Legacy NetPulse configuration not found: $LEGACY_CONFIG" >&2; exit 1; }
[[ ! -e "$NETPULSE_CONFIG" ]] || {
  echo "Dedicated NetPulse configuration already exists; refusing to overwrite it." >&2
  exit 1
}
[[ ! -e "$NETPULSE_DIR" && ! -e "$NETPULSE_EASYRSA" ]] || {
  echo "Dedicated NetPulse VPN files already exist; refusing to overwrite or remove them." >&2
  exit 1
}
systemctl list-unit-files "$LEGACY_UNIT" >/dev/null 2>&1 \
  || { echo "Legacy OpenVPN unit $LEGACY_UNIT is not installed." >&2; exit 1; }
LEGACY_PORT="$(awk '$1 == "port" { print $2; exit }' "$LEGACY_CONFIG")"
[[ "$LEGACY_PORT" =~ ^[0-9]{1,5}$ ]] && (( 10#$LEGACY_PORT >= 1 && 10#$LEGACY_PORT <= 65535 )) \
  || { echo "Legacy config does not define a valid TCP port; refusing migration." >&2; exit 1; }
grep -Eq '^[[:space:]]*proto[[:space:]]+tcp(-server)?([[:space:]]|$)' "$LEGACY_CONFIG" \
  || { echo "Legacy config is not a TCP OpenVPN service; refusing migration." >&2; exit 1; }

legacy_was_active=0
legacy_was_enabled=0
legacy_stopped=0
created_files=0
systemctl is-active --quiet "$LEGACY_UNIT" && legacy_was_active=1
systemctl is-enabled --quiet "$LEGACY_UNIT" && legacy_was_enabled=1

rollback() {
  local exit_code=$?
  trap - ERR
  systemctl stop "$NETPULSE_UNIT" 2>/dev/null || true
  systemctl disable "$NETPULSE_UNIT" --quiet 2>/dev/null || true
  if [[ "$legacy_was_enabled" -eq 1 ]]; then
    systemctl enable "$LEGACY_UNIT" --quiet 2>/dev/null || true
  else
    systemctl disable "$LEGACY_UNIT" --quiet 2>/dev/null || true
  fi
  if [[ "$legacy_stopped" -eq 1 && "$legacy_was_active" -eq 1 ]]; then
    systemctl start "$LEGACY_UNIT" 2>/dev/null || true
  fi
  if [[ "$created_files" -eq 1 ]]; then
    rm -f "$NETPULSE_CONFIG" /run/openvpn/netpulse-routeros.pid
    rm -rf "$NETPULSE_DIR" "$NETPULSE_EASYRSA"
  fi
  echo "Migration failed; the legacy service state was restored and dedicated migration files were removed." >&2
  exit "$exit_code"
}
trap rollback ERR

mkdir -p "$CONFIG_DIR" "$NETPULSE_DIR" /var/log/openvpn
created_files=1
cp -a /etc/openvpn/easy-rsa "$NETPULSE_EASYRSA"
cp -a /etc/openvpn/ca.crt /etc/openvpn/server.crt /etc/openvpn/server.key /etc/openvpn/dh.pem "$NETPULSE_DIR/"
[[ ! -d /etc/openvpn/ccd ]] || cp -a /etc/openvpn/ccd "$NETPULSE_DIR/ccd"
[[ ! -f /etc/openvpn/crl.pem ]] || cp -a /etc/openvpn/crl.pem "$NETPULSE_DIR/crl.pem"

{
  printf '%s\n' "$MARKER"
  sed -E \
    -e 's#/etc/openvpn/ca\.crt#/etc/openvpn/netpulse/ca.crt#g' \
    -e 's#/etc/openvpn/server\.crt#/etc/openvpn/netpulse/server.crt#g' \
    -e 's#/etc/openvpn/server\.key#/etc/openvpn/netpulse/server.key#g' \
    -e 's#/etc/openvpn/dh\.pem#/etc/openvpn/netpulse/dh.pem#g' \
    -e 's#/etc/openvpn/ccd#/etc/openvpn/netpulse/ccd#g' \
    -e 's#/etc/openvpn/crl\.pem#/etc/openvpn/netpulse/crl.pem#g' \
    -e 's#/var/log/openvpn/ipp\.txt#/var/log/openvpn/netpulse-ipp.txt#g' \
    -e 's#/var/log/openvpn/status\.log#/var/log/openvpn/netpulse-status.log#g' \
    -e 's#/var/log/openvpn/openvpn\.log#/var/log/openvpn/netpulse-server.log#g' \
    -e 's/^([[:space:]]*proto[[:space:]]+)tcp([[:space:]]*(#.*)?)$/\1tcp-server\2/' \
    "$LEGACY_CONFIG"
  printf '\nwritepid /run/openvpn/netpulse-routeros.pid\n'
} > "$NETPULSE_CONFIG"
chmod 600 "$NETPULSE_CONFIG"

systemctl stop "$LEGACY_UNIT"
legacy_stopped=1
systemctl start "$NETPULSE_UNIT"
systemctl enable "$NETPULSE_UNIT" --quiet
systemctl disable "$LEGACY_UNIT" --quiet
trap - ERR
echo "Migrated verified NetPulse RouterOS VPN to $NETPULSE_UNIT."