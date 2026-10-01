"""Shipped CLI catalogs are the Nia overlay, not the upstream YAML."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from agent.i18n import _flatten_into, _load_catalog, reset_language_cache, t

ROOT = Path(__file__).resolve().parents[2]


def _string_literals(text: str) -> list[str]:
    from scripts.check_nia_branding import iter_string_spans

    return [inner for _start, _end, inner in iter_string_spans(text, ".ts")]


def test_english_overlay_replaces_the_upstream_catalog():
    reset_language_cache()
    spec = json.loads((ROOT / "brand/locales/en.overlay.json").read_text(encoding="utf-8"))
    loaded = _load_catalog("en")
    assert loaded == spec["catalog"]
    assert "Nia Commands" in loaded["gateway.help.header"]

    import yaml

    upstream: dict[str, str] = {}
    _flatten_into(yaml.safe_load((ROOT / "locales/en.yaml").read_text(encoding="utf-8")) or {}, "", upstream)
    extra = [key for key in upstream if key not in loaded]
    assert extra
    assert t(extra[0], lang="en") == extra[0]


def test_desktop_catalog_literals_match_the_staging_catalogs():
    for name in ("en.ts", "ar.ts", "ja.ts", "zh.ts", "zh-hant.ts"):
        staging = subprocess.check_output(
            ["git", "show", f"okvevo/staging:apps/desktop/src/i18n/{name}"],
            cwd=ROOT,
            text=True,
        )
        brand = (ROOT / "brand/locales/desktop" / name).read_text(encoding="utf-8")
        staging_lits = set(_string_literals(staging))
        brand_lits = set(_string_literals(brand))
        assert staging_lits - brand_lits <= {"./types", "./define-locale"}
        assert brand_lits - staging_lits <= {"@/i18n/types", "@/i18n/define-locale"}
