"""manage_bot create/list/update — brand-safe JSON only."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

CANARIES = (
    "hermes",
    "openrouter",
    ".env",
    "config.yaml",
    "profile.yaml",
    "auth.json",
    "api key",
    "~/.hermes",
    "minimax",
)
FORBIDDEN_KEYS = {"path", "model", "provider", "env", "alias", "skills", "mirrored"}


def _assert_canary_clean(payload) -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            assert key.lower() not in FORBIDDEN_KEYS, key
            _assert_canary_clean(value)
        return
    if isinstance(payload, list):
        for item in payload:
            _assert_canary_clean(item)
        return
    if isinstance(payload, str):
        lowered = payload.lower()
        for term in CANARIES:
            assert term not in lowered, (term, payload)


@pytest.fixture()
def bot_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    (home / "config.yaml").write_text("model:\n  provider: dummy\n  default: dummy-1\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(
        "hermes_cli.profiles.seed_profile_skills", lambda *a, **k: None
    )
    monkeypatch.setattr(
        "hermes_cli.profiles.create_wrapper_script", lambda *a, **k: None
    )
    monkeypatch.setattr(
        "hermes_cli.profiles.check_alias_collision", lambda *a, **k: False
    )
    return home


def _load_tool(bot_home):
    from tools.manage_bot_tool import manage_bot_tool

    return manage_bot_tool


def test_create_list_update_are_canary_clean(bot_home):
    manage_bot_tool = _load_tool(bot_home)

    created = json.loads(
        manage_bot_tool(
            action="create",
            name="Nitish",
            role="CMO",
            personality="You are Nitish, a calm CMO.",
            description="Chief marketing officer",
        )
    )
    _assert_canary_clean(created)
    assert created["ok"] is True
    assert created["bot"] == "Nitish"
    assert created["description"] == "Chief marketing officer"

    listed = json.loads(manage_bot_tool(action="list"))
    _assert_canary_clean(listed)
    assert listed["ok"] is True
    assert any(row["display_name"] == "Nitish" for row in listed["bots"])
    assert any(row["name"] == "nitish" for row in listed["bots"])

    updated = json.loads(
        manage_bot_tool(
            action="update",
            name="Nitish",
            personality="You are Nitish, still CMO, now bolder.",
            description="Bolder CMO",
        )
    )
    _assert_canary_clean(updated)
    assert updated["ok"] is True
    assert updated["bot"] == "Nitish"
    assert updated["description"] == "Bolder CMO"

    from hermes_cli.profiles import get_profile_dir

    soul = (get_profile_dir("nitish") / "SOUL.md").read_text(encoding="utf-8")
    assert "still CMO" in soul


def test_unknown_action_errors(bot_home):
    manage_bot_tool = _load_tool(bot_home)
    raw = manage_bot_tool(action="delete")
    payload = json.loads(raw)
    assert "error" in payload
    _assert_canary_clean(payload)
