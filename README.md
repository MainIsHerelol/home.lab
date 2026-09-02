# Home Lab portal

Private, family-friendly dashboard sites for a Technitium DNS zone:

- `home.lab` — household links and administrator announcements
- `tools.home.lab` — private-network toolbox
- `status.home.lab` — service health and host metrics

## Local development

```bash
npm start
```

Open `http://localhost:3080` and use the `Host` header (or the Apache setup below)
to select a site. Data is stored locally in `data/home-lab.db`; uploaded images are
stored in `uploads/`.

## Server installation

1. In Technitium, create `A` records for `home.lab`, `tools.home.lab`, and
   `status.home.lab` that point to `192.168.11.12`.
2. Run `sudo ./scripts/setup.sh` from this checkout. It installs missing Debian
   packages, copies the project to `/opt/home-lab`, creates the systemd service,
   and enables Apache virtual hosts.
3. Open `http://home.lab`. The admin area is at `http://home.lab/admin` and is
   limited to `192.168.11.0/24` by Apache and the application.

Edit `data/config.json` (or use `/admin`) to maintain dashboard cards and service
checks. Run `sudo ./scripts/backup.sh` to create a local backup. The systemd unit
keeps the Node service running after boot.

> The included Apache configuration uses HTTP on a trusted LAN. Add internal TLS
> only after you have a certificate strategy trusted by your household devices.
