#!/usr/bin/env bash
# Shell helpers for the narrowly-scoped GenieACS CWMP iptables transaction.
# This file is sourced by setup-genieacs.sh and is intentionally usable by tests.

: "${GENIEACS_FIREWALL_DIR:=/etc/genieacs}"
: "${GENIEACS_FIREWALL_STATE:=${GENIEACS_FIREWALL_DIR}/cwmp-firewall.state}"
: "${GENIEACS_FIREWALL_TRANSACTION:=${GENIEACS_FIREWALL_DIR}/cwmp-firewall.transaction}"
: "${GENIEACS_FIREWALL_PERSIST_DIR:=/etc/iptables}"

firewall_die() { die "$*"; }

firewall_require_backend() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    firewall_die "UFW is active. Refusing to mix UFW with direct netfilter-persistent rules; disable/migrate UFW first."
  fi
  command -v iptables >/dev/null 2>&1 && command -v ip6tables >/dev/null 2>&1 \
    && command -v iptables-save >/dev/null 2>&1 && command -v iptables-restore >/dev/null 2>&1 \
    && command -v ip6tables-save >/dev/null 2>&1 && command -v ip6tables-restore >/dev/null 2>&1 \
    || firewall_die "iptables/ip6tables tools are required for the CWMP firewall transaction."
  systemctl is-active --quiet netfilter-persistent \
    || firewall_die "netfilter-persistent must already be active. Configure and start it before running this installer."
}

firewall_validate_transaction_marker() {
  local snapshot_dir snapshot_base marker
  [[ -f "${GENIEACS_FIREWALL_TRANSACTION}" ]] || return 1
  mapfile -t marker < "${GENIEACS_FIREWALL_TRANSACTION}"
  [[ "${#marker[@]}" -eq 1 && "${marker[0]}" == SNAPSHOT_DIR=* ]] \
    || firewall_die "CWMP firewall transaction marker is invalid."
  snapshot_dir="${marker[0]#SNAPSHOT_DIR=}"
  [[ "${snapshot_dir}" == "${GENIEACS_FIREWALL_DIR}/"* ]] \
    || firewall_die "CWMP firewall transaction snapshot path is invalid."
  snapshot_base="${snapshot_dir#"${GENIEACS_FIREWALL_DIR}/"}"
  [[ "${snapshot_base}" =~ ^cwmp-firewall\.rollback\.[A-Za-z0-9]{6}$ ]] \
    || firewall_die "CWMP firewall transaction snapshot path is invalid."
  FIREWALL_MARKER_SNAPSHOT_DIR="${snapshot_dir}"
}

