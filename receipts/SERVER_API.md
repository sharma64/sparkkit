# SparkKit Receipts — Server API

Server-side source of truth for SparkKit receipt records.

## Goals

- Keep receipt records in one durable server-side store.
- Preserve the existing app record shape so phone sync and CSV export stay compatible.
- Keep the API private-network only, protected by bearer token auth.
- Keep owner-controlled export available at all times.

## Record shape

The server stores the same fields the current PWA uses:

```json
{
  "id": "uuid",
  "added": "2026-07-09T00:00:00.000Z",
  "thumb": "data:image/jpeg;base64,...",
  "merchant": "Bunnings",
  "date": "2026-07-09",
  "total": 123.45,
  "gst": 11.22,
  "currency": "AUD",
  "category": "Materials",
  "payment_method": "Visa …1234",
  "items": [{ "description": "Cable ties", "amount": 12.50 }],
  "notes": null
}
```

`items` is stored as JSON. Amount fields may be `null` when unreadable.

## Categories

Current compatibility categories:

- Tools
- Materials
- Fuel
- Vehicle
- PPE & Workwear
- Food & Drink
- Training
- Office & Admin
- Home Building
- Other

## Auth

All API requests require:

```http
Authorization: Bearer <SPARKKIT_RECEIPTS_TOKEN>
```

The service should only bind to localhost or a private VPN/Tailscale interface. Do not expose it directly to the open internet.

## Endpoints

### Health

```http
GET /health
```

Returns `{ "ok": true }` without auth for local/private health checks.

### List receipts

```http
GET /receipts
GET /receipts?from=2026-07-01&to=2026-07-31&category=Fuel&q=bunnings
```

Returns:

```json
{ "receipts": [ ... ] }
```

Filters are optional. Dates are inclusive. `q` searches merchant, notes, payment method, and item descriptions.

### Upsert receipt

```http
POST /receipts/upsert
Content-Type: application/json
```

Body is a full receipt record. If `id` is missing the server creates one. If `added` is missing the server creates it.

Returns:

```json
{ "receipt": { ... } }
```

### Extract receipt from image

```http
POST /receipts/extract
Content-Type: application/json
```

Body: `{ "image": "data:image/jpeg;base64,..." }` — a downscaled photo as a
data URL. Runs the extraction contract (`contract.py`) with the server's
own Anthropic key. This is the only extraction path the phone PWA has —
it never holds an Anthropic key of its own. Does **not** store the record;
the caller still calls `/receipts/upsert` with the result (this is what
the PWA's scan flow does).

Requires `ANTHROPIC_API_KEY` (or `SPARKKIT_ANTHROPIC_API_KEY`) in the
server's environment. Returns `502` with an `error` message if that's
missing, if the model declines, or if the response is cut off.

Returns:

```json
{ "extraction": { "is_receipt": true, "merchant": "...", ... } }
```

### Delete receipt

```http
DELETE /receipts/:id
```

Deletes one record. This endpoint exists for app sync, but operationally deletion still requires explicit owner instruction.

Returns:

```json
{ "deleted": true, "id": "..." }
```

### Import CSV

```http
POST /receipts/import-csv
Content-Type: text/csv
```

Accepts the current app export columns:

```csv
date,merchant,category,total,gst,currency,payment_method,items,notes
```

Because the current CSV export does not include `id`, `added`, or `thumb`, imported records receive new ids, current import timestamps, and empty thumbnails unless later matched/edited.

Returns:

```json
{ "imported": 12 }
```

### Export CSV

```http
GET /receipts/export.csv
```

Returns a CSV compatible with the current app export.

### Summary/Q&A helper

```http
GET /receipts/summary?from=2026-07-01&to=2026-09-30&category=Fuel
GET /receipts/summary?fy=current
```

Returns spend/GST/count totals by category, merchant, and month. `fy=current` uses the Australian financial year: 1 July to 30 June.

Tax/BAS-facing answers should include: **Review AI-extracted amounts before lodging.**

## Extraction contract

Server-side receipt image extraction must reuse from `receipts/app.js`:

- `RECEIPT_SCHEMA`
- `PROMPT`
- `CATEGORIES`

Rules:

- structured JSON schema output only; never parse prose
- `null` over guessing when printed/readable value is missing
- gate on `is_receipt`; store nothing when false
- downscale images to about 1568px long edge before model call
- API keys stay server-side only; never in logs, chat replies, or repo

## Retention

Default implementation keeps thumbnails and structured records only. Full-size/original receipt image retention requires a separate owner decision because it changes privacy and storage behaviour.
