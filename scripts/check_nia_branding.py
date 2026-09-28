#!/usr/bin/env python3
"""Nia branding floor — run: python3 scripts/check_nia_branding.py

Batch 0 gate: identity surfaces that must stay Nia/OkVevo on every commit.
Broader i18n / Electron / installer banner scrub is tracked in
docs/fork-deltas/branding.md and is not fully clean on staging yet — this
script does not walk those globs until they are scrubbed.

Fails closed on:
  - SOUL.md / docker/SOUL.md missing the Nia identity lead
  - apps/desktop/package.json productName / appId not Nia
  - DEFAULT_AGENT_IDENTITY / DEFAULT_SOUL_MD not Nia
  - install clone URLs not pointing at Jaikarans2003/OkVevo-Nia
  - forbidden product phrasing in those same identity files
    (Hermes Agent / Nous Research as who-we-are, or productName Hermes)
  - obvious hermes logo filenames under apps/desktop/assets

Allow: LICENSE/NOTICE, legacy-template match strings in default_soul.py,
PRODUCT_IDENTITY_GUIDANCE "never say Hermes" lines, internal ids.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

NIA_LEAD = "You are Nia, built by OkVevo"
OKVEVO_NIA_HTTPS = "https://github.com/Jaikarans2003/OkVevo-Nia.git"
OKVEVO_NIA_SSH = "git@github.com:Jaikarans2003/OkVevo-Nia.git"

# Product-as-self phrasing in identity files (not "never say Hermes" guidance).
FORBIDDEN_IDENTITY = re.compile(
    r"(?i)("
    r"you are hermes(?:\s+agent)?"
    r"|hermes agent(?:,|\s+an\s+|\s+installer|\s+persona)"
    r"|created by nous research"
    r"|built by nous"
    r"|welcome to hermes"
    r"|productName[\"']?\s*:\s*[\"']Hermes[\"']"
    r")"
)

# Lines that intentionally mention Hermes/Nous as forbidden brands.
GUIDANCE_OK = re.compile(
    r"(?i)(never say|not hermes|not nous|do not say|instead of hermes|"
    r"legacy|template|match|upgrade|rewrite|scrub|forbidden|against)"
)


def _fail(msg: str, errors: list[str]) -> None:
    errors.append(msg)


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def check_soul_files(errors: list[str]) -> None:
    for rel in ("SOUL.md", "docker/SOUL.md"):
        text = _read(rel).strip()
        if NIA_LEAD not in text:
            _fail(f"{rel}: missing Nia identity lead ({NIA_LEAD!r})", errors)
        # Whole-file product-as-self (ignore empty)
        for i, line in enumerate(text.splitlines(), 1):
            if FORBIDDEN_IDENTITY.search(line) and not GUIDANCE_OK.search(line):
                _fail(f"{rel}:{i}: forbidden product phrasing: {line.strip()[:120]}", errors)


def check_package_json(errors: list[str]) -> None:
    data = json.loads(_read("apps/desktop/package.json"))
    product = data.get("productName")
    app_id = (data.get("build") or {}).get("appId") or data.get("appId")
    if product != "Nia":
        _fail(f"apps/desktop/package.json: productName must be 'Nia', got {product!r}", errors)
    if app_id != "com.okvevo.nia":
        _fail(f"apps/desktop/package.json: appId must be 'com.okvevo.nia', got {app_id!r}", errors)


def check_python_identity(errors: list[str]) -> None:
    pb = _read("agent/prompt_builder.py")
    if f'DEFAULT_AGENT_IDENTITY = (\n    "{NIA_LEAD}' not in pb and f'"{NIA_LEAD}' not in pb:
        _fail("agent/prompt_builder.py: DEFAULT_AGENT_IDENTITY must lead with Nia/OkVevo", errors)

    ds = _read("hermes_cli/default_soul.py")
    if f'DEFAULT_SOUL_MD = (\n    "{NIA_LEAD}' not in ds and NIA_LEAD not in ds.split("DEFAULT_SOUL_MD", 1)[-1][:400]:
        _fail("hermes_cli/default_soul.py: DEFAULT_SOUL_MD must lead with Nia/OkVevo", errors)

    # Only scan the live DEFAULT_SOUL_MD / DEFAULT_AGENT assignment blocks for
    # product-as-self; legacy template tuples intentionally contain Hermes.
    for rel, text, marker in (
        ("agent/prompt_builder.py", pb, "DEFAULT_AGENT_IDENTITY"),
        ("hermes_cli/default_soul.py", ds, "DEFAULT_SOUL_MD"),
    ):
        # Take until next top-level assignment after marker (rough).
        idx = text.find(marker)
        if idx < 0:
            continue
        chunk = text[idx : idx + 800]
        for i, line in enumerate(chunk.splitlines(), 1):
            if "_LEGACY" in line or "legacy" in line.lower():
                break
            if FORBIDDEN_IDENTITY.search(line) and not GUIDANCE_OK.search(line):
                _fail(f"{rel}: {marker} block: forbidden phrasing: {line.strip()[:120]}", errors)


def check_install_urls(errors: list[str]) -> None:
    for rel in ("scripts/install.sh", "scripts/install.ps1"):
        path = ROOT / rel
        if not path.exists():
            _fail(f"{rel}: missing", errors)
            continue
        text = path.read_text(encoding="utf-8")
        if OKVEVO_NIA_HTTPS not in text and OKVEVO_NIA_SSH not in text:
            _fail(f"{rel}: clone URL must reference Jaikarans2003/OkVevo-Nia", errors)
        if "NousResearch/hermes-agent" in text and "OkVevo-Nia" not in text:
            _fail(f"{rel}: still points only at NousResearch/hermes-agent", errors)


def check_logo_filenames(errors: list[str]) -> None:
    assets = ROOT / "apps" / "desktop" / "assets"
    if not assets.is_dir():
        return
    bad = re.compile(r"(?i)hermes.*\.(png|icns|ico|svg)$")
    for p in assets.rglob("*"):
        if p.is_file() and bad.search(p.name):
            _fail(f"logo filename looks Hermes-branded: {p.relative_to(ROOT)}", errors)


def main() -> int:
    errors: list[str] = []
    check_soul_files(errors)
    check_package_json(errors)
    check_python_identity(errors)
    check_install_urls(errors)
    check_logo_filenames(errors)

    if errors:
        print("check_nia_branding: FAIL", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("check_nia_branding: ok (identity floor)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
