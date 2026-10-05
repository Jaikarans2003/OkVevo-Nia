"""session.save writes under the session's profile, not the launch profile."""

from __future__ import annotations

import importlib
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agent.secret_scope import set_multiplex_active


@pytest.fixture()
def server(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    with patch.dict(
        "sys.modules",
        {
            "hermes_cli.env_loader": MagicMock(),
            "hermes_cli.banner": MagicMock(),
        },
    ):
        mod = importlib.import_module("tui_gateway.server")
    yield mod
    mod._sessions.clear()


def test_session_save_lands_in_the_sessions_own_profile(server, tmp_path):
    launch_home = tmp_path / ".hermes"
    work_home = launch_home / "profiles" / "s6probe-work"
    work_home.mkdir(parents=True)
    set_multiplex_active(True)
    parents = []
    try:
        for i, home in enumerate((None, work_home, None)):
            sid = f"save-profile-sid-{i}"
            server._sessions[sid] = {
                "agent": SimpleNamespace(
                    model="test-model",
                    session_id="s1",
                    session_start=None,
                    _cached_system_prompt="",
                ),
                "session_key": sid,
                "profile_home": str(home) if home else None,
                "history": [{"role": "user", "content": "hi"}],
                "history_lock": threading.Lock(),
            }
            try:
                resp = server._methods["session.save"]("1", {"session_id": sid})
            finally:
                server._sessions.pop(sid, None)
            assert "result" in resp, resp
            parents.append(Path(resp["result"]["file"]).parent)
    finally:
        set_multiplex_active(False)

    saved = launch_home / "sessions" / "saved"
    assert parents == [saved, work_home / "sessions" / "saved", saved]
    assert len(list((work_home / "sessions" / "saved").glob("hermes_conversation_*.json"))) == 1
