#!/usr/bin/env bash
# One-time, operator-confirmed adoption of an existing dedicated NetPulse VPN.
#
# This intentionally does not start, stop, restart, enable, or disable any
# system service. It only adds NetPulse's immutable ownership marker after the
# operator confirms that the exact dedicated configuration is NetPulse-owned.
set -euo pipefail

CONFIG="/etc/openvpn/server/netpulse.conf"
UNIT="openvpn-server@netpulse"
MARKER="# Managed by NetPulse: RouterOS management VPN"
CONFIRMATION_FLAG="--confirm-existing-netpulse-vpn"

die() {
  printf 'NetPulse VPN adoption blocked: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
This one-time command is only for a VERIFIED existing NetPulse RouterOS VPN.
It creates a backup and adds the NetPulse ownership marker to:
  /etc/openvpn/server/netpulse.conf

It does not start, stop, restart, enable, or disable OpenVPN. It never
modifies Tabana-VPN, generic OpenVPN units, or any other configuration.

After you have verified that this exact configuration belongs to NetPulse, run:
  sudo bash deploy/adopt-existing-netpulse-vpn.sh --confirm-existing-netpulse-vpn
USAGE
  exit 2
}

[[ "$EUID" -eq 0 ]] || die "Run this adoption command with sudo."
[[ "${1:-}" == "$CONFIRMATION_FLAG" && $# -eq 1 ]] || usage
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] \
  || die "The exact dedicated configuration was not found as a regular file. Nothing was changed."
command -v systemctl >/dev/null 2>&1 \
  || die "systemctl is unavailable; the dedicated NetPulse service could not be verified."
systemctl cat "$UNIT" >/dev/null 2>&1 \
  || die "The dedicated NetPulse service unit is not installed. Nothing was changed."

if grep -Fxq "$MARKER" "$CONFIG"; then
  printf 'NetPulse VPN configuration is already marked; no changes were made.\n'
  exit 0
fi

# The explicit flag is the operator's ownership confirmation. These checks make
# accidental adoption of a clearly different profile less likely without
# printing configuration contents, which may contain private-key material.
grep -Eqi 'tabana([[:space:]_-]*vpn)?' "$CONFIG" \
  && die "The dedicated configuration mentions Tabana. Refusing to adopt it."
grep -Eq '^[[:space:]]*dev[[:space:]]+tun([[:space:]#]|$)' "$CONFIG" \
  || die "The configuration is not a TUN OpenVPN profile."
grep -Eq '^[[:space:]]*server[[:space:]]+[0-9]{1,3}(\.[0-9]{1,3}){3}[[:space:]]+[0-9]{1,3}(\.[0-9]{1,3}){3}([[:space:]#]|$)' "$CONFIG" \
  || die "The configuration does not define an IPv4 OpenVPN server subnet."

readarray -t PORTS < <(awk '$1 == "port" { print $2 }' "$CONFIG")
[[ "${#PORTS[@]}" -eq 1 && "${PORTS[0]}" =~ ^[0-9]{1,5}$ ]] \
  && (( 10#${PORTS[0]} >= 1 && 10#${PORTS[0]} <= 65535 )) \
  || die "The configuration must define exactly one valid TCP port."

readarray -t PROTOCOLS < <(awk '$1 == "proto" { print $2 }' "$CONFIG")
[[ "${#PROTOCOLS[@]}" -eq 1 && ( "${PROTOCOLS[0]}" == "tcp" || "${PROTOCOLS[0]}" == "tcp-server" ) ]] \
  || die "The configuration is not a NetPulse TCP OpenVPN server profile."

owner="$(stat -c '%U' "$CONFIG")"
mode="$(stat -c '%a' "$CONFIG")"
[[ "$owner" == "root" ]] || die "The configuration is not owned by root."
(( (8#$mode & 0022) == 0 )) || die "The configuration is writable by a non-root group or user."

timestamp="$(date -u +%Y%m%d%H%M%S)"
backup="${CONFIG}.netpulse-adopt.${timestamp}.bak"
tmp="$(mktemp "${CONFIG}.netpulse-adopt.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

cp -p "$CONFIG" "$backup"
{
  printf '%s\n' "$MARKER"
  cat "$CONFIG"
} > "$tmp"
chown --reference="$CONFIG" "$tmp"
chmod --reference="$CONFIG" "$tmp"
mv -f "$tmp" "$CONFIG"
trap - EXIT

printf 'Adopted the verified NetPulse configuration. Backup: %s\n' "$backup"
printf 'No OpenVPN service or listener was changed. Next, run: sudo /usr/local/bin/netpulse-vpn-repair --json\n'