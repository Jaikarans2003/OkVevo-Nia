"""Expired Firebase ID tokens are refreshed once, then a bot can chat and generate."""

from __future__ import annotations

import base64
import json
import time

import pytest


def _jwt(exp: int) -> str:
    def b64(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return f"{b64({'alg': 'none'})}.{b64({'exp': exp})}.sig"


def test_refresh_credential_once_then_sign_in(monkeypatch):
    from hermes_cli.auth_constants import AuthError
    from providers import get_provider_profile

    profile = get_provider_profile("okvevo")
    tokens = iter(["fresh-token", "fresh-token"])

    def fake_ensure(*, force: bool = False, now=None):
        return next(tokens)

    monkeypatch.setattr("plugins.okvevo.gateway.ensure_okvevo_id_token", fake_ensure)
    monkeypatch.setattr("plugins.okvevo.gateway.read_okvevo_refresh_token", lambda: "refresh")
    monkeypatch.setattr("plugins.okvevo.gateway.id_token_exp_unix", lambda _token: int(time.time()) + 3600)

    class Entry:
        access_token = "expired-token"
        extra: dict = {}

    rotated = profile.refresh_credential(Entry())
    assert rotated["access_token"] == "fresh-token"
    assert rotated["okvevo_auth_retried"] is True

    class Retried:
        access_token = "fresh-token"
        extra = {"okvevo_auth_retried": True}

    with pytest.raises(AuthError, match="Please sign in again"):
        profile.refresh_credential(Retried())


def test_image_submit_refreshes_once_on_401(monkeypatch):
    from plugins.okvevo import media

    calls = {"n": 0}

    class Boom(Exception):
        status_code = 401

    class Handle:
        request_id = "img-1"

    def fake_client():
        class Client:
            def submit(self, endpoint, arguments, headers=None):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise Boom("invalid_token")
                return Handle()

        return Client()

    monkeypatch.setattr(media, "_okvevo_fal_client", fake_client)
    monkeypatch.setattr("plugins.okvevo.gateway.ensure_okvevo_id_token", lambda **_k: "fresh-token")

    handle = media._submit_okvevo_fal("fal-ai/flux", {"prompt": "circle"}, what="image")
    assert handle.request_id == "img-1"
    assert calls["n"] == 2


def test_image_submit_second_401_asks_to_sign_in(monkeypatch):
    from plugins.okvevo import media

    class Boom(Exception):
        status_code = 401

    def fake_client():
        class Client:
            def submit(self, endpoint, arguments, headers=None):
                raise Boom("invalid_token")

        return Client()

    monkeypatch.setattr(media, "_okvevo_fal_client", fake_client)
    monkeypatch.setattr("plugins.okvevo.gateway.ensure_okvevo_id_token", lambda **_k: "still-bad")

    with pytest.raises(ValueError, match="Please sign in again"):
        media._submit_okvevo_fal("fal-ai/flux", {"prompt": "circle"}, what="image")


def test_strip_removes_profile_env_copies(tmp_path, monkeypatch):
    import os

    from plugins.okvevo.credentials import strip_okvevo_api_key_copies

    root = tmp_path / "hermes"
    (root / "profiles" / "cfo").mkdir(parents=True)
    (root / ".env").write_text("KEEP=1\nOKVEVO_API_KEY=stale-root\n", encoding="utf-8")
    (root / "profiles" / "cfo" / ".env").write_text("OKVEVO_API_KEY=stale-bot\nKEEP=1\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setenv("OKVEVO_API_KEY", "stale-root")

    strip_okvevo_api_key_copies()

    assert "OKVEVO_API_KEY" not in (root / ".env").read_text(encoding="utf-8")
    assert "OKVEVO_API_KEY" not in (root / "profiles" / "cfo" / ".env").read_text(encoding="utf-8")
    assert "OKVEVO_API_KEY" not in os.environ


def test_web_401_retries_once(monkeypatch):
    from plugins.okvevo import web

    calls = {"n": 0}

    def post(endpoint, payload, token):
        calls["n"] += 1

        class Response:
            status_code = 401 if calls["n"] == 1 else 200

            def json(self):
                return {"results": []}

        return Response()

    tokens = iter(["expired-token", "fresh-token"])
    monkeypatch.setattr(web, "_post_gateway", post)
    monkeypatch.setattr(web, "ensure_okvevo_id_token", lambda **_k: next(tokens))

    assert web._gateway_request("search", {"query": "news"}) == {"results": []}
    assert calls["n"] == 2


def test_cli_hints_map_to_sign_in_copy(monkeypatch):
    monkeypatch.delenv("OKVEVO_BUILD_CHANNEL", raising=False)
    from plugins.okvevo.errors import map_public_error

    assert map_public_error("add a backup provider with `hermes fallback add`") == "Please sign in again"
    assert map_public_error("Run: hermes setup") == "Please sign in again"


def test_first_401_refresh_does_not_bench(tmp_path, monkeypatch):
    """The pool calls refresh_credential before any cooldown. A successful
    refresh leaves the row usable."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    def fake_ensure(*, force=False, now=None):
        return "new-token" if force else "old-token"

    monkeypatch.setattr("plugins.okvevo.gateway.ensure_okvevo_id_token", fake_ensure)
    monkeypatch.setattr("plugins.okvevo.gateway.read_okvevo_refresh_token", lambda: "refresh")
    monkeypatch.setattr("plugins.okvevo.gateway.id_token_exp_unix", lambda _token: int(time.time()) + 3600)

    from agent.credential_pool import STATUS_EXHAUSTED, load_pool
    from plugins.okvevo.credentials import ensure_okvevo_pool_entry

    ensure_okvevo_pool_entry()
    pool = load_pool("okvevo")
    current = next(entry for entry in pool.entries() if entry.access_token == "old-token")
    refreshed = pool.try_refresh_matching(api_key_hint=current.access_token)
    assert refreshed is not None
    assert refreshed.access_token == "new-token"
    assert refreshed.last_status != STATUS_EXHAUSTED


def test_loopback_catalog_ignores_proxy(monkeypatch):
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    from providers import get_provider_profile

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.rsplit("/", 1)[-1] != "models":
                self.send_response(404)
                self.end_headers()
                return
            body = b'{"data":[{"id":"openai/gpt-4o-mini"}]}'
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _fmt, *_args):
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.setattr("plugins.okvevo.gateway.ensure_okvevo_id_token", lambda **_k: "live-token")
    try:
        models = get_provider_profile("okvevo").fetch_models(api_key="stale")
    finally:
        server.shutdown()
    assert models == ["openai/gpt-4o-mini"]


def test_fetch_models_uses_gateway_not_openrouter(monkeypatch):
    from providers import get_provider_profile

    profile = get_provider_profile("okvevo")
    seen = {}

    def fake_fetch(self, *, api_key=None, base_url=None, timeout=8.0):
        seen["api_key"] = api_key
        seen["base_url"] = base_url
        return ["openai/gpt-4o-mini", "okvevo/auto-cost"]

    monkeypatch.setattr("plugins.okvevo.gateway.ensure_okvevo_id_token", lambda **_k: "live-token")
    monkeypatch.setattr("providers.base.ProviderProfile.fetch_models", fake_fetch)
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "https://portal.example")

    models = profile.fetch_models(api_key="stale")
    assert models == ["openai/gpt-4o-mini", "okvevo/auto-cost"]
    assert seen["api_key"] == "live-token"
    assert seen["base_url"] == "https://portal.example/api/gateway"
    assert "openrouter.ai" not in seen["base_url"]
