#!/usr/bin/env python3
"""Private SparkKit Receipts server.

Stdlib-only HTTP + SQLite backend for the existing receipts PWA contract.
No public exposure, no secrets in repo. Configure with environment variables:

  SPARKKIT_RECEIPTS_DB=/path/to/receipts.sqlite3
  SPARKKIT_RECEIPTS_TOKEN=long-random-token
  SPARKKIT_RECEIPTS_HOST=127.0.0.1
  SPARKKIT_RECEIPTS_PORT=8787

POST /receipts/extract picks a backend automatically: the OpenClaw CLI when
installed (rides the box's existing agent/model account — no API key), else
the Anthropic API when ANTHROPIC_API_KEY is set. Override with
SPARKKIT_EXTRACT_BACKEND=openclaw|anthropic, and optionally
SPARKKIT_OPENCLAW_MODEL=provider/model.

Run locally:
  SPARKKIT_RECEIPTS_TOKEN=dev-token python3 receipts/server.py
"""

from __future__ import annotations

import base64
import csv
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    from contract import CATEGORIES, PROMPT, PROMPT_INLINE_SCHEMA, RECEIPT_SCHEMA
except ImportError:  # pragma: no cover - package-style import fallback
    from .contract import CATEGORIES, PROMPT, PROMPT_INLINE_SCHEMA, RECEIPT_SCHEMA

CSV_COLUMNS = ["date", "merchant", "category", "total", "gst", "currency", "payment_method", "items", "notes"]
RECORD_FIELDS = ["id", "added", "thumb", *CSV_COLUMNS]

DB_PATH = Path(os.environ.get("SPARKKIT_RECEIPTS_DB", Path(__file__).with_name("receipts.sqlite3")))
TOKEN = os.environ.get("SPARKKIT_RECEIPTS_TOKEN", "")
HOST = os.environ.get("SPARKKIT_RECEIPTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("SPARKKIT_RECEIPTS_PORT", "8787"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS receipts (
              id TEXT PRIMARY KEY,
              added TEXT NOT NULL,
              thumb TEXT NOT NULL DEFAULT '',
              merchant TEXT NOT NULL DEFAULT 'Unknown merchant',
              date TEXT,
              total REAL,
              gst REAL,
              currency TEXT NOT NULL DEFAULT 'AUD',
              category TEXT NOT NULL DEFAULT 'Other',
              payment_method TEXT,
              items_json TEXT NOT NULL DEFAULT '[]',
              notes TEXT,
              updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_receipts_merchant ON receipts(merchant)")


def parse_amount(value):
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace("$", "").replace(",", "").strip())
    except ValueError:
        return None


def normalise_items(value):
    if value in (None, ""):
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def normalise_record(raw: dict, *, importing: bool = False) -> dict:
    category = raw.get("category") or "Other"
    if category not in CATEGORIES:
        category = "Other"
    return {
        "id": raw.get("id") or str(uuid.uuid4()),
        "added": raw.get("added") or now_iso(),
        "thumb": raw.get("thumb") or "",
        "merchant": raw.get("merchant") or "Unknown merchant",
        "date": raw.get("date") or None,
        "total": parse_amount(raw.get("total")),
        "gst": parse_amount(raw.get("gst")),
        "currency": raw.get("currency") or "AUD",
        "category": category,
        "payment_method": raw.get("payment_method") or None,
        "items": normalise_items(raw.get("items")),
        "notes": raw.get("notes") or None,
    }


def row_to_record(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "added": row["added"],
        "thumb": row["thumb"],
        "merchant": row["merchant"],
        "date": row["date"],
        "total": row["total"],
        "gst": row["gst"],
        "currency": row["currency"],
        "category": row["category"],
        "payment_method": row["payment_method"],
        "items": json.loads(row["items_json"] or "[]"),
        "notes": row["notes"],
    }


def upsert_record(record: dict) -> dict:
    r = normalise_record(record)
    with db() as conn:
        conn.execute(
            """
            INSERT INTO receipts (id, added, thumb, merchant, date, total, gst, currency, category, payment_method, items_json, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              added=excluded.added,
              thumb=excluded.thumb,
              merchant=excluded.merchant,
              date=excluded.date,
              total=excluded.total,
              gst=excluded.gst,
              currency=excluded.currency,
              category=excluded.category,
              payment_method=excluded.payment_method,
              items_json=excluded.items_json,
              notes=excluded.notes,
              updated_at=excluded.updated_at
            """,
            (
                r["id"], r["added"], r["thumb"], r["merchant"], r["date"], r["total"], r["gst"],
                r["currency"], r["category"], r["payment_method"], json.dumps(r["items"], ensure_ascii=False), r["notes"], now_iso(),
            ),
        )
    return r


