#!/usr/bin/env bash
# Safely recover NetPulse's managed RouterOS OpenVPN listener.
# Usage:
#   sudo /usr/local/bin/netpulse-vpn-repair
#   sudo /usr/local/bin/netpulse-vpn-repair --json
set -euo pipefail

UNIT="openvpn-server@netpulse"
CONFIG="/etc/openvpn/server/netpulse.conf"
MARKER="# Managed by NetPulse: RouterOS management VPN"
PID_FILE="/run/openvpn/netpulse-routeros.pid"
JSON_OUTPUT=false
[[ "${1:-}" == "--json" ]] && JSON_OUTPUT=true

EVENTS=()

add_event() {
  EVENTS+=("$1")
  if [[ "$JSON_OUTPUT" != "true" ]]; then
    printf '• %s\n' "$1"
  fi
}

json_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'
}

finish() {
  local success="$1" state="$2" message="$3" exit_code="$4"
  if [[ "$JSON_OUTPUT" == "true" ]]; then
    local index event
    printf '{"success":%s,"state":"' "$success"
    json_string "$state"
    printf '","message":"'
    json_string "$message"
    printf '","events":['
    for index in "${!EVENTS[@]}"; do
      [[ "$index" -gt 0 ]] && printf ','
      event="${EVENTS[$index]}"
      printf '"'
      json_string "$event"
      printf '"'
    done
    printf ']}\n'
  else
    printf '\n%s\n' "$message"
  fi
  exit "$exit_code"
}

[[ "$EUID" -eq 0 ]] || finish false "blocked" "Run this repair helper with sudo." 1
[[ -f "$CONFIG" ]] || finish false "unavailable" "Dedicated NetPulse VPN configuration was not found. Do not repair a generic OpenVPN service; migrate the verified legacy NetPulse service first." 1
command -v systemctl >/dev/null 2>&1 || finish false "unavailable" "systemctl is unavailable on this host." 1
command -v ss >/dev/null 2>&1 || finish false "unavailable" "The ss command is unavailable; install iproute2 before repairing OpenVPN." 1
grep -Fxq "$MARKER" "$CONFIG" \
  || finish false "blocked" "Refusing to repair an unmarked OpenVPN configuration. No service or listener was changed." 1

PORT="$(awk '$1 == "port" { print $2; exit }' "$CONFIG")"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) \
  || finish false "blocked" "Refusing to repair: $CONFIG does not define a valid NetPulse TCP port." 1
PROTOCOL="$(awk '$1 == "proto" { print $2; exit }' "$CONFIG")"
if [[ "$PROTOCOL" != "tcp" && "$PROTOCOL" != "tcp-server" ]]; then
  finish false "blocked" "Refusing to repair: $CONFIG is not configured for the NetPulse TCP OpenVPN service." 1
fi

config_changed=false
if [[ "$PROTOCOL" == "tcp" ]]; then
  backup="${CONFIG}.netpulse-repair.$(date +%Y%m%d%H%M%S).bak"
  cp -p "$CONFIG" "$backup"
  sed -i -E 's/^([[:space:]]*proto[[:space:]]+)tcp([[:space:]]*(#.*)?)$/\1tcp-server\2/' "$CONFIG"
  config_changed=true
  add_event "Normalized the NetPulse server protocol to tcp-server; backup saved as $backup."
fi
if grep -Eqi '^[[:space:]]*push[[:space:]]+"?(redirect-gateway|dhcp-option[[:space:]]+DNS)([[:space:]]|")' "$CONFIG"; then
  if [[ "$config_changed" != "true" ]]; then
    backup="${CONFIG}.netpulse-repair.$(date +%Y%m%d%H%M%S).bak"
  fi
  cp -p "$CONFIG" "$backup"
  sed -i -E '/^[[:space:]]*push[[:space:]]+"?(redirect-gateway|dhcp-option[[:space:]]+DNS)([[:space:]]|")/Id' "$CONFIG"
  config_changed=true
  add_event "Removed legacy default-route or DNS pushes; backup saved as $backup."
