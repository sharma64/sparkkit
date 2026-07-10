#!/usr/bin/env python3
"""Save a SparkKit receipt from simple argv fields.

Designed for Ledger/OpenClaw exec allowlists where heredocs/stdin wrappers are
awkward. No arbitrary code, no file reads, no shelling other than the existing
receipt CLI store call.

Usage:
  save-receipt-args <merchant> <date|null> <total|null> <gst|null> <currency> <category> <payment|null> [notes]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path('/home/sharma/.openclaw/workspace/_external/sparkkit')
CLI = ROOT / 'receipts' / 'receipt_cli.py'
CATEGORIES = {
    'Tools', 'Materials', 'Fuel', 'Vehicle', 'PPE & Workwear',
    'Food & Drink', 'Training', 'Office & Admin', 'Home Building', 'Other',
}

def nullish(v: str):
    return None if v.strip().lower() in {'', 'null', 'none', '-'} else v

def amount(v: str):
    v = v.strip().replace('$', '').replace(',', '')
    if v.lower() in {'', 'null', 'none', '-'}:
        return None
    return float(v)

def main(argv: list[str]) -> int:
    if len(argv) < 7 or len(argv) > 8:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    merchant, date, total, gst, currency, category, payment = argv[:7]
    notes = argv[7] if len(argv) == 8 else None
    if category not in CATEGORIES:
        category = 'Other'
    payload = {
        'is_receipt': True,
        'merchant': merchant or 'Unknown merchant',
        'date': nullish(date),
        'total': amount(total),
        'gst': amount(gst),
        'currency': currency or 'AUD',
        'category': category,
        'payment_method': nullish(payment),
        'items': [],
        'notes': nullish(notes) if notes is not None else None,
    }
    p = subprocess.run(
        ['python3', str(CLI), 'add-json', '-'],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        cwd=str(ROOT),
        check=True,
        capture_output=True,
    )
    print(p.stdout.strip())
    return 0

if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
