#!/usr/bin/env bash
# NetPulse ISP Manager — One-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR/REPO/main/deploy/install.sh | sudo bash
exec bash <(curl -fsSL https://raw.githubusercontent.com/YOUR/REPO/main/deploy/setup-ubuntu.sh) "$@"
