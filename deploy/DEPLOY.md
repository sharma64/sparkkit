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
3. Add an Anthropic key so the phone never needs its own:
   `sudo nano /etc/sparkkit-receipts.env`, set `ANTHROPIC_API_KEY=sk-ant-...`,
   then `sudo systemctl restart sparkkit-receipts`. Without this, the Scan
   tab fails with "Server has no ANTHROPIC_API_KEY configured" once a phone
   has Ledger sync turned on (see `receipts/SERVER_API.md` →
   `POST /receipts/extract`).
4. On the phone: open the site, Settings → Ledger sync, URL
   `https://receipts.circuitandsoil.au/api`, paste the token, Save & sync.
   The local "Anthropic API key" section disappears once sync is connected —
   extraction now runs on the server.

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
