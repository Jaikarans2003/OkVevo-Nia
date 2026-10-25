"""OkVevo provider profile — registration, Auto wire swap, client defaults, 402 hook."""

from __future__ import annotations

import time

import pytest

from plugins.okvevo import _classify_okvevo_api_error
from plugins.okvevo.auto_router import AUTO_PLUGIN_ID, AUTO_WIRE_MODEL


@pytest.fixture
def profile():
    from providers import get_provider_profile

    prof = get_provider_profile("okvevo")
    assert prof is not None, "okvevo profile not discovered"
    return prof


def test_registered_with_auto_fallbacks(profile):
    assert profile.display_name == "OkVevo"
    assert "okvevo/auto-intelligence" in profile.fallback_models
    assert "okvevo/auto-cost" in profile.fallback_models


def test_auto_alias_swaps_wire_model(profile):
    extra_body, top_level = profile.build_api_kwargs_extras(
        reasoning_config={"effort": "medium"}, supports_reasoning=True,
        model="okvevo/auto-intelligence", session_id="s1",
    )
    assert top_level["model"] == AUTO_WIRE_MODEL
    body = profile.build_extra_body(session_id="s1", model="okvevo/auto-intelligence")
    assert body["model"] == AUTO_WIRE_MODEL
    assert body["plugins"][0]["id"] == AUTO_PLUGIN_ID
    assert body["plugins"][0]["allowed_models"]


def test_alias_override_still_wires_auto_beta(profile):
    """A session model override puts the alias back on the kwargs. extra_body wins on the wire."""
    from agent.transports.chat_completions import ChatCompletionsTransport

    kwargs = ChatCompletionsTransport().build_kwargs(
        model="okvevo/auto-cost",
        messages=[{"role": "user", "content": "ping"}],
        provider_profile=profile,
        request_overrides={"model": "okvevo/auto-cost"},
    )
    extra = kwargs["extra_body"]
    wire = {key: value for key, value in kwargs.items() if key != "extra_body"}
    wire.update(extra)
    assert wire["model"] == AUTO_WIRE_MODEL
    assert extra["plugins"][0]["cost_tier"] == "medium"


def test_normal_model_untouched(profile):
    _extra, top_level = profile.build_api_kwargs_extras(
        reasoning_config=None, supports_reasoning=False,
        model="anthropic/claude-sonnet-4.6", session_id="s1",
    )
    assert "model" not in top_level
    body = profile.build_extra_body(session_id="s1", model="anthropic/claude-sonnet-4.6")
    assert "plugins" not in body


def test_client_kwargs_defaults(profile, tmp_path, monkeypatch):
    import base64
    import json

    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    token = f"{b64({'alg': 'none'})}.{b64({'exp': int(time.time()) + 3600})}.sig"
    token_file = tmp_path / "okvevo-firebase-id-token"
    token_file.write_text(token)
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(token_file))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "https://portal.example")
    extras = profile.build_client_kwargs_extras()
    assert extras["base_url"] == "https://portal.example/api/gateway"
    assert extras["api_key"] == token


def test_402_maps_to_billing_copy():
    verdict = _classify_okvevo_api_error(provider="okvevo", status_code=402)
    assert verdict["reason"] == "billing"
    assert "credits" in verdict["message"].lower()
    assert verdict["should_fallback"] is False


def test_401_maps_to_auth():
    verdict = _classify_okvevo_api_error(provider="okvevo", status_code=401)
    assert verdict["reason"] == "auth"
    assert verdict["should_rotate_credential"] is True


def test_classifier_declines_other_providers():
    assert _classify_okvevo_api_error(provider="openrouter", status_code=402) is None
    assert _classify_okvevo_api_error(provider="okvevo", status_code=500) is None
