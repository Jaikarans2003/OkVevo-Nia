"""session.resume materializes a row for a minted-but-never-persisted key.

Adapted to Nia's resume handler: the locate step is still inline in
methods_session.py, and a non-lazy resume builds an agent. These cases use
``defer_history`` so the test stops after the row is created.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from hermes_state import SessionDB

MINTED_KEY = "20260828_053121_3427a9"
EXISTING_KEY = "20260827_224618_956bf8"


@pytest.fixture()
def real_db(monkeypatch, tmp_path):
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
        server = importlib.import_module("tui_gateway.server")
    db = SessionDB(db_path=home / "state.db")
    server._db = db
    monkeypatch.setattr(server, "_resolve_model", lambda: "test-model")
    monkeypatch.setattr(server, "_enable_gateway_prompts", lambda: None)
    monkeypatch.setattr(server, "_schedule_resume_hydration", lambda *a, **k: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda *a, **k: None)
    monkeypatch.setattr(server, "_child_run_active", lambda _key: False)
    known = set(server._sessions)
    yield server, db
    with server._sessions_lock:
        for sid in [s for s in server._sessions if s not in known]:
            server._sessions.pop(sid, None)
    server._db = None
    db.close()


def _resume(server, **params):
    params.setdefault("defer_history", True)
    return server.handle_request({"id": "1", "method": "session.resume", "params": params})


def test_resume_materializes_row_for_minted_key(real_db):
    server, db = real_db
    resp = _resume(server, session_id=MINTED_KEY)

    assert "error" not in resp, resp
    assert resp["result"]["resumed"] == MINTED_KEY
    row = db.get_session(MINTED_KEY)
    assert row is not None
    assert row["model"] == "test-model"


def test_resume_existing_row_unaffected(real_db):
    server, db = real_db
    db.create_session(EXISTING_KEY, source="tui", model="test-model")
    db.append_message(EXISTING_KEY, "user", "hello")

    resp = _resume(server, session_id=EXISTING_KEY)

    assert "error" not in resp, resp
    assert resp["result"]["resumed"] == EXISTING_KEY
    assert db.get_session(EXISTING_KEY)["message_count"] == 1


def test_resume_garbage_id_still_4007(real_db):
    server, db = real_db
    resp = _resume(server, session_id="not-a-session")

    assert resp["error"]["code"] == 4007
    assert db.get_session("not-a-session") is None


def test_resume_8hex_runtime_id_still_4007(real_db):
    server, db = real_db
    resp = _resume(server, session_id="5a81f231")

    assert resp["error"]["code"] == 4007
    assert db.get_session("5a81f231") is None


def test_resume_lazy_watch_missing_key_still_4007(real_db):
    server, db = real_db
    resp = _resume(server, session_id=MINTED_KEY, lazy=True, defer_history=False)

    assert resp["error"]["code"] == 4007
    assert db.get_session(MINTED_KEY) is None


def test_resume_minted_key_claimed_by_other_profile_fails_closed(real_db):
    server, db = real_db
    server._sessions["live-other-profile"] = {
        "history": [],
        "profile_home": "/tmp/other-profile",
        "session_key": MINTED_KEY,
        "source": "desktop",
    }
    try:
        resp = _resume(server, session_id=MINTED_KEY)
        assert resp["error"]["code"] == 4007
        assert db.get_session(MINTED_KEY) is None
    finally:
        with server._sessions_lock:
            server._sessions.pop("live-other-profile", None)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("20260828_053121_3427a9", True),
        ("20260827_224618_956bf8", True),
        ("5a81f231", False),
        ("not-a-session", False),
        ("", False),
        ("20260828_053121_3427", False),
        ("20260828_053121_3427a9ZZ", False),
        ("Bot Chat", False),
    ],
)
def test_is_server_minted_key_shape(real_db, value, expected):
    server, _db = real_db
    assert server._is_server_minted_key(value) is expected
