#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR=/opt/home-lab
DEST="$APP_DIR/data/backups/home-lab-$(date +%Y%m%d-%H%M%S).tar.gz"
install -d -o home-lab -g home-lab "$APP_DIR/data/backups"
tar -C "$APP_DIR" -czf "$DEST" data/config.json data/home-lab.db uploads
chown home-lab:home-lab "$DEST"
find "$APP_DIR/data/backups" -type f -name 'home-lab-*.tar.gz' -mtime +30 -delete
echo "Created $DEST"
