#!/usr/bin/env bash
# Reads the active NetPulse OpenVPN certificate bundle for the server-side API.
# This helper is root-owned and may only be invoked through its exact sudoers rule.
set -euo pipefail

CONFIG="/etc/openvpn/server/netpulse.conf"

die() {
  echo "$*" >&2
  exit 1
}

[[ "${1:-}" == "--json" && $# -eq 1 ]] \
  || die "Usage: netpulse-vpn-read-certificates --json"
[[ -f "$CONFIG" ]] || die "NetPulse OpenVPN configuration was not found."

config_value() {
  local key="$1"
  awk -v key="$key" '$1 == key { print $2; exit }' "$CONFIG"
}

CA_CERT="$(config_value ca)"
SERVER_CERT="$(config_value cert)"
SERVER_KEY="$(config_value key)"

case "${CA_CERT}:${SERVER_CERT}:${SERVER_KEY}" in
  "/etc/openvpn/netpulse/ca.crt:/etc/openvpn/netpulse/server.crt:/etc/openvpn/netpulse/server.key")
    CA_KEY_CANDIDATES=(
      "/etc/openvpn/netpulse-easy-rsa/pki/private/ca.key"
    )
    ;;
  "/etc/openvpn/server/certs/ca.crt:/etc/openvpn/server/certs/server.crt:/etc/openvpn/server/certs/server.key")
    CA_KEY_CANDIDATES=(
      "/etc/openvpn/server/certs/ca.key"
      "/etc/openvpn/server/easy-rsa/pki/private/ca.key"
      "/etc/openvpn/easy-rsa/pki/private/ca.key"
    )
    ;;
  *)
    die "The active NetPulse configuration does not use an approved certificate layout."
    ;;
esac

[[ -r "$CA_CERT" && -r "$SERVER_CERT" && -r "$SERVER_KEY" ]] \
  || die "The active NetPulse certificate files are not readable."

CA_KEY=""
for candidate in "${CA_KEY_CANDIDATES[@]}"; do
  if [[ -r "$candidate" ]]; then
    CA_KEY="$candidate"
    break
  fi
done
[[ -n "$CA_KEY" ]] || die "The active NetPulse CA signing key was not found."

public_key_hash_from_cert() {
  openssl x509 -in "$1" -noout -pubkey \
    | openssl pkey -pubin -outform DER \
    | sha256sum \
    | awk '{print $1}'
}

public_key_hash_from_key() {
  openssl pkey -in "$1" -pubout -outform DER \
    | sha256sum \
    | awk '{print $1}'
}

[[ "$(public_key_hash_from_cert "$CA_CERT")" == "$(public_key_hash_from_key "$CA_KEY")" ]] \
  || die "The active NetPulse CA certificate does not match its signing key."
[[ "$(public_key_hash_from_cert "$SERVER_CERT")" == "$(public_key_hash_from_key "$SERVER_KEY")" ]] \
  || die "The active NetPulse server certificate does not match its private key."
openssl verify -CAfile "$CA_CERT" "$SERVER_CERT" >/dev/null \
  || die "The active NetPulse server certificate is not issued by its CA."

encode_file() {
  base64 -w 0 "$1"
}

printf '{"caCert":"%s","caKey":"%s","serverCert":"%s","serverKey":"%s"}\n' \
  "$(encode_file "$CA_CERT")" \
  "$(encode_file "$CA_KEY")" \
  "$(encode_file "$SERVER_CERT")" \
  "$(encode_file "$SERVER_KEY")"