def anthropic_extract(media_type: str, b64_data: str) -> dict:
    key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("SPARKKIT_ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("Server has no ANTHROPIC_API_KEY configured")
    model = os.environ.get("SPARKKIT_RECEIPTS_MODEL", "claude-opus-4-8")
    payload = json.dumps({
        "model": model,
        "max_tokens": 4096,
        "output_config": {"format": {"type": "json_schema", "schema": RECEIPT_SCHEMA}},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64_data}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = None
        msg = (body or {}).get("error", {}).get("message") if isinstance(body, dict) else None
        raise RuntimeError(msg or f"Anthropic HTTP {e.code}")
    if body.get("stop_reason") == "refusal":
        raise RuntimeError("Model declined to process this image")
    if body.get("stop_reason") == "max_tokens":
        raise RuntimeError("Model response was cut off; try a clearer photo")
    text = next((b.get("text") for b in body.get("content", []) if b.get("type") == "text"), None)
    if not text:
        raise RuntimeError("No extraction JSON returned")
    return json.loads(text)


def parse_model_json(text: str) -> dict:
    # Models without structured outputs sometimes wrap JSON in fences/prose.
    text = text.strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise RuntimeError("Extraction reply contained no JSON object")
        text = text[start:end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError("Extraction reply was not valid JSON; try a clearer photo")


def openclaw_extract(media_type: str, b64_data: str) -> dict:
    openclaw = os.environ.get("SPARKKIT_OPENCLAW_BIN") or shutil.which("openclaw")
    if not openclaw:
        raise RuntimeError("Server has no openclaw CLI available")
    suffix = "." + (media_type.split("/")[-1] or "jpeg").replace("jpg", "jpeg")
    cmd = [openclaw, "capability", "model", "run", "--json", "--prompt", PROMPT_INLINE_SCHEMA]
    model = os.environ.get("SPARKKIT_OPENCLAW_MODEL")
    if model:
        cmd += ["--model", model]
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(base64.b64decode(b64_data))
        tmp.flush()
        cmd += ["--file", tmp.name]
        try:
            run = subprocess.run(cmd, capture_output=True, text=True, timeout=150)
        except subprocess.TimeoutExpired:
            raise RuntimeError("OpenClaw extraction timed out")
    if run.returncode != 0:
        raise RuntimeError(f"OpenClaw extraction failed: {(run.stderr or run.stdout).strip()[:200]}")
    out = parse_model_json(run.stdout)
    texts = out.get("outputs") or []
    text = texts[0].get("text") if texts else out.get("text")
    if not text:
        raise RuntimeError("OpenClaw returned no extraction text")
    return parse_model_json(text)


def extract_receipt(media_type: str, b64_data: str) -> dict:
    backend = os.environ.get("SPARKKIT_EXTRACT_BACKEND", "auto")
    if backend == "openclaw":
        return openclaw_extract(media_type, b64_data)
    if backend == "anthropic":
        return anthropic_extract(media_type, b64_data)
    # auto: prefer the box's agent account (no API key), fall back to Anthropic.
    if os.environ.get("SPARKKIT_OPENCLAW_BIN") or shutil.which("openclaw"):
        return openclaw_extract(media_type, b64_data)
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("SPARKKIT_ANTHROPIC_API_KEY"):
        return anthropic_extract(media_type, b64_data)
    raise RuntimeError("Server has no extraction backend: install the openclaw CLI or set ANTHROPIC_API_KEY")


def date_bounds(params: dict[str, list[str]]) -> tuple[str | None, str | None]:
    if params.get("fy", [""])[0] == "current":
        today = date.today()
        start_year = today.year if today.month >= 7 else today.year - 1
        return f"{start_year}-07-01", f"{start_year + 1}-06-30"
    return params.get("from", [None])[0], params.get("to", [None])[0]


def list_receipts(params: dict[str, list[str]]) -> list[dict]:
    clauses = []
    args = []
    start, end = date_bounds(params)
    if start:
        clauses.append("date >= ?")
        args.append(start)
    if end:
        clauses.append("date <= ?")
        args.append(end)
    category = params.get("category", [""])[0]
    if category:
        clauses.append("category = ?")
        args.append(category)
    q = params.get("q", [""])[0].strip().lower()
    sql = "SELECT * FROM receipts"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY COALESCE(date, '') DESC, added DESC"
    with db() as conn:
        records = [row_to_record(row) for row in conn.execute(sql, args)]
    if q:
        def hit(r):
            hay = " ".join([
                r.get("merchant") or "",
                r.get("notes") or "",
                r.get("payment_method") or "",
                *[i.get("description", "") for i in r.get("items") or [] if isinstance(i, dict)],
            ]).lower()
            return q in hay
        records = [r for r in records if hit(r)]
    return records


def csv_from_records(records: list[dict]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for r in records:
        row = {k: r.get(k) for k in CSV_COLUMNS}
        row["items"] = json.dumps(r.get("items") or [], ensure_ascii=False)
        writer.writerow(row)
    return out.getvalue()


def import_csv(text: str) -> int:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    count = 0
    for row in reader:
        if not any(row.values()):
            continue
        upsert_record(row)
        count += 1
    return count


def summary(records: list[dict]) -> dict:
    def add(bucket: dict, key: str, r: dict) -> None:
        b = bucket.setdefault(key or "unknown", {"count": 0, "total": 0.0, "gst": 0.0})
        b["count"] += 1
        b["total"] += r["total"] if isinstance(r.get("total"), (int, float)) else 0
        b["gst"] += r["gst"] if isinstance(r.get("gst"), (int, float)) else 0
    by_category, by_merchant, by_month = {}, {}, {}
    total = {"count": 0, "total": 0.0, "gst": 0.0}
    for r in records:
        total["count"] += 1
        total["total"] += r["total"] if isinstance(r.get("total"), (int, float)) else 0
        total["gst"] += r["gst"] if isinstance(r.get("gst"), (int, float)) else 0
        add(by_category, r.get("category") or "Other", r)
        add(by_merchant, r.get("merchant") or "Unknown merchant", r)
        add(by_month, (r.get("date") or "unknown")[:7] if r.get("date") else "unknown", r)
    return {"total": total, "by_category": by_category, "by_merchant": by_merchant, "by_month": by_month, "review_note": "Review AI-extracted amounts before lodging."}


class Handler(BaseHTTPRequestHandler):
    server_version = "SparkKitReceipts/0.1"

    def log_message(self, fmt, *args):
        # Avoid logging auth headers/bodies; keep request line only.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status: int, text: str, content_type: str):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorised(self) -> bool:
        if not TOKEN:
            self.send_json(500, {"error": "SPARKKIT_RECEIPTS_TOKEN is not configured"})
            return False
        expected = f"Bearer {TOKEN}"
        if self.headers.get("authorization") != expected:
            self.send_json(401, {"error": "unauthorised"})
            return False
        return True

    def read_body(self) -> bytes:
        n = int(self.headers.get("content-length") or "0")
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if parsed.path == "/health":
            return self.send_json(200, {"ok": True})
        if not self.authorised():
            return
        if parsed.path == "/receipts":
            return self.send_json(200, {"receipts": list_receipts(params)})
        if parsed.path == "/receipts/export.csv":
            return self.send_text(200, csv_from_records(list_receipts(params)), "text/csv; charset=utf-8")
        if parsed.path == "/receipts/summary":
            return self.send_json(200, summary(list_receipts(params)))
        return self.send_json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self.authorised():
            return
        body = self.read_body()
        if parsed.path == "/receipts/upsert":
            try:
                payload = json.loads(body.decode("utf-8"))
            except json.JSONDecodeError:
                return self.send_json(400, {"error": "invalid json"})
            return self.send_json(200, {"receipt": upsert_record(payload)})
        if parsed.path == "/receipts/import-csv":
            return self.send_json(200, {"imported": import_csv(body.decode("utf-8-sig"))})
        if parsed.path == "/receipts/extract":
            try:
                payload = json.loads(body.decode("utf-8"))
            except json.JSONDecodeError:
                return self.send_json(400, {"error": "invalid json"})
            image = payload.get("image") or ""
            if "," not in image or not image.startswith("data:"):
                return self.send_json(400, {"error": "expected a data: URL in 'image'"})
            header, b64_data = image.split(",", 1)
            media_type = header[len("data:"):].split(";")[0] or "image/jpeg"
            try:
                extraction = extract_receipt(media_type, b64_data)
            except RuntimeError as e:
                return self.send_json(502, {"error": str(e)})
            return self.send_json(200, {"extraction": extraction})
        return self.send_json(404, {"error": "not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not self.authorised():
            return
        prefix = "/receipts/"
        if parsed.path.startswith(prefix) and len(parsed.path) > len(prefix):
            rid = parsed.path[len(prefix):]
            with db() as conn:
                cur = conn.execute("DELETE FROM receipts WHERE id = ?", (rid,))
            return self.send_json(200, {"deleted": cur.rowcount > 0, "id": rid})
        return self.send_json(404, {"error": "not found"})


def main() -> int:
    init_db()
    if not TOKEN:
        print("Refusing to start without SPARKKIT_RECEIPTS_TOKEN", file=sys.stderr)
        return 2
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"SparkKit Receipts server listening on http://{HOST}:{PORT}")
    print(f"Database: {DB_PATH}")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
