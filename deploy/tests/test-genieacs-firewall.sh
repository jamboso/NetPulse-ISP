#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
export GENIEACS_FIREWALL_DIR="${TMP}/state"
export GENIEACS_FIREWALL_PERSIST_DIR="${TMP}/persist"
export GENIEACS_FIREWALL_STATE="${GENIEACS_FIREWALL_DIR}/cwmp-firewall.state"
export GENIEACS_FIREWALL_TRANSACTION="${GENIEACS_FIREWALL_DIR}/cwmp-firewall.transaction"
mkdir -p "${GENIEACS_FIREWALL_PERSIST_DIR}"

die() { printf 'FAIL: %s\n' "$*" >&2; return 1; }
source "${ROOT}/deploy/lib/genieacs-firewall.sh"

v4=() v6=() saves=0 fail_save=false service_events=()
recovery_events=() record_recovery=false
stop_failure=false listener_active=false service_active=true restore_failures=0
iptables-save() { printf '%s\n' "${v4[@]}"; }
ip6tables-save() { printf '%s\n' "${v6[@]}"; }
iptables-restore() {
  local -a incoming
  mapfile -t incoming
  if (( restore_failures > 0 )); then
    restore_failures=$((restore_failures - 1))
    return 1
  fi
  v4=("${incoming[@]}")
  [[ "${record_recovery}" == "true" ]] && recovery_events+=("restore-v4")
  return 0
}
ip6tables-restore() {
  mapfile -t v6
  [[ "${record_recovery}" == "true" ]] && recovery_events+=("restore-v6")
  return 0
}
systemctl() {
  service_events+=("$1 $2")
  [[ "${record_recovery}" == "true" ]] && recovery_events+=("$1")
  case "$1" in
    stop)
      [[ "${stop_failure}" == "false" ]] || return 1
      service_active=false
      ;;
    start) service_active=true ;;
    is-active) [[ "${service_active}" == "true" ]] || return 3 ;;
  esac
  return 0
}
ss() { [[ "${listener_active}" == "true" ]] && printf 'LISTEN 0 128 0.0.0.0:%s\n' "${CWMP_PORT}"; }
iptables() {
  local n rule target
  case "$1" in
    -N) v4+=(":${2} - [0:0]") ;;
    -A) v4+=("-A $2 ${*:3}") ;;
    -I) v4=("-A $2 ${*:4}" "${v4[@]}") ;;
    -S) printf '%s\n' "${v4[@]}" | grep '^-A INPUT' || true ;;
    -L)
      printf 'num target prot opt source destination\n'
      n=0
      for rule in "${v4[@]}"; do
        [[ "${rule}" == "-A INPUT "* ]] || continue
        n=$((n + 1)); target="${rule##* -j }"
        printf '%s %s tcp -- 0.0.0.0/0 0.0.0.0/0\n' "${n}" "${target}"
      done
      ;;
    -D)
      n=0
      for i in "${!v4[@]}"; do
        [[ "${v4[$i]}" == "-A INPUT "* ]] || continue
        n=$((n + 1))
        [[ "${n}" == "$3" ]] && { unset 'v4[i]'; return 0; }
      done
      return 1
      ;;
    -F) for i in "${!v4[@]}"; do [[ "${v4[$i]}" == "-A $2 "* ]] && unset 'v4[i]'; done; return 0 ;;
    -X) for i in "${!v4[@]}"; do [[ "${v4[$i]}" == ":$2 "* ]] && unset 'v4[i]'; done; return 0 ;;
  esac
}
ip6tables() {
  local n rule target
  case "$1" in
    -N) v6+=(":${2} - [0:0]") ;;
    -A) v6+=("-A $2 ${*:3}") ;;
    -I) v6=("-A $2 ${*:4}" "${v6[@]}") ;;
    -S) printf '%s\n' "${v6[@]}" | grep '^-A INPUT' || true ;;
    -L)
      printf 'num target prot opt source destination\n'
      n=0
      for rule in "${v6[@]}"; do
        [[ "${rule}" == "-A INPUT "* ]] || continue
        n=$((n + 1)); target="${rule##* -j }"
        printf '%s %s tcp -- ::/0 ::/0\n' "${n}" "${target}"
      done
      ;;
    -D)
      n=0
      for i in "${!v6[@]}"; do
        [[ "${v6[$i]}" == "-A INPUT "* ]] || continue
        n=$((n + 1))
        [[ "${n}" == "$3" ]] && { unset 'v6[i]'; return 0; }
      done
      return 1
      ;;
    -F) for i in "${!v6[@]}"; do [[ "${v6[$i]}" == "-A $2 "* ]] && unset 'v6[i]'; done; return 0 ;;
    -X) for i in "${!v6[@]}"; do [[ "${v6[$i]}" == ":$2 "* ]] && unset 'v6[i]'; done; return 0 ;;
  esac
}
netfilter-persistent() {
  [[ "$1" == save ]] || return 1
  saves=$((saves + 1))
  [[ "${fail_save}" == false ]] || return 1
  printf 'saved-%s\n' "${saves}" > "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4"
  printf 'saved-%s\n' "${saves}" > "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6"
}

