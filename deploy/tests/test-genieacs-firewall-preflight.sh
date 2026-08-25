#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SETUP="${ROOT}/deploy/setup-ubuntu.sh"

grep -q 'apt-get install -y -qq iptables-persistent netfilter-persistent' "${SETUP}"
grep -q 'systemctl enable --now netfilter-persistent' "${SETUP}"
grep -q 'netfilter-persistent save' "${SETUP}"
grep -q "ufw status.*grep -q '\\^Status: active'" "${SETUP}"
grep -q 'FIREWALL_PERSISTENCE_MODE="fresh-netfilter"' "${SETUP}"
grep -q 'FIREWALL_PERSISTENCE_MODE="existing-ufw"' "${SETUP}"
grep -q 'Active UFW detected during upgrade; leaving its firewall ownership and rules untouched.' "${SETUP}"
grep -q 'if \[\[ "$FIREWALL_PERSISTENCE_MODE" == "fresh-netfilter" \]\]' "${SETUP}"
if grep -Eq 'ufw (allow|enable)|software-properties-common ufw' "${SETUP}"; then
  echo "base setup still installs/enables UFW rules" >&2
  exit 1
fi

# Port immutability must run before every mutating installer phase.
GENIE_SETUP="${ROOT}/deploy/setup-genieacs.sh"
reject_line="$(grep -n 'firewall_reject_port_change "${CWMP_PORT}"' "${GENIE_SETUP}" | cut -d: -f1)"
apt_line="$(grep -n '^apt-get update -qq' "${GENIE_SETUP}" | head -n1 | cut -d: -f1)"
env_line="$(grep -n '^if \[\[ ! -f "${GENIEACS_ENV}" \]\]' "${GENIE_SETUP}" | cut -d: -f1)"
[[ -n "${reject_line}" && "${reject_line}" -lt "${apt_line}" && "${reject_line}" -lt "${env_line}" ]]
[[ "$(grep -c 'firewall_reject_port_change "${CWMP_PORT}"' "${GENIE_SETUP}")" -eq 1 ]]

die() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
source "${ROOT}/deploy/lib/genieacs-firewall.sh"

mock_ufw_active=false
ufw() {
  [[ "$1" == status ]] || return 1
  if [[ "${mock_ufw_active}" == "true" ]]; then
    echo "Status: active"
  else
    echo "Status: inactive"
  fi
}
iptables() { :; }
ip6tables() { :; }
iptables-save() { :; }
iptables-restore() { :; }
ip6tables-save() { :; }
ip6tables-restore() { :; }
systemctl() {
  [[ "$1" == is-active && "$3" == netfilter-persistent ]]
}

firewall_require_backend
mock_ufw_active=true
if (firewall_require_backend); then
  echo "active UFW was not rejected" >&2
  exit 1
fi

echo "genieacs firewall preflight tests: PASS"