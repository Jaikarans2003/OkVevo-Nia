#!/usr/bin/env python3
"""Fail if packaging identity still says Nia or the old bundle id."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCAN = [
    ROOT / "apps/desktop/package.json",
    ROOT / "apps/desktop/product-identity.cjs",
    ROOT / "apps/desktop/scripts/run-internal-builder.mjs",
    ROOT / "brand/nia.json",
    ROOT / "apps/bootstrap-installer/src-tauri/tauri.conf.json",
]


def main() -> int:
    failed = 0
    for path in SCAN:
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        if '"productName": "Nia"' in text or '"productName":"Nia"' in text:
            print(f"{rel}: productName is still Nia", file=sys.stderr)
            failed += 1
        if "com.okvevo.nia" in text:
            print(f"{rel}: leftover bundle id com.okvevo.nia", file=sys.stderr)
            failed += 1
        if "NIA_BUILD_CHANNEL" in text:
            print(f"{rel}: leftover NIA_BUILD_CHANNEL", file=sys.stderr)
            failed += 1
    if failed:
        return 1
    print("OkVevo branding checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
