#!/usr/bin/env bash
# NetPulse ISP Manager — One-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/jamboso/NetPulse-ISP/main/deploy/install.sh | sudo bash
exec bash <(curl -fsSL https://raw.githubusercontent.com/jamboso/NetPulse-ISP/main/deploy/setup-ubuntu.sh) "$@"
