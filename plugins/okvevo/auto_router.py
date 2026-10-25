"""Virtual OkVevo Auto model ids → OpenRouter auto-beta wire + plugin.

No scoring — OpenRouter's auto-beta-router picks from the allow-list.
"""

from __future__ import annotations

from typing import Any

from plugins.okvevo.auto_allowlists import (
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


def install_auto_wire_swap() -> None:
    """Rewrite Auto aliases on the chat transport after request overrides.

    The profile sets the wire model, then the transport copies a session
    override back on top. Some chat builds also skip the profile. Wrapping
    ``build_kwargs`` is the last owned step before the HTTP client. A transport
    that posts without ``build_kwargs`` will not see this.
    """
    from agent.transports.chat_completions import ChatCompletionsTransport

    current = ChatCompletionsTransport.build_kwargs
    if getattr(current, "_okvevo_auto_wire", False):
        return

    def build_kwargs(self, model, messages, tools=None, **params):
        kwargs = current(self, model, messages, tools, **params)
        alias = kwargs.get("model") if is_okvevo_auto_alias(kwargs.get("model")) else model
        if not is_okvevo_auto_alias(alias):
            return kwargs
        kwargs["model"] = wire_model(alias)
        extra = dict(kwargs.get("extra_body") or {})
        extra.pop("model", None)
        plugin = auto_plugin(alias)
        if plugin:
            rest = [
                item for item in (extra.get("plugins") or [])
                if not (isinstance(item, dict) and item.get("id") == plugin["id"])
            ]
            extra["plugins"] = [plugin, *rest]
        if extra:
            kwargs["extra_body"] = extra
        return kwargs

    build_kwargs._okvevo_auto_wire = True  # type: ignore[attr-defined]
    ChatCompletionsTransport.build_kwargs = build_kwargs


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
