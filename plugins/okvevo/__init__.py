"""OkVevo product plugin — bundled, auto-loaded.

Registers everything the OkVevo portal account powers inside the agent:

- web search + extract through the portal gateway (``web.py``)
- image + video generation through the portal's fal-queue proxy, with a
  credit quote + human-approval spend gate (``media.py``)
- error classification: portal 402 → "out of credits", 401/403 → session copy,
  429 with ``reset_at`` → "Busy, retrying at HH:MM"
- redaction of Firebase ID/refresh tokens (JWTs) in logs and transcripts

The LLM provider lives separately in ``plugins/model-providers/okvevo``
(model-provider plugins are discovered by ``providers/__init__.py``, not here).
"""

from __future__ import annotations

from typing import Any, Optional

from plugins.okvevo.errors import AUTH_COPY, CREDITS_COPY, busy_until_copy

# Firebase ID/refresh tokens are JWTs; any JWT in agent output is a secret.
_JWT_PATTERN = r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"


def _classify_okvevo_api_error(
    *, provider: str = "", status_code: Optional[int] = None,
    error_body: Optional[dict[str, Any]] = None, **_: Any,
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
        # auth (not auth_permanent) so the pool calls refresh_credential once.
        # Do not rotate: benching the only key paints "Limited until…".
        return {"reason": "auth", "message": AUTH_COPY, "should_rotate_credential": False}
    if status_code == 429:
        error = (error_body or {}).get("error")
        reset_at = error.get("reset_at") if isinstance(error, dict) else None
        copy = busy_until_copy(reset_at)
        if copy:
            # Same flags + reset window as the built-in 429 verdict; only the copy changes.
            return {
                "reason": "rate_limit",
                "message": copy,
                "should_rotate_credential": True,
                "should_fallback": True,
                "error_context": {"reset_at": reset_at},
            }
    return None


def register(ctx) -> None:
    """Plugin entry point."""
    from plugins.okvevo.managed_settings_guard import on_pre_tool_call as _okvevo_managed_settings_guard
    from plugins.okvevo.media import _build_image_provider, _build_video_provider
    from plugins.okvevo.secrets_guard import on_pre_tool_call as _okvevo_secrets_guard
    from plugins.okvevo.web import OkvevoWebSearchProvider

    ctx.register_web_search_provider(OkvevoWebSearchProvider())
    ctx.register_image_gen_provider(_build_image_provider())
    ctx.register_video_gen_provider(_build_video_provider())
    ctx.register_redaction_patterns([_JWT_PATTERN])
    ctx.register_hook("transform_api_error_classification", _classify_okvevo_api_error)
    ctx.register_hook("pre_tool_call", _okvevo_secrets_guard)
    ctx.register_hook("pre_tool_call", _okvevo_managed_settings_guard)
    from plugins.okvevo.auto_router import install_auto_wire_swap

    install_auto_wire_swap()
    try:
        from plugins.okvevo.credentials import ensure_okvevo_pool_entry

        ensure_okvevo_pool_entry()
    except Exception:
        pass
