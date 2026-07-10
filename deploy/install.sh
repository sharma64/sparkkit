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
# Extraction backend is picked automatically: the openclaw CLI when
# installed (no API key needed), else the Anthropic API key below.
# Override with SPARKKIT_EXTRACT_BACKEND=openclaw|anthropic.
ANTHROPIC_API_KEY=
EOF
  chmod 600 "$ENV_FILE"
fi
if ! command -v openclaw >/dev/null && ! grep -q '^ANTHROPIC_API_KEY=.' "$ENV_FILE"; then
  echo "NOTE: no openclaw CLI and no ANTHROPIC_API_KEY in $ENV_FILE — phone scans will fail until one exists (then: systemctl restart sparkkit-receipts)"
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
