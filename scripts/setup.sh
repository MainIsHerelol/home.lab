#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/home-lab

if ! command -v apt-get >/dev/null; then
  echo "This setup script currently supports Debian/Ubuntu systems only." >&2
  exit 1
fi

apt-get update
# NodeSource's Node.js package already bundles npm and conflicts with Debian's
# separate `npm` package on Debian 13. This project has no npm dependencies, so
# installing the separate package is unnecessary and can force a Node downgrade.
apt-get install -y apache2 nodejs qrencode rsync sqlite3
systemctl stop home-lab 2>/dev/null || true
id -u home-lab >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin home-lab
install -d -o home-lab -g home-lab "$APP_DIR" "$APP_DIR/data" "$APP_DIR/uploads" "$APP_DIR/data/backups"
rsync -a --delete --exclude .git --exclude node_modules --exclude 'data/*.db' --exclude data/backups --exclude uploads/ "$SOURCE_DIR/" "$APP_DIR/"
cd "$APP_DIR"
chown -R home-lab:home-lab "$APP_DIR"

install -m 0644 "$APP_DIR/scripts/home-lab.service" /etc/systemd/system/home-lab.service
install -m 0644 "$APP_DIR/scripts/apache-home-lab.conf" /etc/apache2/sites-available/home-lab.conf
a2enmod proxy proxy_http headers
a2ensite home-lab.conf
apache2ctl configtest
systemctl daemon-reload
systemctl enable --now home-lab
systemctl reload apache2
echo "Installed. Add Technitium records for home.lab, tools.home.lab, and status.home.lab -> 192.168.11.12."
