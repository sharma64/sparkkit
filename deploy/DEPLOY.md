# Deploying SparkKit Receipts on forgevps

The receipts app is served at **https://receipts.circuitandsoil.au** — Caddy
serves the PWA from `/srv/sparkkit/receipts` and proxies `/api/*` to the
receipts API (`server.py`) on `127.0.0.1:8787`.

## First-time setup

1. DNS: add an `A` record `receipts.circuitandsoil.au → 5.223.55.146`.
2. On forgevps: `sudo bash deploy/install.sh` — clones/updates `/srv/sparkkit`,
   writes `/etc/sparkkit-receipts.env` (generates the bearer token, printed at
   the end), installs + starts the `sparkkit-receipts` systemd unit, appends
   the Caddy vhost, and reloads Caddy.
3. Extraction backend: nothing to configure on forgevps — the `openclaw`
   CLI is installed, so phone scans ride the box's existing agent/model
   account (no API key). On a box without OpenClaw, either set
   `ANTHROPIC_API_KEY=sk-ant-...` in `/etc/sparkkit-receipts.env` and
   `sudo systemctl restart sparkkit-receipts`, or leave it and give the
   phone a fallback key (Settings → Advanced). See
   `receipts/SERVER_API.md` → `POST /receipts/extract`.
4. On the phone: open the site, Settings → Ledger sync, URL
   `https://receipts.circuitandsoil.au/api`, paste the token, Save & sync.
   No API key is needed on the phone — extraction runs on the server.

## Updating

- App/API code: `git -C /srv/sparkkit pull` then
  `sudo systemctl restart sparkkit-receipts` (only needed for `server.py`
  changes; static files are picked up immediately).

## Data

- Source of truth: SQLite at
  `/home/sharma/.openclaw/workspace/_external/sparkkit/receipts/receipts.sqlite3`
  — shared between the API service and Ledger's CLI wrappers
  (`~/.openclaw/workspace-ledger/bin/`). WAL mode; multi-process safe.
- Never commit the DB or the token. Backups: copy the sqlite3 file (plus
  `-wal`/`-shm` siblings) or use `GET /api/receipts/export.csv`.
