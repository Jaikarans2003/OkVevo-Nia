"""OkVevo provider profile — portal LLM gateway (OpenAI wire, OpenRouter-backed).

The portal proxies ``{OKVEVO_WEB_ORIGIN}/api/gateway/*`` to OpenRouter and
meters usage on OkVevo credits, so this profile delegates wire quirks
(reasoning passthrough, sticky routing, endpoint pins) to the bundled
OpenRouter profile at call time and adds:

- credentials: the desktop token file, read at request time
  (``plugins.okvevo.gateway.ensure_okvevo_id_token``). Profile ``.env`` copies
  are not a credential. ``refresh_credential`` is the pool's one refresh on 401.
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


def _is_loopback(base_url: str) -> bool:
    from urllib.parse import urlparse

    return (urlparse(base_url).hostname or "").lower() in {"127.0.0.1", "localhost", "::1"}


def _fetch_loopback_models(base_url: str, api_key: str, timeout: float) -> list[str] | None:
    import json
    import urllib.request

    req = urllib.request.Request(
        base_url.rstrip("/") + "/models",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "okvevo-catalog",
        },
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        logger.debug("okvevo loopback catalog failed", exc_info=True)
        return None
    items = data if isinstance(data, list) else data.get("data", [])
    from hermes_cli.chat_catalog import chat_catalog_ids

    return chat_catalog_ids(items)


def _okvevo_refresh_credential(entry: Any) -> dict[str, Any]:
    """One portal refresh for a 401. A second rejection asks the user to sign in.

    Assigned on the profile instance: ``refresh_credential`` is a dataclass
    field, so a method of the same name is overwritten with None at init.
    """
    from hermes_cli.auth_constants import AuthError

    from plugins.okvevo.gateway import (
        ensure_okvevo_id_token,
        id_token_exp_unix,
        read_okvevo_refresh_token,
    )

    previous = (getattr(entry, "access_token", None) or "").strip()
    extra = getattr(entry, "extra", None) or {}
    if extra.get("okvevo_auth_retried"):
        raise AuthError("Please sign in again", provider="okvevo", relogin_required=True)
    token = ensure_okvevo_id_token(force=True)
    if not token or token == previous:
        raise AuthError("Please sign in again", provider="okvevo", relogin_required=True)
    exp = id_token_exp_unix(token)
    return {
        "access_token": token,
        "refresh_token": read_okvevo_refresh_token() or "okvevo-file",
        "expires_at_ms": int(exp * 1000) if exp else None,
        "okvevo_auth_retried": True,
    }


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
        """Defaults only (core merges with ``setdefault``). The live client
        reads the token file per request via ``create_client``."""
        extras: dict[str, Any] = {"base_url": _gateway_base_url()}
        try:
            from plugins.okvevo.auto_router import install_auto_wire_swap

            install_auto_wire_swap()
        except Exception:
            logger.debug("okvevo auto wire swap skipped", exc_info=True)
        try:
            from plugins.okvevo.credentials import ensure_okvevo_pool_entry
            from plugins.okvevo.gateway import ensure_okvevo_id_token

            ensure_okvevo_pool_entry()
            token = ensure_okvevo_id_token()
            if token:
                extras["api_key"] = token
        except Exception:
            logger.debug("okvevo token read skipped", exc_info=True)
        return extras

    def create_client(self, **client_kwargs: Any) -> Any | None:
        """OpenAI client whose ``api_key`` callable re-reads the token file."""
        try:
            from openai import OpenAI

            from plugins.okvevo.credentials import ensure_okvevo_pool_entry

            ensure_okvevo_pool_entry()
        except Exception:
            logger.debug("okvevo client setup skipped", exc_info=True)
            return None

        def api_key() -> str:
            # OpenAI calls this on every request (``_refresh_api_key``). It
            # re-reads the token file and refreshes when under 5 minutes of
            # life remain. Nothing is copied into the process environment:
            # that copy is what the pool benches on the first 401.
            try:
                from plugins.okvevo.gateway import ensure_okvevo_id_token

                ensure_okvevo_pool_entry()
                return ensure_okvevo_id_token() or ""
            except Exception:
                logger.debug("okvevo token read failed", exc_info=True)
                return ""

        kwargs: dict[str, Any] = {
            "api_key": api_key,
            "base_url": client_kwargs.get("base_url") or _gateway_base_url(),
            "max_retries": 0,
        }
        if client_kwargs.get("timeout") is not None:
            kwargs["timeout"] = client_kwargs["timeout"]
        if client_kwargs.get("default_headers"):
            kwargs["default_headers"] = client_kwargs["default_headers"]
        try:
            return OpenAI(**kwargs)
        except Exception:
            logger.debug("okvevo client build failed", exc_info=True)
            return None

    def fetch_models(
        self, *, api_key: str | None = None, base_url: str | None = None, timeout: float = 8.0,
    ) -> list[str] | None:
        """Live catalog from ``GET {origin}/api/gateway/models``. Never openrouter.ai."""
        try:
            from plugins.okvevo.gateway import ensure_okvevo_id_token

            token = ensure_okvevo_id_token() or api_key
        except Exception:
            token = api_key
        if not token:
            return None
        target = (base_url or _gateway_base_url()).rstrip("/")
        # ponytail: CI sets HTTP_PROXY. urllib would send 127.0.0.1 through it
        # and the mock catalog would never arrive. Direct only for loopback;
        # a real portal still uses the upstream opener (and the system proxy).
        if _is_loopback(target):
            return _fetch_loopback_models(target, token, timeout)
        return super().fetch_models(api_key=token, base_url=target, timeout=timeout)

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
    refresh_credential=_okvevo_refresh_credential,
)

register_provider(okvevo)
