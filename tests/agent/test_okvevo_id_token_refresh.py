"""ID token refresh for long Fal polls. Re-reading the file is not enough once the JWT expires."""

from __future__ import annotations

import base64
import json
import time
from unittest.mock import MagicMock, patch

from agent import okvevo_gateway as gw


def _jwt(*, exp: int) -> str:
    head = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).rstrip(b"=").decode()
    return f"{head}.{payload}.sig"


def _sign_in(monkeypatch, tmp_path, *, id_token: str, refresh: str = "rt-1"):
    id_path = tmp_path / "okvevo-firebase-id-token"
    rt_path = tmp_path / "okvevo-firebase-refresh-token"
    id_path.write_text(id_token, encoding="utf-8")
    rt_path.write_text(refresh, encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(id_path))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "http://portal.test")
    return id_path, rt_path


def test_id_token_needs_refresh_within_skew():
    now = 1_000_000
    assert gw.id_token_needs_refresh(_jwt(exp=now + 60), now=now) is True
    assert gw.id_token_needs_refresh(_jwt(exp=now + 10 * 60), now=now) is False


def test_reread_alone_keeps_expired_token(monkeypatch, tmp_path):
    """The G3 job 4 failure mode: file still holds the expired JWT."""
    expired = _jwt(exp=int(time.time()) - 30)
    _sign_in(monkeypatch, tmp_path, id_token=expired)
    assert gw.read_okvevo_id_token() == expired
    assert gw.id_token_needs_refresh(expired, now=time.time()) is True


def test_refresh_rewrites_id_token_file(monkeypatch, tmp_path):
    expired = _jwt(exp=int(time.time()) - 10)
    fresh = _jwt(exp=int(time.time()) + 3600)
    id_path, _rt = _sign_in(monkeypatch, tmp_path, id_token=expired)

    body = json.dumps(
        {"idToken": fresh, "refreshToken": "rt-2", "expiresIn": 3600, "uid": "u"}
    ).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = body
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("urllib.request.urlopen", return_value=mock_resp) as opened:
        out = gw.refresh_okvevo_id_token(force=True)

    assert out == fresh
    assert id_path.read_text(encoding="utf-8") == fresh
    assert (tmp_path / "okvevo-firebase-refresh-token").read_text(encoding="utf-8") == "rt-2"
    assert opened.call_args[0][0].full_url.endswith("/api/auth/desktop/refresh")


def test_ensure_skips_network_when_fresh(monkeypatch, tmp_path):
    fresh = _jwt(exp=int(time.time()) + 3600)
    _sign_in(monkeypatch, tmp_path, id_token=fresh)
    with patch("urllib.request.urlopen") as opened:
        assert gw.ensure_okvevo_id_token() == fresh
    opened.assert_not_called()


def test_g3_job4_35min_poll_refreshes_on_401(monkeypatch, tmp_path):
    """Simulate a 35+ minute poll: JWT expires mid-wait; one forced refresh
    rewrites the file and the next poll uses the new token. Never resubmits."""
    import importlib.util
    from pathlib import Path

    started = time.time()
    # Token that was fresh at submit, expired after 35 minutes of queue wait.
    expired = _jwt(exp=int(started + 60))  # would expire ~1 min after "submit"
    fresh = _jwt(exp=int(started + 3600))
    id_path, _rt = _sign_in(monkeypatch, tmp_path, id_token=expired)

    # Advance "now" past expiry + skew so ensure() wants a refresh.
    later = started + 35 * 60
    assert gw.id_token_needs_refresh(expired, now=later) is True

    refresh_body = json.dumps(
        {"idToken": fresh, "refreshToken": "rt-new", "expiresIn": 3600, "uid": "u"}
    ).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = refresh_body
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("urllib.request.urlopen", return_value=mock_resp):
        # Proactive path at T+35m
        assert gw.ensure_okvevo_id_token(now=later) == fresh
        assert id_path.read_text(encoding="utf-8") == fresh

    # Reset to expired and exercise the 401 → force=True path the adapter uses.
    id_path.write_text(expired, encoding="utf-8")
    with patch("urllib.request.urlopen", return_value=mock_resp):
        assert gw.ensure_okvevo_id_token(force=True) == fresh

    # Adapter wiring: _gateway_helpers returns ensure_okvevo_id_token.
    root = Path(__file__).resolve().parents[2]
    path = root / "skills/creative/short-drama-produce/scripts/provider_adapters.py"
    spec = importlib.util.spec_from_file_location("pa_token_refresh", path)
    assert spec and spec.loader
    adapters = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapters)
    read_token, _resolve, _quote = adapters._gateway_helpers()
    assert read_token is gw.ensure_okvevo_id_token
    # force= kwarg is what the 401 retry passes
    id_path.write_text(expired, encoding="utf-8")
    with patch("urllib.request.urlopen", return_value=mock_resp):
        assert read_token(force=True) == fresh
