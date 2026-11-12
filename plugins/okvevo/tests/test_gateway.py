"""Token lifecycle, quote filtering, run_id, availability gates — all offline."""

from __future__ import annotations

import base64
import json
import time

import pytest

from plugins.okvevo import gateway


def _jwt(exp: float) -> str:
    def b64(obj) -> str:
        raw = json.dumps(obj).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return f"{b64({'alg': 'none'})}.{b64({'exp': int(exp)})}.sig"


@pytest.fixture
def signed_in(tmp_path, monkeypatch):
    token_file = tmp_path / "okvevo-firebase-id-token"
    token_file.write_text(_jwt(time.time() + 3600))
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(token_file))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "https://portal.example")
    monkeypatch.delenv("OKVEVO_BUILD_CHANNEL", raising=False)
    return token_file


def test_read_token_roundtrip(signed_in):
    assert gateway.read_okvevo_id_token() == signed_in.read_text()
    assert gateway.okvevo_signed_in()


def test_read_token_absent(monkeypatch):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    assert gateway.read_okvevo_id_token() is None
    assert not gateway.okvevo_signed_in()


def test_refresh_token_sibling_path(signed_in):
    sibling = signed_in.parent / "okvevo-firebase-refresh-token"
    sibling.write_text("refresh-secret")
    assert gateway.read_okvevo_refresh_token() == "refresh-secret"


def test_id_token_needs_refresh_boundaries():
    now = time.time()
    assert gateway.id_token_needs_refresh(_jwt(now + 60), now=now)          # inside 5min skew
    assert not gateway.id_token_needs_refresh(_jwt(now + 3600), now=now)    # fresh
    assert not gateway.id_token_needs_refresh("not-a-jwt", now=now)         # unreadable → no refresh


def test_gateway_base_url(signed_in):
    assert gateway.okvevo_gateway_base_url() == "https://portal.example/api/gateway"


def test_gateway_base_url_missing_origin(monkeypatch):
    monkeypatch.delenv("OKVEVO_WEB_ORIGIN", raising=False)
    with pytest.raises(gateway.OkvevoGatewayConfigError):
        gateway.okvevo_gateway_base_url()


def test_quote_args_filters_junk_and_data_urls():
    out = gateway._quote_args({
        "prompt": "a cat",
        "duration": 5,
        "internal_junk": "x",
        "image_url": "data:image/png;base64,AAAA",
        "image_urls": ["data:image/png;base64,AAAA", "https://fal.media/ok.png"],
    })
    assert out == {"prompt": "a cat", "duration": 5, "image_urls": ["https://fal.media/ok.png"]}


def test_ensure_run_id_idempotent():
    first = gateway.ensure_okvevo_fal_run_id({"prompt": "x"})
    assert first["run_id"]
    again = gateway.ensure_okvevo_fal_run_id(first)
    assert again["run_id"] == first["run_id"]


def test_internal_channel_flag(monkeypatch):
    monkeypatch.setenv("OKVEVO_BUILD_CHANNEL", "internal")
    assert gateway.okvevo_is_internal_channel()
    monkeypatch.setenv("OKVEVO_BUILD_CHANNEL", "public")
    assert not gateway.okvevo_is_internal_channel()


def test_fal_available_requires_sign_in(monkeypatch):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    assert not gateway.okvevo_fal_available()
    assert not gateway.okvevo_tavily_available()


def test_fal_available_public_build(signed_in, monkeypatch):
    monkeypatch.setenv("FAL_KEY", "user-key")  # public builds ignore BYOK keys
    assert gateway.okvevo_fal_available()


def test_fal_internal_build_prefers_byok(signed_in, monkeypatch):
    monkeypatch.setenv("OKVEVO_BUILD_CHANNEL", "internal")
    monkeypatch.setenv("FAL_KEY", "user-key")
    assert not gateway.okvevo_fal_available()


def test_resolver_shape(signed_in):
    cfg = gateway.resolve_okvevo_fal_gateway()
    assert cfg.vendor == "okvevo-fal"
    assert cfg.gateway_origin == "https://portal.example/api/gateway/fal/queue"
    assert cfg.nous_user_token == signed_in.read_text()
