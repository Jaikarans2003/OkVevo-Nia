"""Load P0 eval config. TEST_CONTACT lives only in config.local (gitignored)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
EXAMPLE = HERE / "config.example.json"
LOCAL = HERE / "config.local.json"

REDACT = "***CONTACT***"


def load_config() -> dict[str, Any]:
    data: dict[str, Any] = {}
    if EXAMPLE.exists():
        data.update(json.loads(EXAMPLE.read_text(encoding="utf-8")))
    if LOCAL.exists():
        data.update(json.loads(LOCAL.read_text(encoding="utf-8")))
    contact = str(data.get("TEST_CONTACT") or "").strip()
    if contact.lower().startswith("paste the exact"):
        contact = ""
        data["TEST_CONTACT"] = ""
    data["TEST_CONTACT"] = contact
    return data


def require_test_contact(cfg: dict[str, Any]) -> str:
    contact = str(cfg.get("TEST_CONTACT") or "").strip()
    if not contact:
        raise SystemExit(
            "P0 WhatsApp tasks refuse to run without TEST_CONTACT. "
            "Copy config.example.json to config.local.json and set TEST_CONTACT "
            "to the exact WhatsApp chat title (gitignored; never commit it)."
        )
    return contact


def redact(text: str, contact: str) -> str:
    if not text:
        return text
    out = str(text)
    if contact:
        out = out.replace(contact, REDACT)
    return out
