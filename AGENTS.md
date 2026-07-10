# SparkKit — agent brief

Primary maintainer-agent: **Ledger** (OpenClaw finance agent on forgevps).
Owner: Sharma (sharma64). This file is the standing context for any agent
working in this repo.

## What this is

AU/NZ electrical apprentice toolkit. Static PWAs, **no build step, no
framework, no backend dependencies beyond the receipts API**:

- `/` — calculators & reference (main SparkKit app).
- `/receipts/` — receipt capture: PWA (`index.html`, `app.js`, `styles.css`,
  `sw.js`) plus a stdlib-only Python API (`server.py`, contract in
  `contract.py`, CLI in `receipt_cli.py`). Docs: `receipts/SERVER_API.md`,
  `receipts/CHAT_INTAKE.md`.

## Receipts architecture

Two intake paths, one store:

1. **Phone PWA** (https://receipts.circuitandsoil.au) — scans with the
   owner's Anthropic key in-browser, then syncs records to the API
   (`Settings → Ledger sync`; bearer token).
2. **Ledger chat intake** — Discord photos / iCloud shared links, extracted
   server-side, saved via the wrappers in
   `~/.openclaw/workspace-ledger/bin/` (runbook:
   `~/.openclaw/workspace-ledger/RECEIPTS.md`).

Source of truth: SQLite DB shared by both paths (path in
`/etc/sparkkit-receipts.env`; currently inside Ledger's clone at
`~/.openclaw/workspace/_external/sparkkit/receipts/`). The PWA's IndexedDB
is an offline cache that reconciles on sync. Deployment: `deploy/DEPLOY.md`.

## Conventions & guardrails

- Keep it dependency-free: vanilla JS in the apps, stdlib-only in
  `server.py`. Match the existing terse style.
- Extraction rules: strict JSON schema (`contract.py` / `RECEIPT_SCHEMA` in
  `app.js` — keep them in lockstep, including `CATEGORIES`), null over
  guessing, gate on `is_receipt`, AUD/GST context.
- Never commit: the SQLite DB, tokens/keys, downloaded receipt images.
- Deletion of receipt records always requires Sharma's explicit approval,
  one receipt at a time (see the safe-delete wrappers).
- Tax/BAS-facing output must include: "Review AI-extracted amounts before
  lodging."
- `main` is protected (no force pushes, no deletion). Work on branches,
  merge via PR.

## Verifying changes

- Python: `python3 -m py_compile receipts/*.py`, then smoke-test
  `server.py` with curl (`/health`, `/receipts/upsert`, `/receipts`).
- PWA: `python3 -m http.server` from the repo root, exercise scan/list/
  sync manually. Bump the `CACHE` version in `sw.js` whenever app-shell
  files change.
