"""The okvevo pool row witnesses the desktop token files; it never holds a copy.

Regression guards for the fresh-install sign-in bug: a running backend whose
home had no pool row failed every chat with "No usable credentials found for
provider 'okvevo'" until a new bot spawned. The row must exist after
``ensure_okvevo_pool_entry`` (or the ``okvevo-ensure-credentials`` CLI sync),
satisfy secret resolution, and never persist the JWT or refresh token.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _jwt(exp: int) -> str:
    def b64(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return f"{b64({'alg': 'none'})}.{b64({'exp': exp})}.sig"


@pytest.fixture
def okvevo_home(tmp_path, monkeypatch):
    """A home with a live (far-from-expiry) token file, read by the real helpers."""
    home = tmp_path / "hermes"
    home.mkdir()
    token = _jwt(int(time.time()) + 3600)
    token_path = home / "okvevo-firebase-id-token"
    token_path.write_text(token, encoding="utf-8")
    (home / "okvevo-firebase-refresh-token").write_text("refresh-secret", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(token_path))
    monkeypatch.delenv("OKVEVO_FIREBASE_REFRESH_TOKEN_FILE", raising=False)
    monkeypatch.delenv("OKVEVO_API_KEY", raising=False)
    return home, token


def _row(pool):
    from plugins.okvevo.credentials import POOL_SOURCE

    return next((entry for entry in pool.entries() if entry.source == POOL_SOURCE), None)


def test_ensure_writes_file_backed_row_without_token_copies(okvevo_home):
    home, token = okvevo_home
    from agent.credential_pool import load_pool
    from plugins.okvevo.credentials import FILE_BACKED_CREDENTIAL, ensure_okvevo_pool_entry

    ensure_okvevo_pool_entry()

    row = _row(load_pool("okvevo"))
    assert row is not None
    assert row.access_token == FILE_BACKED_CREDENTIAL
    assert row.refresh_token == FILE_BACKED_CREDENTIAL
    assert row.expires_at_ms and row.expires_at_ms > time.time() * 1000
    on_disk = (home / "auth.json").read_text(encoding="utf-8")
    assert token not in on_disk
    assert "refresh-secret" not in on_disk


def test_ensure_is_idempotent(okvevo_home):
    from agent.credential_pool import load_pool
    from plugins.okvevo.credentials import ensure_okvevo_pool_entry

    ensure_okvevo_pool_entry()
    first = _row(load_pool("okvevo"))
    ensure_okvevo_pool_entry()
    rows = [entry for entry in load_pool("okvevo").entries() if entry.source == first.source]
    assert [entry.id for entry in rows] == [first.id]


def test_ensure_scrubs_legacy_token_copy(okvevo_home):
    home, _token = okvevo_home
    from agent.credential_pool import PooledCredential, load_pool
    from plugins.okvevo.credentials import (
        FILE_BACKED_CREDENTIAL,
        POOL_SOURCE,
        ensure_okvevo_pool_entry,
    )

    load_pool("okvevo").add_entry(
        PooledCredential(
            provider="okvevo",
            id="legacy",
            label="OkVevo",
            auth_type="oauth",
            priority=0,
            source=POOL_SOURCE,
            access_token="stale-jwt-copy",
            refresh_token="stale-refresh-copy",
            expires_at_ms=1,
        )
    )

    ensure_okvevo_pool_entry()

    rows = [entry for entry in load_pool("okvevo").entries() if entry.source == POOL_SOURCE]
    assert len(rows) == 1
    assert rows[0].access_token == FILE_BACKED_CREDENTIAL
    assert rows[0].refresh_token == FILE_BACKED_CREDENTIAL
    on_disk = (home / "auth.json").read_text(encoding="utf-8")
    assert "stale-jwt-copy" not in on_disk
    assert "stale-refresh-copy" not in on_disk


def test_ensure_signed_out_removes_row(tmp_path, monkeypatch):
    home = tmp_path / "hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    monkeypatch.delenv("OKVEVO_API_KEY", raising=False)

    from agent.credential_pool import PooledCredential, load_pool
    from plugins.okvevo.credentials import POOL_SOURCE, ensure_okvevo_pool_entry

    load_pool("okvevo").add_entry(
        PooledCredential(
            provider="okvevo",
            id="stale",
            label="OkVevo",
            auth_type="oauth",
            priority=0,
            source=POOL_SOURCE,
            access_token="leftover",
            refresh_token="leftover",
        )
    )

    ensure_okvevo_pool_entry()

    assert _row(load_pool("okvevo")) is None


def test_pool_row_satisfies_secret_resolution(okvevo_home):
    """Mirrors hermes_cli/auth.py's pool rung — the one that raised
    "No usable credentials found for provider 'okvevo'" on fresh installs."""
    from agent.credential_pool import load_pool
    from hermes_cli.auth import _usable_declared_secret, has_usable_secret
    from plugins.okvevo.credentials import ensure_okvevo_pool_entry

    ensure_okvevo_pool_entry()

    row = _row(load_pool("okvevo"))
    key = getattr(row, "access_token", "") or getattr(row, "runtime_api_key", "")
    assert has_usable_secret(key)
    assert _usable_declared_secret("okvevo", key, "credential_pool:okvevo") == key


def test_wire_key_rereads_file_after_refresh(okvevo_home):
    """After a token refresh the next request uses the new token — no 401, no
    cooldown. The client's api_key callable re-reads the file per request."""
    home, token = okvevo_home
    from providers import get_provider_profile

    client = get_provider_profile("okvevo").create_client()
    assert client is not None
    # The OpenAI SDK stores a callable api_key as _api_key_provider and calls
    # it from _refresh_api_key() on every request.
    api_key_fn = getattr(client, "_api_key_provider", None)
    assert callable(api_key_fn)
    assert api_key_fn() == token

    rotated = _jwt(int(time.time()) + 7200)
    (home / "okvevo-firebase-id-token").write_text(rotated, encoding="utf-8")

    assert api_key_fn() == rotated
    client._refresh_api_key()
    assert client.api_key == rotated


def test_register_exposes_ensure_credentials_cli(okvevo_home, capsys):
    from agent.credential_pool import load_pool
    from plugins.okvevo import register

    commands = {}

    class Ctx:
        def register_cli_command(self, name, _help, setup_fn, handler_fn, description=""):
            commands[name] = (setup_fn, handler_fn)

        def __getattr__(self, _name):
            return lambda *args, **kwargs: None

    register(Ctx())

    assert "okvevo-ensure-credentials" in commands
    setup, handler = commands["okvevo-ensure-credentials"]
    setup(None)
    assert handler(None) == 0
    assert "okvevo credentials ensured" in capsys.readouterr().out
    assert _row(load_pool("okvevo")) is not None


def test_cli_command_loads_plugin_and_ensures_row(okvevo_home):
    """`hermes okvevo-ensure-credentials` must load the plugin (unlike the
    built-in `auth reset`, which never creates the row) and write the row."""
    from agent.credential_pool import load_pool
    from plugins.okvevo.credentials import FILE_BACKED_CREDENTIAL

    result = subprocess.run(
        [sys.executable, "-m", "hermes_cli.main", "okvevo-ensure-credentials"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        env=dict(os.environ),
        timeout=180,
    )

    assert result.returncode == 0, (result.stdout + result.stderr)[-2000:]
    assert "okvevo credentials ensured" in result.stdout
    row = _row(load_pool("okvevo"))
    assert row is not None
    assert row.access_token == FILE_BACKED_CREDENTIAL
