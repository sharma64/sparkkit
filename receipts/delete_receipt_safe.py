#!/usr/bin/env python3
"""Preview or safely delete one SparkKit receipt.

Designed for Ledger. Deletion requires:
- exact receipt id
- expected date
- expected total
- confirmation phrase: SHARMA_APPROVED_DELETE

Usage:
  delete-receipt-preview <receipt-id>
  delete-receipt-safe <receipt-id> <expected-date|null> <expected-total|null> SHARMA_APPROVED_DELETE
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path('/home/sharma/.openclaw/workspace/_external/sparkkit')
RECEIPTS = ROOT / 'receipts'
sys.path.insert(0, str(RECEIPTS))
import server  # noqa: E402

CONFIRM = 'SHARMA_APPROVED_DELETE'


def get_record(receipt_id: str):
    server.init_db()
    with server.db() as conn:
        row = conn.execute('SELECT * FROM receipts WHERE id = ?', (receipt_id,)).fetchone()
        return server.row_to_record(row) if row else None


def fmt(r: dict) -> str:
    return (
        f"id={r.get('id')}\n"
        f"merchant={r.get('merchant')}\n"
        f"date={r.get('date')}\n"
        f"total={r.get('currency') or 'AUD'} {r.get('total')}\n"
        f"gst={r.get('gst')}\n"
        f"category={r.get('category')}\n"
        f"payment={r.get('payment_method')}\n"
        f"notes={r.get('notes')}"
    )


def norm(v: str | None):
    if v is None:
        return None
    v = v.strip()
    return None if v.lower() in {'', 'null', 'none', '-'} else v


def amount(v: str | None):
    v = norm(v)
    if v is None:
        return None
    return round(float(v.replace('$', '').replace(',', '')), 2)


def cmd_preview(argv: list[str]) -> int:
    if len(argv) != 1:
        print('Usage: delete-receipt-preview <receipt-id>', file=sys.stderr)
        return 2
    r = get_record(argv[0])
    if not r:
        print(f'No receipt found for id {argv[0]}')
        return 1
    print('Receipt deletion preview — no deletion performed.')
    print(fmt(r))
    print('\nTo delete, Sharma must explicitly approve this exact receipt, then run:')
    print(f"delete-receipt-safe {r['id']} {r.get('date') or 'null'} {r.get('total') if r.get('total') is not None else 'null'} {CONFIRM}")
    return 0


def cmd_delete(argv: list[str]) -> int:
    if len(argv) != 4:
        print('Usage: delete-receipt-safe <receipt-id> <expected-date|null> <expected-total|null> SHARMA_APPROVED_DELETE', file=sys.stderr)
        return 2
    receipt_id, expected_date, expected_total, confirm = argv
    if confirm != CONFIRM:
        print('Refusing delete: confirmation phrase mismatch.')
        return 3
    r = get_record(receipt_id)
    if not r:
        print(f'Refusing delete: no receipt found for id {receipt_id}')
        return 1
    actual_date = norm(r.get('date'))
    if norm(expected_date) != actual_date:
        print(f"Refusing delete: date mismatch. expected={norm(expected_date)!r} actual={actual_date!r}")
        return 4
    actual_total = None if r.get('total') is None else round(float(r.get('total')), 2)
    if amount(expected_total) != actual_total:
        print(f"Refusing delete: total mismatch. expected={amount(expected_total)!r} actual={actual_total!r}")
        return 5
    with server.db() as conn:
        cur = conn.execute('DELETE FROM receipts WHERE id = ?', (receipt_id,))
    if cur.rowcount != 1:
        print('Delete failed: unexpected row count.')
        return 6
    print(f"Deleted receipt: {r.get('merchant')} · {r.get('date') or 'no date'} · {r.get('currency') or 'AUD'} {actual_total} · {r.get('category')} · id={receipt_id}")
    return 0


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in {'preview', 'delete'}:
        print('Usage: delete_receipt_safe.py preview <receipt-id> | delete <receipt-id> <expected-date|null> <expected-total|null> SHARMA_APPROVED_DELETE', file=sys.stderr)
        return 2
    mode = sys.argv[1]
    if mode == 'preview':
        return cmd_preview(sys.argv[2:])
    return cmd_delete(sys.argv[2:])


if __name__ == '__main__':
    raise SystemExit(main())
