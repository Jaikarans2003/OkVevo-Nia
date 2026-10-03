"""Shipped CLI catalogs are the Nia overlay, not the upstream YAML."""

from __future__ import annotations

import json
from pathlib import Path

from agent.i18n import _flatten_into, _load_catalog, reset_language_cache, t

ROOT = Path(__file__).resolve().parents[2]
_DESKTOP_CATALOGS = ("en.ts", "ar.ts", "ja.ts", "zh.ts", "zh-hant.ts")


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


def test_desktop_catalogs_ship_from_brand():
    """The app loads brand/locales/desktop. The in-tree files are upstream."""
    for name in _DESKTOP_CATALOGS:
        brand = (ROOT / "brand/locales/desktop" / name).read_text(encoding="utf-8")
        upstream = (ROOT / "apps/desktop/src/i18n" / name).read_text(encoding="utf-8")
        assert "@/i18n/" in brand
        assert "from './types'" not in brand
        assert "from './define-locale'" not in brand
        assert "Nia" in brand
        assert brand != upstream
