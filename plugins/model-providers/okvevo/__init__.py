"""OkVevo provider profile — portal LLM gateway (OpenAI wire, OpenRouter-backed).

The portal proxies ``{OKVEVO_WEB_ORIGIN}/api/gateway/*`` to OpenRouter and
meters usage on OkVevo credits, so this profile delegates wire quirks
(reasoning passthrough, sticky routing, endpoint pins) to the bundled
OpenRouter profile at call time and adds:

- credentials: ``OKVEVO_API_KEY`` (the desktop writes the rotating Firebase
  ID token to ``~/.hermes/.env`` hourly); when unset, the token file read by
  ``plugins.okvevo.gateway`` fills ``build_client_kwargs_extras`` defaults
- the two virtual Auto models: ``okvevo/auto-intelligence`` and
  ``okvevo/auto-cost`` become wire model ``openrouter/auto-beta`` plus an
  ``auto-beta-router`` plugin entry carrying the verified allow-list

402/401 chat errors are mapped by the ``transform_api_error_classification``
hook registered in ``plugins/okvevo``.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from providers import register_provider
from providers.base import ProviderProfile

logger = logging.getLogger(__name__)

_DEFAULT_ORIGIN = "https://www.okvevo.com"


def _gateway_base_url() -> str:
    origin = (os.environ.get("OKVEVO_WEB_ORIGIN") or "").strip().rstrip("/") or _DEFAULT_ORIGIN
    return f"{origin}/api/gateway"


def _openrouter_profile():
    """The registered OpenRouter profile, or None very early in discovery.

    Resolved lazily per call — resolving at import time would recurse into
    provider discovery while it is importing this module.
    """
    try:
        from providers import get_provider_profile

        return get_provider_profile("openrouter")
    except Exception:
        return None


class OkvevoProfile(ProviderProfile):
    """OkVevo gateway: OpenRouter semantics + Auto aliases + rotating token."""

    def build_client_kwargs_extras(self, **context: Any) -> dict[str, Any]:
        """Defaults only (core merges with ``setdefault``): a resolved
        ``OKVEVO_API_KEY`` wins; the token file covers CLI runs without it."""
        extras: dict[str, Any] = {"base_url": _gateway_base_url()}
        try:
            from plugins.okvevo.gateway import ensure_okvevo_id_token

            token = ensure_okvevo_id_token()
            if token:
                extras["api_key"] = token
        except Exception:
            logger.debug("okvevo token read skipped", exc_info=True)
        return extras

    def build_extra_body(self, *, session_id: str | None = None, **context: Any) -> dict[str, Any]:
        body: dict[str, Any] = {}
        upstream = _openrouter_profile()
        if upstream is not None:
            try:
                body.update(upstream.build_extra_body(session_id=session_id, **context))
            except Exception:
                logger.debug("openrouter extra-body delegation failed", exc_info=True)
        from plugins.okvevo.auto_router import auto_plugin, wire_model

        auto = auto_plugin(context.get("model"))
        if auto:
            body["plugins"] = [auto]
            # request_overrides are applied after top-level kwargs and put the
            # alias back. The OpenAI SDK merges extra_body over the JSON body,
            # so the wire model has to be here or Auto never leaves the client.
            body["model"] = wire_model(context.get("model"))
        return body

    def build_api_kwargs_extras(
        self, *, reasoning_config: dict | None = None, supports_reasoning: bool = False,
        model: str | None = None, session_id: str | None = None, **context: Any,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        extra_body: dict[str, Any] = {}
        top_level: dict[str, Any] = {}
        upstream = _openrouter_profile()
        if upstream is not None:
            try:
                extra_body, top_level = upstream.build_api_kwargs_extras(
                    reasoning_config=reasoning_config, supports_reasoning=supports_reasoning,
                    model=model, session_id=session_id, **context,
                )
            except Exception:
                logger.debug("openrouter api-kwargs delegation failed", exc_info=True)
        from plugins.okvevo.auto_router import AUTO_WIRE_MODEL, is_okvevo_auto_alias

        if is_okvevo_auto_alias(model):
            # The transport applies these AFTER the base kwargs, so this swaps
            # the outgoing "model" without a core edit (request_overrides from
            # the user still win, applied later).
            top_level["model"] = AUTO_WIRE_MODEL
        return extra_body, top_level


okvevo = OkvevoProfile(
    name="okvevo",
    display_name="OkVevo",
    description="OkVevo — models included with your OkVevo plan",
    signup_url="https://www.okvevo.com",
    env_vars=("OKVEVO_API_KEY",),
    base_url=_gateway_base_url(),
    fallback_models=("okvevo/auto-intelligence", "okvevo/auto-cost"),
)

register_provider(okvevo)
