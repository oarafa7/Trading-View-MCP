#!/usr/bin/env bash
# Deploy / redeploy Hermes AI Agent on the VPS
# Run from local machine: bash vps/scripts/deploy.sh
set -euo pipefail

source "$(dirname "$0")/../credentials/credentials.env" 2>/dev/null || {
  echo "ERROR: credentials.env not found. Copy credentials.template.env and fill it in."
  exit 1
}

REMOTE="${VPS_USER}@${VPS_HOST}"
SSH_OPTS="-p ${VPS_SSH_PORT} -i ${VPS_SSH_KEY_PATH}"
APP_DIR="/opt/hermes/app"

echo "==> Syncing code to ${REMOTE}:${APP_DIR}"
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'vps/credentials/*.env' \
  -e "ssh ${SSH_OPTS}" . "${REMOTE}:${APP_DIR}"

echo "==> Installing dependencies and restarting PM2"
ssh ${SSH_OPTS} "${REMOTE}" "cd ${APP_DIR} && npm ci --production && pm2 restart hermes-agent || pm2 start npm --name hermes-agent -- start"

echo "==> Deploy complete."
