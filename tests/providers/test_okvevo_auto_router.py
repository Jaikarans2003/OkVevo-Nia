"""OkVevo Auto virtual ids: validate + wire remap + catalog snapshot."""

from __future__ import annotations

import json
from pathlib import Path

from agent.okvevo_auto_router import (
    AUTO_WIRE_MODEL,
    OKVEVO_AUTO_COST,
    OKVEVO_AUTO_INTELLIGENCE,
    auto_plugin,
    is_okvevo_auto_alias,
    wire_model,
)
from agent.transports.chat_completions import ChatCompletionsTransport
from hermes_cli.models import OPENROUTER_MODELS, validate_requested_model
from providers import get_provider_profile


def test_wire_model_remaps_aliases():
    assert wire_model(OKVEVO_AUTO_INTELLIGENCE) == AUTO_WIRE_MODEL
    assert wire_model(OKVEVO_AUTO_COST) == AUTO_WIRE_MODEL
    assert wire_model("anthropic/claude-sonnet-5") == "anthropic/claude-sonnet-5"


def test_auto_plugin_only_on_aliases():
    assert auto_plugin("anthropic/claude-sonnet-5") is None
    assert auto_plugin(OKVEVO_AUTO_INTELLIGENCE)["id"] == "auto-beta-router"
    assert auto_plugin(OKVEVO_AUTO_COST)["cost_tier"] == "medium"


def test_validate_accepts_okvevo_auto_aliases():
    for mid in (OKVEVO_AUTO_INTELLIGENCE, OKVEVO_AUTO_COST):
        result = validate_requested_model(mid, "openrouter")
        assert result["accepted"] is True
        assert result["persist"] is True
        assert result["recognized"] is True


def test_validate_rejects_auto_alias_on_wrong_provider():
    result = validate_requested_model(OKVEVO_AUTO_INTELLIGENCE, "anthropic")
    assert result["accepted"] is False


def test_build_kwargs_remaps_model_and_keeps_plugin():
    transport = ChatCompletionsTransport()
    profile = get_provider_profile("openrouter")
    kwargs = transport.build_kwargs(
        model=OKVEVO_AUTO_INTELLIGENCE,
        messages=[{"role": "user", "content": "hi"}],
        tools=None,
        provider_profile=profile,
        max_tokens=None,
        max_tokens_param_fn=lambda x: {"max_tokens": x} if x else {},
        timeout=300,
        reasoning_config=None,
        request_overrides=None,
        session_id="test-okvevo-auto",
        ollama_num_ctx=None,
    )
    assert kwargs["model"] == AUTO_WIRE_MODEL
    plugins = (kwargs.get("extra_body") or {}).get("plugins")
    assert plugins and plugins[0]["id"] == "auto-beta-router"
    assert plugins[0]["cost_tier"] == "xhigh"


def test_build_kwargs_normal_model_unchanged():
    transport = ChatCompletionsTransport()
    profile = get_provider_profile("openrouter")
    kwargs = transport.build_kwargs(
        model="anthropic/claude-sonnet-5",
        messages=[{"role": "user", "content": "hi"}],
        tools=None,
        provider_profile=profile,
        max_tokens=None,
        max_tokens_param_fn=lambda x: {"max_tokens": x} if x else {},
        timeout=300,
        reasoning_config=None,
        request_overrides=None,
        session_id="test",
        ollama_num_ctx=None,
    )
    assert kwargs["model"] == "anthropic/claude-sonnet-5"
    assert "plugins" not in (kwargs.get("extra_body") or {})


def test_openrouter_catalog_snapshot_unchanged_by_auto():
    """Phase C must not append Auto aliases to OPENROUTER_MODELS or catalog."""
    hard = [mid for mid, _ in OPENROUTER_MODELS]
    assert len(hard) == 47
    assert OKVEVO_AUTO_INTELLIGENCE not in hard
    assert OKVEVO_AUTO_COST not in hard
    assert not any(is_okvevo_auto_alias(m) for m in hard)

    catalog_path = (
        Path(__file__).resolve().parents[2]
        / "website"
        / "static"
        / "api"
        / "model-catalog.json"
    )
    data = json.loads(catalog_path.read_text(encoding="utf-8"))
    curated_ids = [m["id"] for m in data["providers"]["openrouter"]["models"]]
    assert set(hard) == set(curated_ids)
    assert OKVEVO_AUTO_INTELLIGENCE not in curated_ids
