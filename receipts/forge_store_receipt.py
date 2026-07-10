#!/usr/bin/env python3
"""Store a receipt extraction JSON from stdin or argv.

This is a tiny stable wrapper intended for OpenClaw agents that can obtain
strict extracted JSON but should not run arbitrary shell commands.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path('/home/sharma/.openclaw/workspace/_external/sparkkit')
CLI = ROOT / 'receipts' / 'receipt_cli.py'

def main():
    if len(sys.argv) > 1 and sys.argv[1] != '-':
        payload = sys.argv[1]
    else:
        payload = sys.stdin.read()
    # Validate JSON before passing it through.
    json.loads(payload)
    p = subprocess.run(['python3', str(CLI), 'add-json', '-'], input=payload, text=True, cwd=str(ROOT), check=True, capture_output=True)
    print(p.stdout.strip())

if __name__ == '__main__':
    main()
