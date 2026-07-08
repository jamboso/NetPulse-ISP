#!/usr/bin/env bash
set -e

DEPLOY_DIR="/opt/netpulse"

echo "==> Pulling latest code..."
git pull

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Rebuilding API server..."
pnpm --filter @workspace/api-server run build

echo "==> Applying database schema changes..."
pnpm --filter @workspace/db run push

echo "==> Restarting app..."
sudo pm2 restart netpulse

echo ""
echo "Done. NetPulse is up to date."
sudo pm2 status