CWMP_PORT=7547
CWMP_CIDR_ARRAY=(10.10.0.0/16 192.168.50.0/24)
v4=("-A INPUT -j EXISTING")
v6=("-A INPUT -j EXISTING6")
printf 'before4\n' > "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4"
printf 'before6\n' > "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6"
firewall_apply_cwmp
printf '%s\n' "${v4[@]}" | grep -q -- '-s 10.10.0.0/16 -j ACCEPT'
printf '%s\n' "${v4[@]}" | grep -q -- '-j DROP'
[[ -f "${GENIEACS_FIREWALL_TRANSACTION}" && ! -f "${GENIEACS_FIREWALL_STATE}" ]]
firewall_commit_cwmp
[[ "$(cat "${GENIEACS_FIREWALL_STATE}" | grep '^CWMP_PORT=')" == 'CWMP_PORT=7547' ]]
# Simulate iptables -S output that would require shell quoting. Rerun cleanup
# must use numeric INPUT lines instead of attempting to parse this text.
for i in "${!v4[@]}"; do
  if [[ "${v4[$i]}" == *netpulse-genieacs-cwmp:* ]]; then
    v4[$i]="${v4[$i]/--comment netpulse-genieacs-cwmp:/--comment \"netpulse-genieacs-cwmp:}"
    v4[$i]="${v4[$i]/ -j /\" -j }"
  fi
done
for i in "${!v6[@]}"; do
  if [[ "${v6[$i]}" == *netpulse-genieacs-cwmp:* ]]; then
    v6[$i]="${v6[$i]/--comment netpulse-genieacs-cwmp:/--comment \"netpulse-genieacs-cwmp:}"
    v6[$i]="${v6[$i]/ -j /\" -j }"
  fi
done

# An open transaction is rolled back if a later installer step fails; it does
# not alter the committed marker.
before4=("${v4[@]}"); before6=("${v6[@]}")
before_persist="$(cat "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4")"
committed_state="$(cat "${GENIEACS_FIREWALL_STATE}")"
firewall_apply_cwmp
[[ -f "${GENIEACS_FIREWALL_TRANSACTION}" ]]
firewall_rollback_around_cwmp_service true
[[ "${service_events[0]}" == "stop genieacs-cwmp" ]]
[[ "${service_events[1]}" == "is-active --quiet" ]]
[[ "${service_events[2]}" == "start genieacs-cwmp" ]]
[[ "${v4[*]}" == "${before4[*]}" && "${v6[*]}" == "${before6[*]}" ]]
[[ "$(cat "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4")" == "${before_persist}" ]]
[[ "$(cat "${GENIEACS_FIREWALL_STATE}" | grep '^CWMP_PORT=')" == 'CWMP_PORT=7547' ]]

