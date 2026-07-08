#!/usr/bin/env bash
# NetPulse ISP Manager — One-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/jamboso/NetPulse-ISP/main/deploy/install.sh | sudo bash

SETUP_URL="https://raw.githubusercontent.com/jamboso/NetPulse-ISP/main/deploy/setup-ubuntu.sh"

TMPFILE=$(mktemp /tmp/netpulse-install.XXXXXX.sh)
trap 'rm -f "$TMPFILE"' EXIT

curl -fsSL "$SETUP_URL" -o "$TMPFILE"
chmod +x "$TMPFILE"

exec bash "$TMPFILE" "$@" < /dev/tty
