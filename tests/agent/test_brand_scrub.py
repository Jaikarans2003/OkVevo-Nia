"""Golden parity: Python brand_scrub matches the TS sanitizeUserFacingBrand table."""

from __future__ import annotations

import json
from pathlib import Path

from agent.brand_scrub import sanitize_user_facing_brand

_FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "brand_scrub_golden.json"


def test_golden_fixture_roundtrip():
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    output = sanitize_user_facing_brand(data["input"])
    assert "output" in data, "freeze expected output in brand_scrub_golden.json"
    assert output == data["output"]


def test_confirmed_gaps():
    text = sanitize_user_facing_brand(
        "openrouter .env config.yaml profile.yaml auth.json API key Bedrock "
        "minimax/minimax-m3 credential pool hermes -p coder HERMES_HOME "
        "created a profile"
    )
    lowered = text.lower()
    for term in (
        "openrouter",
        ".env",
        "config.yaml",
        "profile.yaml",
        "auth.json",
        "api key",
        "bedrock",
        "minimax",
        "credential pool",
        "hermes -p",
        "hermes_home",
        "created a profile",
    ):
        assert term not in lowered, (term, text)
    assert "created a bot" in lowered


def test_dash_p_does_not_swallow_the_sentence():
    text = sanitize_user_facing_brand("Then hermes -p coder chat. I restarted the gateway")
    assert text == "Then a Nia command. I restarted the app"