firewall_restore_transaction() {
  local snapshot_dir current_dir restore_failed=false
  [[ -f "${GENIEACS_FIREWALL_TRANSACTION}" ]] || return 0
  firewall_validate_transaction_marker
  snapshot_dir="${FIREWALL_MARKER_SNAPSHOT_DIR}"
  [[ -f "${snapshot_dir}/active.v4" && -f "${snapshot_dir}/active.v6" ]] \
    || firewall_die "CWMP firewall transaction snapshot is incomplete: ${snapshot_dir}"
  current_dir="$(mktemp -d "${GENIEACS_FIREWALL_DIR}/cwmp-firewall.current.XXXXXX")"
  iptables-save > "${current_dir}/active.v4"
  ip6tables-save > "${current_dir}/active.v6"
  [[ -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" ]] && cp -a "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" "${current_dir}/persisted.v4"
  [[ -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" ]] && cp -a "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" "${current_dir}/persisted.v6"
  [[ -f "${GENIEACS_FIREWALL_STATE}" ]] && cp -a "${GENIEACS_FIREWALL_STATE}" "${current_dir}/managed.state"

  iptables-restore < "${snapshot_dir}/active.v4" || restore_failed=true
  [[ "${restore_failed}" == "true" ]] || ip6tables-restore < "${snapshot_dir}/active.v6" || restore_failed=true
  if [[ "${restore_failed}" != "true" ]]; then
    if [[ -f "${snapshot_dir}/persisted.v4" ]]; then
      install -D -m 0600 "${snapshot_dir}/persisted.v4" "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" || restore_failed=true
    else
      rm -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" || restore_failed=true
    fi
  fi
  if [[ "${restore_failed}" != "true" ]]; then
    if [[ -f "${snapshot_dir}/persisted.v6" ]]; then
      install -D -m 0600 "${snapshot_dir}/persisted.v6" "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" || restore_failed=true
    else
      rm -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" || restore_failed=true
    fi
  fi
  if [[ "${restore_failed}" != "true" ]]; then
    if [[ -f "${snapshot_dir}/managed.state" ]]; then
      install -D -m 0600 "${snapshot_dir}/managed.state" "${GENIEACS_FIREWALL_STATE}" || restore_failed=true
    else
      rm -f "${GENIEACS_FIREWALL_STATE}" || restore_failed=true
    fi
  fi
  if [[ "${restore_failed}" == "true" ]]; then
    # Reapply the restrictive in-progress state. Keep the marker and rollback
    # snapshot intact so an operator can retry after fixing the restore error.
    iptables-restore < "${current_dir}/active.v4" || true
    ip6tables-restore < "${current_dir}/active.v6" || true
    if [[ -f "${current_dir}/persisted.v4" ]]; then
      install -D -m 0600 "${current_dir}/persisted.v4" "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" || true
    else
      rm -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" || true
    fi
    if [[ -f "${current_dir}/persisted.v6" ]]; then
      install -D -m 0600 "${current_dir}/persisted.v6" "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" || true
    else
      rm -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" || true
    fi
    if [[ -f "${current_dir}/managed.state" ]]; then
      install -D -m 0600 "${current_dir}/managed.state" "${GENIEACS_FIREWALL_STATE}" || true
    else
      rm -f "${GENIEACS_FIREWALL_STATE}" || true
    fi
    rm -rf "${current_dir}"
    printf 'ERROR: CWMP firewall restore failed; the restrictive candidate and transaction marker were retained.\n' >&2
    return 1
  fi
  rm -rf "${current_dir}"
  rm -f "${GENIEACS_FIREWALL_TRANSACTION}"
  rm -rf "${snapshot_dir}"
  FIREWALL_TRANSACTION_OPEN=false
  FIREWALL_SNAPSHOT_DIR=""
}

firewall_stop_and_verify_cwmp() {
  local port="$1"
  systemctl stop genieacs-cwmp >/dev/null 2>&1 || {
    printf 'ERROR: Could not stop genieacs-cwmp; restrictive firewall transaction retained.\n' >&2
    return 1
  }
  if systemctl is-active --quiet genieacs-cwmp; then
    printf 'ERROR: genieacs-cwmp is still active; restrictive firewall transaction retained.\n' >&2
    return 1
  fi
  command -v ss >/dev/null 2>&1 || {
    printf 'ERROR: Cannot verify the CWMP listener is closed because ss is unavailable; restrictive firewall transaction retained.\n' >&2
    return 1
  }
  if ss -H -ltn "( sport = :${port} )" 2>/dev/null | grep -q .; then
    printf 'ERROR: TCP port %s is still listening; restrictive firewall transaction retained.\n' "${port}" >&2
    return 1
  fi
}

firewall_recover_interrupted_transaction() {
  local restart_preexisting=false snapshot_dir recovery_port="${CWMP_PORT}"
  [[ -f "${GENIEACS_FIREWALL_TRANSACTION}" ]] || return 0
  firewall_validate_transaction_marker
  snapshot_dir="${FIREWALL_MARKER_SNAPSHOT_DIR}"
  if [[ -f "${snapshot_dir}/managed.state" ]]; then
    restart_preexisting=true
    recovery_port="$(awk -F= '$1 == "CWMP_PORT" { print $2; exit }' "${snapshot_dir}/managed.state")"
    [[ "${recovery_port}" =~ ^[0-9]{1,5}$ ]] \
      || firewall_die "CWMP firewall snapshot has an invalid managed port."
  fi

  # A previous process may have left the public listener running. Restore the
  # old firewall only while CWMP is stopped, then resume only a service proven
  # to have had prior committed managed state in the snapshot.
  firewall_stop_and_verify_cwmp "${recovery_port}" || return 1
  firewall_restore_transaction || return 1
  if [[ "${restart_preexisting}" == "true" ]]; then
    systemctl start genieacs-cwmp >/dev/null 2>&1 || true
  fi
}

firewall_begin_transaction() {
  local snapshot_dir
  firewall_recover_interrupted_transaction
  install -d -m 0700 "${GENIEACS_FIREWALL_DIR}"
  snapshot_dir="$(mktemp -d "${GENIEACS_FIREWALL_DIR}/cwmp-firewall.rollback.XXXXXX")"
  iptables-save > "${snapshot_dir}/active.v4"
  ip6tables-save > "${snapshot_dir}/active.v6"
  [[ -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" ]] && cp -a "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v4" "${snapshot_dir}/persisted.v4"
  [[ -f "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" ]] && cp -a "${GENIEACS_FIREWALL_PERSIST_DIR}/rules.v6" "${snapshot_dir}/persisted.v6"
  [[ -f "${GENIEACS_FIREWALL_STATE}" ]] && cp -a "${GENIEACS_FIREWALL_STATE}" "${snapshot_dir}/managed.state"
  umask 077
  printf 'SNAPSHOT_DIR=%s\n' "${snapshot_dir}" > "${GENIEACS_FIREWALL_TRANSACTION}"
  chmod 0600 "${GENIEACS_FIREWALL_TRANSACTION}"
  FIREWALL_SNAPSHOT_DIR="${snapshot_dir}"
  FIREWALL_TRANSACTION_OPEN=true
}

firewall_rollback_if_open() {
  [[ "${FIREWALL_TRANSACTION_OPEN:-false}" == "true" ]] || return 0
  firewall_restore_transaction || return 1
}

firewall_rollback_around_cwmp_service() {
  local was_preexisting="$1"
  [[ "${FIREWALL_TRANSACTION_OPEN:-false}" == "true" ]] || return 0
  firewall_stop_and_verify_cwmp "${CWMP_PORT}" || return 1
  firewall_rollback_if_open || return 1
  if [[ "${was_preexisting}" == "true" ]]; then
    systemctl start genieacs-cwmp >/dev/null 2>&1 || true
  fi
}

firewall_read_committed_state() {
  local -a state
  FIREWALL_OLD_PORT=""
  FIREWALL_OLD_CHAIN4=""
  FIREWALL_OLD_CHAIN6=""
  [[ -f "${GENIEACS_FIREWALL_STATE}" ]] || return 0
  mapfile -t state < "${GENIEACS_FIREWALL_STATE}"
  [[ "${#state[@]}" -eq 3 ]] || firewall_die "CWMP firewall state marker is invalid."
  for line in "${state[@]}"; do
    case "${line}" in
      CWMP_PORT=*) FIREWALL_OLD_PORT="${line#CWMP_PORT=}" ;;
      IPTABLES_CHAIN=*) FIREWALL_OLD_CHAIN4="${line#IPTABLES_CHAIN=}" ;;
      IP6TABLES_CHAIN=*) FIREWALL_OLD_CHAIN6="${line#IP6TABLES_CHAIN=}" ;;
      *) firewall_die "CWMP firewall state marker is invalid." ;;
    esac
  done
  [[ "${FIREWALL_OLD_PORT}" =~ ^[0-9]{1,5}$ && "${FIREWALL_OLD_CHAIN4}" =~ ^NP_GACS4_[0-9]{12}$ && "${FIREWALL_OLD_CHAIN6}" =~ ^NP_GACS6_[0-9]{12}$ ]] \
    || firewall_die "CWMP firewall state marker contains invalid values."
}

firewall_remove_exact_dispatch() {
  local tool="$1" old_chain="$2" line_number
  # Delete in descending numeric order so earlier line numbers cannot shift.
  # The target column is machine-safe and the chain name came from a strictly
  # validated, root-only committed marker; no rule serialization is re-parsed.
  while IFS= read -r line_number; do
    [[ "${line_number}" =~ ^[0-9]+$ ]] || firewall_die "Invalid INPUT rule number while retiring ${old_chain}."
    "$tool" -D INPUT "${line_number}"
  done < <("$tool" -L INPUT --line-numbers -n \
    | awk -v target="${old_chain}" '$2 == target { print $1 }' \
    | sort -rn)
  return 0
}

firewall_apply_cwmp() {
  local tag chain4 chain6 cidr
  tag="$(date +%s%N)"
  chain4="NP_GACS4_${tag: -12}"
  chain6="NP_GACS6_${tag: -12}"
  firewall_read_committed_state
  firewall_begin_transaction

  # Populate detached candidate chains completely. Existing dispatches remain
  # in INPUT until a populated candidate is ready.
  iptables -N "${chain4}"
  for cidr in "${CWMP_CIDR_ARRAY[@]}"; do
    cidr="${cidr//[[:space:]]/}"
    iptables -A "${chain4}" -s "${cidr}" -j ACCEPT
  done
  iptables -A "${chain4}" -j DROP
  ip6tables -N "${chain6}"
  ip6tables -A "${chain6}" -j DROP

  iptables -I INPUT 1 -p tcp --dport "${CWMP_PORT}" -m comment \
    --comment "netpulse-genieacs-cwmp:${tag}" -j "${chain4}"
  ip6tables -I INPUT 1 -p tcp --dport "${CWMP_PORT}" -m comment \
    --comment "netpulse-genieacs-cwmp:${tag}" -j "${chain6}"
  netfilter-persistent save || {
    firewall_rollback_around_cwmp_service "${GENIEACS_PREEXISTING:-false}"
    return 1
  }

  FIREWALL_CANDIDATE_CHAIN4="${chain4}"
  FIREWALL_CANDIDATE_CHAIN6="${chain6}"
}

firewall_commit_cwmp() {
  [[ "${FIREWALL_TRANSACTION_OPEN:-false}" == "true" ]] \
    || firewall_die "No CWMP firewall transaction is open to commit."
  [[ "${FIREWALL_CANDIDATE_CHAIN4:-}" =~ ^NP_GACS4_[0-9]{12}$ && "${FIREWALL_CANDIDATE_CHAIN6:-}" =~ ^NP_GACS6_[0-9]{12}$ ]] \
    || firewall_die "CWMP firewall candidate state is invalid."

  # Retire only the chains recorded by the prior committed marker. The old
  # dispatch is removed first, so an old chain is never flushed while live.
  if [[ -n "${FIREWALL_OLD_CHAIN4}" && "${FIREWALL_OLD_CHAIN4}" != "${FIREWALL_CANDIDATE_CHAIN4}" ]]; then
    firewall_remove_exact_dispatch iptables "${FIREWALL_OLD_CHAIN4}"
    if iptables -S "${FIREWALL_OLD_CHAIN4}" >/dev/null 2>&1; then
      iptables -F "${FIREWALL_OLD_CHAIN4}"
      iptables -X "${FIREWALL_OLD_CHAIN4}"
    fi
  fi
  if [[ -n "${FIREWALL_OLD_CHAIN6}" && "${FIREWALL_OLD_CHAIN6}" != "${FIREWALL_CANDIDATE_CHAIN6}" ]]; then
    firewall_remove_exact_dispatch ip6tables "${FIREWALL_OLD_CHAIN6}"
    if ip6tables -S "${FIREWALL_OLD_CHAIN6}" >/dev/null 2>&1; then
      ip6tables -F "${FIREWALL_OLD_CHAIN6}"
      ip6tables -X "${FIREWALL_OLD_CHAIN6}"
    fi
  fi
  netfilter-persistent save || {
    firewall_rollback_around_cwmp_service "${GENIEACS_PREEXISTING:-false}"
    return 1
  }

  umask 077
  {
    printf 'CWMP_PORT=%q\n' "${CWMP_PORT}"
    printf 'IPTABLES_CHAIN=%s\n' "${FIREWALL_CANDIDATE_CHAIN4}"
    printf 'IP6TABLES_CHAIN=%s\n' "${FIREWALL_CANDIDATE_CHAIN6}"
  } > "${GENIEACS_FIREWALL_STATE}"
  chmod 0600 "${GENIEACS_FIREWALL_STATE}"
  rm -f "${GENIEACS_FIREWALL_TRANSACTION}"
  rm -rf "${FIREWALL_SNAPSHOT_DIR:?missing CWMP firewall snapshot directory}"
  FIREWALL_TRANSACTION_OPEN=false
}

firewall_reject_port_change() {
  local desired_port="$1" managed_port
  [[ -f "${GENIEACS_FIREWALL_STATE}" ]] || return 0
  firewall_read_committed_state
  managed_port="${FIREWALL_OLD_PORT}"
  [[ -n "${managed_port}" && "${managed_port}" != "${desired_port}" ]] \
    && firewall_die "CWMP port was previously committed as ${managed_port}; port changes are refused to avoid a firewall exposure."
}