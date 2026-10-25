"""Auto alias → wire model + auto-beta-router plugin payload."""

from __future__ import annotations

from plugins.okvevo.auto_allowlists import COST_ALLOWED_MODELS, INTELLIGENCE_ALLOWED_MODELS
from plugins.okvevo.auto_router import (
    AUTO_PLUGIN_ID,
    AUTO_WIRE_MODEL,
    auto_plugin,
    is_okvevo_auto_alias,
    wire_model,
)


def test_alias_detection():
    assert is_okvevo_auto_alias("okvevo/auto-intelligence")
    assert is_okvevo_auto_alias(" okvevo/auto-cost ")
    assert not is_okvevo_auto_alias("openrouter/auto-beta")
    assert not is_okvevo_auto_alias(None)


def test_wire_model_swaps_only_aliases():
    assert wire_model("okvevo/auto-intelligence") == AUTO_WIRE_MODEL
    assert wire_model("okvevo/auto-cost") == AUTO_WIRE_MODEL
    assert wire_model("anthropic/claude-sonnet-4.6") == "anthropic/claude-sonnet-4.6"


def test_transport_swap_survives_a_profileless_build():
    from agent.transports.chat_completions import ChatCompletionsTransport

    from plugins.okvevo.auto_router import install_auto_wire_swap

    install_auto_wire_swap()
    transport = ChatCompletionsTransport()
    kwargs = transport.build_kwargs(
        model="okvevo/auto-cost",
        messages=[{"role": "user", "content": "ping"}],
        request_overrides={"model": "okvevo/auto-cost"},
    )
    assert kwargs["model"] == AUTO_WIRE_MODEL
    assert kwargs["extra_body"]["plugins"][0]["cost_tier"] == "medium"
    specific = transport.build_kwargs(
        model="openai/gpt-4o-mini",
        messages=[{"role": "user", "content": "ping"}],
        request_overrides={"model": "openai/gpt-4o-mini"},
    )
    assert specific["model"] == "openai/gpt-4o-mini"


def test_auto_plugin_payloads():
    intel = auto_plugin("okvevo/auto-intelligence")
    assert intel == {"id": AUTO_PLUGIN_ID, "cost_tier": "xhigh",
                     "allowed_models": list(INTELLIGENCE_ALLOWED_MODELS)}
    cost = auto_plugin("okvevo/auto-cost")
    assert cost == {"id": AUTO_PLUGIN_ID, "cost_tier": "medium",
                    "allowed_models": list(COST_ALLOWED_MODELS)}
    assert auto_plugin("openrouter/auto-beta") is None