fi
if grep -Eqi '^[[:space:]]*auth-user-pass-verify([[:space:]]|$)' "$CONFIG"; then
  if [[ "$config_changed" != "true" ]]; then
    backup="${CONFIG}.netpulse-repair.$(date +%Y%m%d%H%M%S).bak"
  fi
  cp -p "$CONFIG" "$backup"
  sed -i -E '/^[[:space:]]*auth-user-pass-verify([[:space:]]|$)/Id' "$CONFIG"
  config_changed=true
  add_event "Removed legacy password verification; NetPulse RouterOS VPN now uses client certificates only. Backup saved as $backup."
fi

listener_pids() {
  ss -ltnpH "sport = :${PORT}" 2>/dev/null \
    | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
    | sort -u
}

readarray -t PIDS < <(listener_pids)
service_active=false
systemctl is-active --quiet "$UNIT" && service_active=true
managed_pid="$(systemctl show --property=MainPID --value "$UNIT" 2>/dev/null || printf '0')"

if [[ "$service_active" == "true" && "$config_changed" == "false" ]]; then
  if [[ "${#PIDS[@]}" -eq 1 && "${PIDS[0]}" == "$managed_pid" ]]; then
    add_event "The managed OpenVPN service is already active and owns TCP $PORT."
    finish true "healthy" "NetPulse VPN service is healthy; no restart was needed." 0
  fi
  if [[ "${#PIDS[@]}" -gt 0 ]]; then
    finish false "blocked" "OpenVPN is active, but TCP $PORT is not owned solely by its managed process. No process was stopped." 1
  fi
  add_event "The managed service is active but has no TCP $PORT listener; restarting it."
fi

if [[ "$service_active" != "true" && "${#PIDS[@]}" -gt 0 ]]; then
  if [[ "${#PIDS[@]}" -ne 1 ]]; then
    finish false "blocked" "More than one process owns TCP $PORT. No process was stopped." 1
  fi

  stale_pid="${PIDS[0]}"
  executable="$(readlink -f "/proc/${stale_pid}/exe" 2>/dev/null || true)"
  command_line="$(tr '\000' ' ' < "/proc/${stale_pid}/cmdline" 2>/dev/null || true)"
  if [[ "${executable##*/}" != "openvpn" || "$command_line" != *"$CONFIG"* ]]; then
    finish false "blocked" "TCP $PORT is owned by PID $stale_pid, which is not the expected NetPulse OpenVPN configuration. No process was stopped." 1
  fi

  add_event "Stopping stale NetPulse OpenVPN listener PID $stale_pid."
  kill -TERM "$stale_pid"
  for _ in {1..10}; do
    kill -0 "$stale_pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$stale_pid" 2>/dev/null; then
    add_event "Stale listener did not exit after 10 seconds; sending SIGKILL."
    kill -KILL "$stale_pid"
  fi
  rm -f "$PID_FILE"
  add_event "Removed stale NetPulse OpenVPN PID file, if present."
fi

systemctl reset-failed "$UNIT"
if [[ "$config_changed" == "true" || "$service_active" == "true" ]]; then
  systemctl restart "$UNIT" || true
else
  systemctl start "$UNIT" || true
fi

if ! systemctl is-active --quiet "$UNIT"; then
  add_event "OpenVPN did not become active. Inspect: journalctl -u $UNIT -n 50 --no-pager"
  finish false "failed" "NetPulse VPN service did not start. No router, RADIUS, or customer-traffic settings were changed." 1
fi

readarray -t PIDS < <(listener_pids)
managed_pid="$(systemctl show --property=MainPID --value "$UNIT" 2>/dev/null || printf '0')"
if [[ "${#PIDS[@]}" -ne 1 || "${PIDS[0]}" != "$managed_pid" ]]; then
  add_event "OpenVPN is active but TCP $PORT did not validate as the managed listener. Inspect: ss -ltnp 'sport = :$PORT'"
  finish false "failed" "NetPulse VPN service started but its configured TCP listener could not be verified." 1
fi

add_event "Managed OpenVPN service is active and owns TCP $PORT."
finish true "repaired" "NetPulse VPN service is ready for RouterOS onboarding." 0