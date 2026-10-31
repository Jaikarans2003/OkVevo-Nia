"""OkVevo image/video providers — registration, spend gate, gateway submit (offline)."""

from __future__ import annotations

import base64
import json
import time

import pytest

import plugins.okvevo.media as media
from plugins.okvevo import register


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


class _FakeCtx:
    def __init__(self):
        self.web = []
        self.image = []
        self.video = []
        self.redaction = []
        self.hooks = []

    def register_web_search_provider(self, p):
        self.web.append(p)

    def register_image_gen_provider(self, p):
        self.image.append(p)

    def register_video_gen_provider(self, p):
        self.video.append(p)

    def register_redaction_patterns(self, patterns):
        self.redaction.extend(patterns)
        return len(patterns)

    def register_hook(self, name, cb):
        self.hooks.append((name, cb))


def test_register_wires_everything():
    ctx = _FakeCtx()
    register(ctx)
    assert [p.name for p in ctx.web] == ["okvevo"]
    assert [p.name for p in ctx.image] == ["okvevo"]
    assert [p.name for p in ctx.video] == ["okvevo"]
    assert ctx.redaction, "JWT redaction pattern missing"
    assert ctx.hooks and ctx.hooks[0][0] == "transform_api_error_classification"


def test_jwt_redaction_pattern_matches():
    import re

    from plugins.okvevo import _JWT_PATTERN

    # Realistic shape: Firebase ID token signatures are 300+ chars.
    realistic = f"{_jwt()}nature-padding-to-realistic-length"
    assert re.search(_JWT_PATTERN, f"Authorization: Bearer {realistic}")
    assert not re.search(_JWT_PATTERN, "plain text, no token here")


def test_video_signed_out_is_auth_error(monkeypatch):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    provider = media._build_video_provider()
    assert not provider.is_available()
    result = provider.generate("a cat")
    assert result["success"] is False
    assert result["error_type"] == "auth_required"


def test_video_spend_gate_denial_blocks_submit(signed_in, monkeypatch):
    provider = media._build_video_provider()
    monkeypatch.setattr(media, "okvevo_fal_spend_gate", lambda *a, **k: "BLOCKED: denied")
    monkeypatch.setattr(
        media, "_submit_okvevo_fal",
        lambda *a, **k: pytest.fail("submit must not run after denial"),
    )
    import plugins.video_gen.fal as fal_video

    monkeypatch.setattr(fal_video, "_load_fal_client", lambda: object())
    result = provider.generate("a cat")
    assert result["success"] is False
    assert result["error_type"] == "approval_denied"


def test_video_happy_path_submits_via_gateway(signed_in, monkeypatch):
    import plugins.video_gen.fal as fal_video
    import tools.fal_common as fal_common

    monkeypatch.setattr(fal_video, "_load_fal_client", lambda: object())
    monkeypatch.setattr(media, "okvevo_fal_spend_gate", lambda *a, **k: None)

    seen = {}

    class _Handle:
        request_id = "req-1"

    def fake_submit(endpoint, arguments, *, what):
        seen["endpoint"] = endpoint
        seen["arguments"] = media.ensure_okvevo_fal_run_id(arguments)
        return _Handle()

    monkeypatch.setattr(media, "_submit_okvevo_fal", fake_submit)
    monkeypatch.setattr(
        fal_common, "wait_fal_queue_result",
        lambda handle: {"video": {"url": "https://v.fal.media/x.mp4"}},
    )
    result = provider_result = media._build_video_provider().generate("a cat dancing")
    assert provider_result["success"] is True, result.get("error")
    assert result["provider"] == "okvevo"
    assert result["video"] == "https://v.fal.media/x.mp4"
    assert seen["arguments"]["run_id"]


def test_image_signed_out_is_auth_error(monkeypatch):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    provider = media._build_image_provider()
    assert not provider.is_available()
    result = provider.generate("a cat")
    assert result["success"] is False
    assert result["error_type"] == "auth_required"


def test_image_happy_path(signed_in, monkeypatch):
    import tools.image_generation_tool as img_tool

    monkeypatch.setattr(media, "okvevo_fal_spend_approval", lambda *a, **k: (None, 13))
    seen = {}

    def fake_submit(endpoint, arguments, *, what):
        seen["endpoint"] = endpoint
        seen["arguments"] = media.ensure_okvevo_fal_run_id(arguments)
        return object()

    monkeypatch.setattr(media, "_submit_okvevo_fal", fake_submit)
    monkeypatch.setattr(
        img_tool, "_wait_fal_result",
        lambda handle, **k: {"images": [{"url": "https://fal.media/i.png", "width": 10, "height": 10}]},
    )
    provider = media._build_image_provider()
    result = provider.generate("a cat", upscale=False)
    assert result["success"] is True, result.get("error")
    assert result["provider"] == "okvevo"
    assert result["image"] == "https://fal.media/i.png"
    assert seen["arguments"]["run_id"]
    assert seen["arguments"]["prompt"] == "a cat"
    assert seen["arguments"]["approved_credits"] == 13, "the portal never reserves more than approved"


def test_image_without_a_quote_submits_without_approved_credits(signed_in, monkeypatch):
    import tools.image_generation_tool as img_tool

    seen = {}
    monkeypatch.setattr(media, "okvevo_fal_spend_approval", lambda *a, **k: (None, None))
    monkeypatch.setattr(media, "_submit_okvevo_fal",
                        lambda endpoint, arguments, *, what: seen.update(arguments) or object())
    monkeypatch.setattr(img_tool, "_wait_fal_result",
                        lambda handle, **k: {"images": [{"url": "https://fal.media/i.png"}]})
    assert media._build_image_provider().generate("a cat", upscale=False)["success"] is True
    assert "approved_credits" not in seen


def test_gpt_image_2_submits_the_portal_endpoint(signed_in, monkeypatch):
    """The catalog row is fal-ai/gpt-image-2; the portal only allowlists openai/gpt-image-2."""
    import tools.image_generation_tool as img_tool

    gated, seen = {}, {}
    monkeypatch.setattr(media, "okvevo_fal_spend_approval",
                        lambda tool, endpoint, args, **k: (gated.setdefault("endpoint", endpoint) and None, 106))
    monkeypatch.setattr(media, "_submit_okvevo_fal",
                        lambda endpoint, arguments, *, what: seen.setdefault("endpoint", endpoint) or object())
    monkeypatch.setattr(img_tool, "_resolve_fal_model",
                        lambda *a, **k: ("fal-ai/gpt-image-2", img_tool.FAL_MODELS["fal-ai/gpt-image-2"]))
    monkeypatch.setattr(img_tool, "_wait_fal_result",
                        lambda handle, **k: {"images": [{"url": "https://fal.media/g.png"}]})

    result = media._build_image_provider().generate("a poster", upscale=False)
    assert result["success"] is True, result.get("error")
    assert result["model"] == "fal-ai/gpt-image-2"
    assert gated["endpoint"] == seen["endpoint"] == "openai/gpt-image-2"


def test_spend_approval_quotes_even_when_approvals_are_off(monkeypatch):
    from plugins.okvevo import gateway

    monkeypatch.setattr(gateway, "okvevo_fal_quote", lambda endpoint, args: (106, None))
    monkeypatch.setattr("tools.approval.is_approval_bypass_active", lambda: True)
    assert gateway.okvevo_fal_spend_approval("image_generate", "openai/gpt-image-2", {}) == (None, 106)
    assert gateway.okvevo_fal_spend_gate("video_generate", "x", {}) is None
