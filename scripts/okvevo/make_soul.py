#!/usr/bin/env python3
"""Generate the OkVevo SOUL from upstream's SOUL.md — identity phrases only.

Reads upstream SOUL.md (identity slot #1 at the pinned tag) and replaces ONLY
the phrases composed from okvevo/config/identity.json:
  "Hermes Agent"           -> agentName ("OkVevo agent")
  "built by Nous Research" -> "made by {maker}" ("made by OkVevo")
Everything else (behavior spec, paths, CLI names) is untouched.

Fail-closed: exits non-zero if an expected phrase is missing from the input or
the output still names the upstream identity — so upstream rewording its SOUL
breaks CI (okvevo-checks runs this as a canary), never silently ships the
wrong identity to users.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
IDENTITY_PATH = REPO_ROOT / "okvevo" / "config" / "identity.json"


def load_identity(path: Path = IDENTITY_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def replacements(identity: dict) -> tuple[tuple[str, str], ...]:
    upstream = identity["upstream"]
    return (
        (upstream["agentName"], identity["agentName"]),
        (f"built by {upstream['maker']}", f"made by {identity['maker']}"),
    )


def make_soul(upstream_text: str, identity: dict | None = None) -> str:
    """Swap identity phrases; raise ValueError if the input or output is off-spec."""
    identity = identity or load_identity()
    out = upstream_text
    for old, new in replacements(identity):
        if old not in out:
            raise ValueError(
                f"expected phrase {old!r} missing from upstream SOUL — upstream reworded its "
                "identity; update okvevo/config/identity.json deliberately, do not guess"
            )
        out = out.replace(old, new)
    for leftover in identity["upstream"].values():
        if leftover in out:
            raise ValueError(f"{leftover!r} still present after replacement")
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
