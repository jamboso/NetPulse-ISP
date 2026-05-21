#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  NetPulse — update script
#  Run this on the server whenever you push new code to GitHub.
#  Usage: cd /opt/netpulse && bash deploy/update.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
APP_DIR="/opt/netpulse"
cd "$APP_DIR"

echo "▶ Pulling latest code..."
git pull origin main

echo "▶ Installing dependencies..."
pnpm install --frozen-lockfile

echo "▶ Rebuilding shared libs..."
pnpm run typecheck:libs

echo "▶ Building API server..."
pnpm --filter @workspace/api-server run build

echo "▶ Building frontend..."
source "$APP_DIR/.env"
PORT=3000 BASE_PATH=/ \
  VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" \
  VITE_CLERK_PROXY_URL="${VITE_CLERK_PROXY_URL:-}" \
  pnpm --filter @workspace/isp-portal run build

echo "▶ Running database migrations..."
pnpm --filter @workspace/db run push

echo "▶ Restarting app..."
pm2 restart netpulse

echo "✅ Update complete."
