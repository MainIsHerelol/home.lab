#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICES_DIR=/opt/home-lab/services
OWNER="${SUDO_USER:-homelab}"

command -v docker >/dev/null || { echo "Docker is required but was not found." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose plugin is required but was not found." >&2; exit 1; }

id "$OWNER" >/dev/null 2>&1 || { echo "Local owner '$OWNER' does not exist." >&2; exit 1; }
install -d -m 2770 -o "$OWNER" -g "$OWNER" /srv/family
install -d -m 0750 "$SERVICES_DIR"
install -m 0644 "$SOURCE_DIR/services/compose.yaml" "$SERVICES_DIR/compose.yaml"
mkdir -p "$SERVICES_DIR"/{filebrowser/database,filebrowser/config,portainer,uptime-kuma}
cd "$SERVICES_DIR"
docker compose pull
docker compose up -d

if ! docker compose exec -T files filebrowser users ls --database /database/filebrowser.db 2>/dev/null | grep -q 'admin'; then
  echo "Create the initial File Browser administrator account."
  read -r -p "Administrator username [admin]: " FILES_ADMIN
  FILES_ADMIN="${FILES_ADMIN:-admin}"
  read -r -s -p "Administrator password: " FILES_PASSWORD
  echo
  [[ -n "$FILES_PASSWORD" ]] || { echo "A password is required." >&2; exit 1; }
  docker compose exec -T files filebrowser users add "$FILES_ADMIN" "$FILES_PASSWORD" --perm.admin --database /database/filebrowser.db
  unset FILES_PASSWORD
fi
apache2ctl configtest
systemctl reload apache2
cat <<'EOF'

Services are running locally. Add these Technitium A records -> 192.168.11.12:
  files.home.lab
  portainer.home.lab
  uptime.home.lab

Open files.home.lab and sign in with the administrator account you created.
EOF
