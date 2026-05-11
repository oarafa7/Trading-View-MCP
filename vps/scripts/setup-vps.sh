#!/usr/bin/env bash
# Initial VPS setup for Hermes AI Agent on Hostinger Ubuntu 22.04
set -euo pipefail

echo "==> Updating system packages"
apt-get update -y && apt-get upgrade -y

echo "==> Installing dependencies"
apt-get install -y curl git ufw nginx certbot python3-certbot-nginx

echo "==> Installing Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Installing PM2"
npm install -g pm2

echo "==> Configuring firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Creating hermes user"
id -u hermes &>/dev/null || useradd -m -s /bin/bash hermes
usermod -aG sudo hermes

echo "==> Creating app directories"
mkdir -p /opt/hermes/{app,screenshots,logs,backups}
chown -R hermes:hermes /opt/hermes

echo "==> Done. Next: copy credentials.env to /opt/hermes/app/.env and deploy the app."
