"""OkVevo Fal queue routing: signed-in rewrite vs leftover FAL_KEY / internal BYOK."""

from __future__ import annotations

from unittest.mock import patch

from agent.okvevo_gateway import resolve_okvevo_fal_gateway


def _sign_in(monkeypatch, tmp_path, token="idt"):
    p = tmp_path / "tok"
    p.write_text(token, encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "http://localhost:3000")


def test_signed_in_no_fal_key_uses_okvevo(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    with patch("tools.tool_backend_helpers.fal_key_is_configured", return_value=False):
        from tools import image_generation_tool as it

        with patch.object(it, "read_selection", return_value=None):
            gw = it._resolve_managed_fal_gateway()
    assert gw.gateway_origin == "http://localhost:3000/api/gateway/fal/queue"
    assert gw.nous_user_token == "idt"


def test_public_signed_in_ignores_leftover_fal_key(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    with patch("tools.tool_backend_helpers.fal_key_is_configured", return_value=True):
        gw = resolve_okvevo_fal_gateway()
    assert gw is not None
    assert gw.gateway_origin.endswith("/api/gateway/fal/queue")


def test_signed_out_with_fal_key_is_direct(monkeypatch):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    from tools import image_generation_tool as it

    with patch.object(it, "read_selection", return_value=None), \
         patch.object(it, "fal_key_is_configured", return_value=True):
        assert it._resolve_managed_fal_gateway() is None


def test_internal_signed_in_with_key_is_byok(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "internal")
    with patch("tools.tool_backend_helpers.fal_key_is_configured", return_value=True):
        assert resolve_okvevo_fal_gateway() is None
    from tools import image_generation_tool as it

    with patch("tools.tool_backend_helpers.fal_key_is_configured", return_value=True), \
         patch.object(it, "read_selection", return_value="fal"), \
         patch.object(it, "fal_key_is_configured", return_value=True):
        assert it._resolve_managed_fal_gateway() is None


def test_video_signed_in_uses_same_helper(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path, token="idt-vid")
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    with patch("tools.tool_backend_helpers.fal_key_is_configured", return_value=False):
        from plugins.video_gen import fal as vf

        gw = vf._resolve_managed_fal_video_gateway()
    assert gw.nous_user_token == "idt-vid"
    assert gw.gateway_origin == "http://localhost:3000/api/gateway/fal/queue"
