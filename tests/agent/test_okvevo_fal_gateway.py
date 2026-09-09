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


class TestSpendGate:
    """Quote + approval gate before an OkVevo-credit Fal submit."""

    def _gate(self, monkeypatch, tmp_path, **kw):
        _sign_in(monkeypatch, tmp_path)
        from agent.okvevo_gateway import okvevo_fal_spend_gate

        return okvevo_fal_spend_gate(**kw)

    def test_bypass_mode_skips_quote_and_prompt(self, monkeypatch, tmp_path):
        monkeypatch.setattr("tools.approval.is_approval_bypass_active", lambda: True)
        def _boom(*_a, **_k):
            raise AssertionError("quote/approval must not run when bypassed")
        monkeypatch.setattr("httpx.post", _boom)
        monkeypatch.setattr("tools.approval.request_tool_approval", _boom)
        assert self._gate(
            monkeypatch, tmp_path,
            tool_name="image_generate", endpoint="fal-ai/nano-banana-pro", args={},
        ) is None

    def test_quote_number_in_description(self, monkeypatch, tmp_path):
        monkeypatch.setattr("tools.approval.is_approval_bypass_active", lambda: False)
        captured = {}

        class _Res:
            status_code = 200
            def json(self):
                return {"credits": 42, "unit": "images", "unitPrice": 0.04}

        def _post(url, headers=None, json=None, timeout=None):
            captured["url"] = url
            captured["json"] = json
            return _Res()

        def _approve(tool_name, reason, *, rule_key="", approval_callback=None):
            captured["tool_name"] = tool_name
            captured["reason"] = reason
            captured["rule_key"] = rule_key
            return {"approved": True, "message": None}

        monkeypatch.setattr("httpx.post", _post)
        monkeypatch.setattr("tools.approval.request_tool_approval", _approve)
        assert self._gate(
            monkeypatch, tmp_path,
            tool_name="image_generate",
            endpoint="fal-ai/nano-banana-pro",
            args={"num_images": 2, "image_url": "data:image/png;base64,AAAA"},
        ) is None
        assert captured["url"] == "http://localhost:3000/api/fal/quote"
        # Metering keys pass through; the data-URL payload does not.
        assert captured["json"] == {
            "endpoint": "fal-ai/nano-banana-pro",
            "args": {"num_images": 2},
        }
        assert "≈ 42 OkVevo credits" in captured["reason"]
        assert captured["tool_name"] == "image_generate"
        assert captured["rule_key"] == "image_generate:fal-ai/nano-banana-pro"

    def test_quote_failure_falls_back_to_tier_label(self, monkeypatch, tmp_path):
        monkeypatch.setattr("tools.approval.is_approval_bypass_active", lambda: False)
        captured = {}

        class _Res:
            status_code = 500
            def json(self):
                return {}

        def _approve(tool_name, reason, *, rule_key="", approval_callback=None):
            captured["reason"] = reason
            return {"approved": True, "message": None}

        monkeypatch.setattr("httpx.post", lambda *a, **k: _Res())
        monkeypatch.setattr("tools.approval.request_tool_approval", _approve)
        # Gate still fires on a quote 5xx; expensive catalog row → tier label.
        assert self._gate(
            monkeypatch, tmp_path,
            tool_name="image_generate", endpoint="fal-ai/nano-banana-pro", args={},
        ) is None
        assert "quote unavailable" in captured["reason"]
        assert "expensive model" in captured["reason"]

    def test_denial_returns_message(self, monkeypatch, tmp_path):
        monkeypatch.setattr("tools.approval.is_approval_bypass_active", lambda: False)
        monkeypatch.setattr(
            "tools.approval.request_tool_approval",
            lambda *a, **k: {"approved": False, "message": "BLOCKED: denied by user"},
        )
        monkeypatch.setattr("httpx.post", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
        denial = self._gate(
            monkeypatch, tmp_path,
            tool_name="video_generate",
            endpoint="minimax/h3-max/text-to-video",
            args={"duration": "6"},
        )
        assert denial == "BLOCKED: denied by user"