# A failed persistence also restores both live families and persisted files.
fail_save=true
if firewall_apply_cwmp; then die "persistence failure unexpectedly succeeded"; fi
firewall_rollback_if_open
[[ "${v4[*]}" == "${before4[*]}" && "${v6[*]}" == "${before6[*]}" ]]
[[ "$(cat "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4")" == "${before_persist}" ]]

# Reruns replace old owned dispatches rather than accumulating them.
fail_save=false
firewall_apply_cwmp
[[ "$(cat "${GENIEACS_FIREWALL_STATE}")" == "${committed_state}" ]]
firewall_commit_cwmp
dispatch_count="$(printf '%s\n' "${v4[@]}" | grep -c 'netpulse-genieacs-cwmp:')"
(( dispatch_count == 1 ))

# Startup recovery always stops CWMP before restoring. A first-install
# snapshot has no managed state, so the listener must remain stopped.
saved_committed_state="$(cat "${GENIEACS_FIREWALL_STATE}")"
rm -f "${GENIEACS_FIREWALL_STATE}"
firewall_begin_transaction
v4=("-A INPUT -j INTERRUPTED")
FIREWALL_TRANSACTION_OPEN=false
record_recovery=true
recovery_events=()
firewall_recover_interrupted_transaction
[[ "${recovery_events[*]}" == "stop is-active restore-v4 restore-v6" ]]
[[ ! -f "${GENIEACS_FIREWALL_STATE}" ]]

# A snapshot containing prior committed managed state resumes the old service
# only after both firewall families have been restored.
printf '%s\n' "${saved_committed_state}" > "${GENIEACS_FIREWALL_STATE}"
firewall_begin_transaction
v4=("-A INPUT -j INTERRUPTED_AGAIN")
FIREWALL_TRANSACTION_OPEN=false
recovery_events=()
firewall_recover_interrupted_transaction
[[ "${recovery_events[*]}" == "stop is-active restore-v4 restore-v6 start" ]]
record_recovery=false

# Fail safe: stop failure leaves the restrictive active state and marker.
firewall_begin_transaction
v4=("-A INPUT -j RESTRICTIVE_STOP_FAILURE")
candidate_v4="${v4[*]}"
stop_failure=true
if firewall_rollback_around_cwmp_service true; then die "stop failure unexpectedly restored firewall"; fi
[[ -f "${GENIEACS_FIREWALL_TRANSACTION}" && "${v4[*]}" == "${candidate_v4}" ]]
[[ "${service_events[-1]}" != "start genieacs-cwmp" ]]
stop_failure=false
service_active=true
firewall_rollback_around_cwmp_service false

# Fail safe: a listener surviving a successful stop also blocks restoration.
firewall_begin_transaction
v4=("-A INPUT -j RESTRICTIVE_LISTENER_FAILURE")
candidate_v4="${v4[*]}"
listener_active=true
service_active=true
if firewall_rollback_around_cwmp_service true; then die "live listener unexpectedly allowed firewall restore"; fi
[[ -f "${GENIEACS_FIREWALL_TRANSACTION}" && "${v4[*]}" == "${candidate_v4}" ]]
[[ "${service_events[-1]}" != "start genieacs-cwmp" ]]
listener_active=false
firewall_rollback_around_cwmp_service false

# Fail safe: a restore error reapplies the captured restrictive candidate,
# retains the transaction, and never restarts the service.
firewall_begin_transaction
v4=("-A INPUT -j RESTRICTIVE_RESTORE_FAILURE")
candidate_v4="${v4[*]}"
restore_failures=1
service_active=true
if firewall_rollback_around_cwmp_service true; then die "restore failure unexpectedly succeeded"; fi
[[ -f "${GENIEACS_FIREWALL_TRANSACTION}" && "${v4[*]}" == "${candidate_v4}" ]]
[[ "${service_events[-1]}" != "start genieacs-cwmp" ]]
restore_failures=0
firewall_rollback_around_cwmp_service false
echo "genieacs firewall tests: PASS"