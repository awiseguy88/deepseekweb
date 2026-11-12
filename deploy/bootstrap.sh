#!/bin/sh
# One-time Linode (Ubuntu 22.04/24.04) bootstrap for the WiseAI host.
# Run as root on a fresh server: sh deploy/bootstrap.sh
set -eu

# Never prompt: the script runs over a non-interactive SSH session, and
# needrestart/perl debconf prompts otherwise block apt indefinitely.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
APT_OPTS='-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold'

if [ "$(id -u)" -ne 0 ]; then
  echo 'run as root' >&2
  exit 1
fi

apt-get update
# shellcheck disable=SC2086
apt-get -y $APT_OPTS upgrade
# shellcheck disable=SC2086
apt-get -y $APT_OPTS install ca-certificates curl git ufw fail2ban unattended-upgrades rsync

# Docker Engine + compose plugin.
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# 4 GiB swap for a 4-8 GiB Linode running Postgres, Caddy, and agent work.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Persistent data layout. /data is the single attached volume on the Linode.
mkdir -p /data/wiseai /data/postgres /data/caddy /data/caddy-config
mkdir -p /data/wiseai/workspaces/tenants
chmod 711 /data/wiseai/workspaces
chmod 711 /data/wiseai/workspaces/tenants

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades

echo
echo 'Bootstrap complete. Next:'
echo '  1. clone the repository to /opt/wiseai'
echo '  2. cp deploy/.env.example deploy/.env and fill it in'
echo '  3. cd /opt/wiseai/deploy && docker compose up -d --build'
echo
