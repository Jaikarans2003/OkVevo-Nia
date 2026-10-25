#!/usr/bin/env python3
"""Fail if OkVevo config or a packed app bakes a paid-vendor secret.

Scans okvevo/config/okvevo-defaults.yaml and, with --pack <Resources>,
okvevo-pack-env.json plus .env files directly in that directory. Does not
scan upstream Python: those files mention key names without holding secrets.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULTS = ROOT / "okvevo" / "config" / "okvevo-defaults.yaml"

VENDOR_KEYS = (
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "FAL_KEY",
    "FAL_API_KEY",
    "FAL_BILLING_KEY",
    "TAVILY_API_KEY",
    "FIRECRAWL_API_KEY",
    "EXA_API_KEY",
    "ELEVENLABS_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "XAI_API_KEY",
    "GROQ_API_KEY",
)

ASSIGNMENT = re.compile(
    rf"(?m)^(?:export\s+)?({'|'.join(VENDOR_KEYS)})\s*[:=]\s*(\S+)"
)
BAD_PROVIDER = re.compile(r"(?m)^[ \t]*provider:[ \t]*(auto|openrouter|nous)\s*$")


def scan_text(label: str, text: str, failures: list[str], *, providers: bool) -> None:
    for match in ASSIGNMENT.finditer(text):
        value = match.group(2).strip().strip("'\"")
        if not value or value in {"''", '""', "null", "~"}:
            continue
        failures.append(f"{label}: {match.group(1)} is set")
    if providers:
        for match in BAD_PROVIDER.finditer(text):
            failures.append(f"{label}: provider {match.group(1)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", type=Path, help="Packed Resources directory")
    args = parser.parse_args()
    failures: list[str] = []

    if not DEFAULTS.is_file():
        failures.append(f"missing {DEFAULTS}")
    else:
        scan_text(str(DEFAULTS.relative_to(ROOT)), DEFAULTS.read_text(encoding="utf-8"), failures, providers=True)

    if args.pack:
        pack_env = args.pack / "okvevo-pack-env.json"
        files = [pack_env] if pack_env.is_file() else []
        files.extend(path for path in args.pack.glob("*.env") if path.is_file())
        if not files:
            failures.append(f"no pack env under {args.pack}")
        for path in files:
            scan_text(path.name, path.read_text(encoding="utf-8"), failures, providers=False)

    if failures:
        print("vendor key check failed:", file=sys.stderr)
        for line in failures:
            print(f"  {line}", file=sys.stderr)
        return 1
    print("vendor key check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
