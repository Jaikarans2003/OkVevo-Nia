"""OkVevo product plugin — bundled, auto-loaded.

Registers everything the OkVevo portal account powers inside the agent:

- web search + extract through the portal gateway (``web.py``)
- image + video generation through the portal's fal-queue proxy, with a
  credit quote + human-approval spend gate (``media.py``)
- error classification: portal 402 → "out of credits", 401/403 → session copy
- redaction of Firebase ID/refresh tokens (JWTs) in logs and transcripts

The LLM provider lives separately in ``plugins/model-providers/okvevo``
(model-provider plugins are discovered by ``providers/__init__.py``, not here).
"""

from __future__ import annotations

from typing import Any, Optional

from plugins.okvevo.errors import AUTH_COPY, CREDITS_COPY

# Firebase ID/refresh tokens are JWTs; any JWT in agent output is a secret.
_JWT_PATTERN = r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"


def _classify_okvevo_api_error(
    *, provider: str = "", status_code: Optional[int] = None, **_: Any,
) -> Optional[dict[str, Any]]:
    """Portal gateway chat errors → friendly copy + correct recovery strategy.

    Only speaks for provider ``okvevo``; returning None declines so the
    built-in classifier handles everything else.
    """
    if (provider or "").strip().lower() != "okvevo":
        return None
    if status_code == 402:
        return {
            "reason": "billing",
            "message": CREDITS_COPY,
            "retryable": False,
            "should_fallback": False,
        }
    if status_code in (401, 403):
        # Transient auth: the desktop refreshes the ID token hourly; a rebuilt
        # client re-reads it. auth (not auth_permanent) lets that happen.
        return {"reason": "auth", "message": AUTH_COPY, "should_rotate_credential": True}
    return None


def register(ctx) -> None:
    """Plugin entry point."""
    from plugins.okvevo.media import _build_image_provider, _build_video_provider
    from plugins.okvevo.secrets_guard import on_pre_tool_call as _okvevo_secrets_guard
    from plugins.okvevo.web import OkvevoWebSearchProvider

    ctx.register_web_search_provider(OkvevoWebSearchProvider())
    ctx.register_image_gen_provider(_build_image_provider())
    ctx.register_video_gen_provider(_build_video_provider())
    ctx.register_redaction_patterns([_JWT_PATTERN])
    ctx.register_hook("transform_api_error_classification", _classify_okvevo_api_error)
    ctx.register_hook("pre_tool_call", _okvevo_secrets_guard)
    from plugins.okvevo.auto_router import install_auto_wire_swap

    install_auto_wire_swap()
