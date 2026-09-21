"""Virtual OkVevo Auto model ids → OpenRouter auto-beta wire + plugin.

No scoring — OpenRouter's auto-beta-router picks from the allow-list.
"""

from __future__ import annotations

from typing import Any

from agent.okvevo_auto_allowlists import (
    COST_ALLOWED_MODELS,
    INTELLIGENCE_ALLOWED_MODELS,
)

AUTO_WIRE_MODEL = "openrouter/auto-beta"
AUTO_PLUGIN_ID = "auto-beta-router"

OKVEVO_AUTO_INTELLIGENCE = "okvevo/auto-intelligence"
OKVEVO_AUTO_COST = "okvevo/auto-cost"

OKVEVO_AUTO_ALIASES = frozenset({OKVEVO_AUTO_INTELLIGENCE, OKVEVO_AUTO_COST})


def is_okvevo_auto_alias(model: str | None) -> bool:
    return (model or "").strip() in OKVEVO_AUTO_ALIASES


def wire_model(model: str | None) -> str:
    """HTTP body ``model`` — virtual aliases become openrouter/auto-beta."""
    mid = (model or "").strip()
    if mid in OKVEVO_AUTO_ALIASES:
        return AUTO_WIRE_MODEL
    return mid


def auto_plugin(model: str | None) -> dict[str, Any] | None:
    """``plugins[0]`` for an Auto alias, else None (do not emit on normal ids)."""
    mid = (model or "").strip()
    if mid == OKVEVO_AUTO_INTELLIGENCE:
        return {
            "id": AUTO_PLUGIN_ID,
            "cost_tier": "xhigh",
            "allowed_models": list(INTELLIGENCE_ALLOWED_MODELS),
        }
    if mid == OKVEVO_AUTO_COST:
        return {
            "id": AUTO_PLUGIN_ID,
            "cost_tier": "medium",
            "allowed_models": list(COST_ALLOWED_MODELS),
        }
    return None
