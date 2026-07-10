# SparkKit Receipts — snap, extract, organise

Phase 2 of the SparkKit roadmap: receipt capture. Take a photo of a receipt,
an AI model (Claude) reads it and extracts structured data — merchant, date,
total, GST, category, line items — and everything is stored **on your device**
so you can search it, see monthly/category totals, and export CSV for your
accountant or spreadsheet.

## How it works

1. **Settings** → paste your Anthropic API key (get one at
   [platform.claude.com](https://platform.claude.com)). The key is stored only in
   your browser's localStorage and sent only to `api.anthropic.com`.
2. **Scan** → take a photo (or pick several from your gallery). Each image is
   downscaled on-device, sent to Claude with a strict JSON schema, and the
   extracted receipt is saved to IndexedDB with a small thumbnail.
3. **Receipts** → search and filter by month/category, tap a receipt to review
   or correct any field, export the current view as CSV.
4. **Totals** → spend and GST per month, broken down by category.

## Design decisions

- **No backend.** Same philosophy as the rest of SparkKit: a static PWA, no
  build step. The browser calls the Claude API directly (the
  `anthropic-dangerous-direct-browser-access` header opts in to CORS). That is
  acceptable here because the API key is *your own*, entered by you, on your
  own device — nothing is ever shipped or shared.
- **Structured outputs** (`output_config.format` with a JSON schema) guarantee
  the model's reply is valid, parseable JSON — no regex scraping of prose.
- **Your data stays local.** Extracted records + thumbnails live in IndexedDB.
  Only the receipt photo itself is sent to the API for extraction.
- **Model:** `claude-opus-4-8` (vision + structured outputs).

## Run it

Same as the main app — from the repo root:

```sh
python3 -m http.server 5173
# then open http://localhost:5173/receipts/
```

> ⚠️ The camera and service worker need a secure context: `localhost` is fine
> for development; use HTTPS (e.g. GitHub Pages) on a phone.

## Server handoff

A private server API design and stdlib SQLite reference implementation now live in:

- [`SERVER_API.md`](SERVER_API.md)
- [`server.py`](server.py)
- [`receipt_cli.py`](receipt_cli.py)
- [`CHAT_INTAKE.md`](CHAT_INTAKE.md)

The current PWA is still local-first/IndexedDB. The server code is not exposed or started by default; it is the compatibility target for moving extraction, storage, CSV import/export, and sync server-side.

## Roadmap

- Optional cheaper model toggle for bulk back-scanning of old receipts.
- Attach receipts to jobs (ties into the planned invoicing feature).
- Full-size image retention (currently only a thumbnail is kept).
