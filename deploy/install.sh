#!/usr/bin/env bash
# One-time setup for receipts.circuitandsoil.au on forgevps.
# Run as: sudo bash deploy/install.sh   (re-running is safe)
set -euo pipefail

REPO=https://github.com/sharma64/sparkkit.git
SRV=/srv/sparkkit
ENV_FILE=/etc/sparkkit-receipts.env
# Ledger's CLI wrappers and the API must share one store: point the API
# at the DB inside Ledger's working clone.
DB=/home/sharma/.openclaw/workspace/_external/sparkkit/receipts/receipts.sqlite3

if [ ! -d "$SRV/.git" ]; then
  git clone "$REPO" "$SRV"
else
  git -C "$SRV" pull --ff-only
fi
chown -R sharma:sharma "$SRV"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
SPARKKIT_RECEIPTS_DB=$DB
SPARKKIT_RECEIPTS_TOKEN=$(openssl rand -hex 32)
SPARKKIT_RECEIPTS_HOST=127.0.0.1
SPARKKIT_RECEIPTS_PORT=8787
# Required for the phone's Scan tab to work without its own key — paste
# an Anthropic API key below, then: sudo systemctl restart sparkkit-receipts
ANTHROPIC_API_KEY=
EOF
  chmod 600 "$ENV_FILE"
fi
if ! grep -q '^ANTHROPIC_API_KEY=.' "$ENV_FILE"; then
  echo "NOTE: ANTHROPIC_API_KEY is not set in $ENV_FILE — phone scans will fail until you add it and run: systemctl restart sparkkit-receipts"
fi

install -m 644 "$SRV/deploy/sparkkit-receipts.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now sparkkit-receipts
systemctl restart sparkkit-receipts

if ! grep -q '^receipts\.circuitandsoil\.au' /etc/caddy/Caddyfile; then
  cat "$SRV/deploy/Caddyfile.receipts" >> /etc/caddy/Caddyfile
fi
systemctl reload caddy

sleep 1
curl -fsS http://127.0.0.1:8787/health && echo " ← API healthy"
echo "Server token — paste into the app: Settings → Ledger sync"
grep TOKEN "$ENV_FILE" | cut -d= -f2
