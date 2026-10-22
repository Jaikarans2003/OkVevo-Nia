#!/usr/bin/env python3
"""Generate the OkVevo SOUL from upstream's SOUL.md — identity phrases only.

Reads upstream SOUL.md (identity slot #1 at the pinned tag) and replaces ONLY:
  "Hermes Agent"  -> "OkVevo agent"
  "Nous Research" -> "OkVevo"
Everything else (behavior spec, paths, CLI names) is untouched.

Fail-closed: exits non-zero if an expected phrase is missing from the input or
the output still names the upstream identity — so upstream rewording its SOUL
breaks CI (okvevo-checks runs this as a canary), never silently ships the
wrong identity to users.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

REPLACEMENTS = (
    ("Hermes Agent", "OkVevo agent"),
    ("Nous Research", "OkVevo"),
)


def make_soul(upstream_text: str) -> str:
    """Swap identity phrases; raise ValueError if the input or output is off-spec."""
    out = upstream_text
    for old, new in REPLACEMENTS:
        if old not in out:
            raise ValueError(
                f"expected phrase {old!r} missing from upstream SOUL — upstream reworded its "
                "identity; update scripts/okvevo/make_soul.py deliberately, do not guess"
            )
        out = out.replace(old, new)
    for old, _new in REPLACEMENTS:
        if old in out:  # pragma: no cover - str.replace removes all; belt and braces
            raise ValueError(f"{old!r} still present after replacement")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the OkVevo SOUL from upstream SOUL.md")
    parser.add_argument("--src", default=str(REPO_ROOT / "SOUL.md"), help="upstream SOUL.md path")
    parser.add_argument("--out", default=None, help="write here instead of stdout")
    args = parser.parse_args(argv)
    try:
        soul = make_soul(Path(args.src).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"make_soul: FAIL: {exc}", file=sys.stderr)
        return 1
    if args.out:
        Path(args.out).write_text(soul, encoding="utf-8")
    else:
        sys.stdout.write(soul)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
