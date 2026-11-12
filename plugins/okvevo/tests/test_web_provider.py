"""OkVevo web provider — availability gate and gateway request shaping (offline)."""

from __future__ import annotations

import base64
import json
import time

import pytest

from plugins.okvevo import web as okvevo_web
from plugins.okvevo.web import OkvevoWebSearchProvider


def _jwt() -> str:
    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return f"{b64({'alg': 'none'})}.{b64({'exp': int(time.time()) + 3600})}.sig"


@pytest.fixture
def signed_in(tmp_path, monkeypatch):
    token_file = tmp_path / "okvevo-firebase-id-token"
    token_file.write_text(_jwt())
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(token_file))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "https://portal.example")
    monkeypatch.delenv("OKVEVO_BUILD_CHANNEL", raising=False)
    return token_file


def test_unavailable_signed_out(monkeypatch):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    provider = OkvevoWebSearchProvider()
    assert not provider.is_available()
    assert not provider.is_keyless_available()


def test_search_posts_to_gateway(signed_in, monkeypatch):
    calls = {}

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"results": [{"title": "T", "url": "https://x", "content": "C"}]}

    def fake_post(url, json=None, timeout=None, headers=None):
        calls.update(url=url, payload=json, headers=headers)
        return _Resp()

    monkeypatch.setattr(okvevo_web.httpx, "post", fake_post)
    result = OkvevoWebSearchProvider().search("cats", limit=3)
    assert calls["url"] == "https://portal.example/api/gateway/tavily/search"
    assert calls["headers"]["Authorization"] == f"Bearer {signed_in.read_text()}"
    assert calls["payload"]["max_results"] == 3
    assert result["success"] is True
    assert result["data"]["web"][0]["url"] == "https://x"


def test_gateway_error_body_reaches_caller(signed_in, monkeypatch):
    class _Resp:
        status_code = 402
        text = "Out of OkVevo credits"

    monkeypatch.setattr(okvevo_web.httpx, "post", lambda *a, **k: _Resp())
    result = OkvevoWebSearchProvider().search("cats")
    assert result["success"] is False
    assert "credits" in result["error"].lower()


def test_extract_maps_documents(signed_in, monkeypatch):
    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"results": [{"url": "https://x", "title": "T", "raw_content": "body"}],
                    "failed_urls": ["https://bad"]}

    monkeypatch.setattr(okvevo_web.httpx, "post", lambda *a, **k: _Resp())
    docs = OkvevoWebSearchProvider().extract(["https://x", "https://bad"])
    assert docs[0]["content"] == "body"
    assert docs[1]["error"]
