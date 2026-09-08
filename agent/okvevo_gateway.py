"""Redirect hosted OpenAI-wire clients through the OkVevo LLM gateway.

Reads the Firebase ID token file on every call (tokens rotate ~hourly).
Does not cache the token. Signed-out / empty file → today's BYOK.

When signed in, rewrite unless the URL is loopback/localhost (local models)
or a native-adapter host. Native adapters that never call this helper are
not closed by the rewrite — see PRE-LIVE-BACKLOG ambient native-provider BYOK.
"""

from __future__ import annotations

import ipaddress
import os
from typing import Optional
from urllib.parse import urlparse

from utils import base_url_host_matches, base_url_hostname

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})
# Hosts whose native SDKs/adapters do not speak OpenAI-wire through this helper.
# Skipping them is the documented ambient BYOK gap, not a silent close.
_NATIVE_ADAPTER_DOMAINS = (
    "api.anthropic.com",
    "githubcopilot.com",
    "generativelanguage.googleapis.com",
    "bedrock.amazonaws.com",
    "aiplatform.googleapis.com",
)
OKVEVO_ORIGIN_MISSING = (
    "Nia is signed in but the OkVevo portal URL is not configured. "
    "Set OKVEVO_WEB_ORIGIN in ~/.hermes/.env and restart Nia."
)


class OkvevoGatewayConfigError(Exception):
    """User-visible config error; str() is the chat bubble."""


def read_okvevo_id_token() -> Optional[str]:
    path = (os.environ.get("OKVEVO_FIREBASE_ID_TOKEN_FILE") or "").strip()
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            token = fh.read().strip()
    except OSError:
        return None
    return token or None


def okvevo_signed_in() -> bool:
    """True when a non-empty OkVevo Firebase ID token file is present."""
    return bool(read_okvevo_id_token())


def okvevo_gateway_base_url() -> str:
    origin = (os.environ.get("OKVEVO_WEB_ORIGIN") or "").strip().rstrip("/")
    if not origin:
        raise OkvevoGatewayConfigError(OKVEVO_ORIGIN_MISSING)
    return f"{origin}/api/gateway"


def nia_is_internal_channel() -> bool:
    return (os.environ.get("NIA_BUILD_CHANNEL") or "").strip().lower() == "internal"


def okvevo_fal_available() -> bool:
    """Signed-in OkVevo Fal path (public always; internal only without FAL_KEY)."""
    if not okvevo_signed_in():
        return False
    if nia_is_internal_channel():
        from tools.tool_backend_helpers import fal_key_is_configured

        if fal_key_is_configured():
            return False
    return True


def okvevo_tavily_available() -> bool:
    """Signed-in OkVevo Tavily path (public always; internal only without TAVILY_API_KEY)."""
    if not okvevo_signed_in():
        return False
    if nia_is_internal_channel():
        from agent.web_search_provider import get_provider_env

        if (get_provider_env("TAVILY_API_KEY") or "").strip():
            return False
    return True


def resolve_okvevo_fal_gateway():
    """Queue origin + Firebase ID token, or None for the existing nous/FAL_KEY switch."""
    if not okvevo_fal_available():
        return None
    token = read_okvevo_id_token()
    if not token:
        return None
    from types import SimpleNamespace

    return SimpleNamespace(
        vendor="okvevo-fal",
        gateway_origin=f"{okvevo_gateway_base_url()}/fal/queue",
        nous_user_token=token,
        managed_mode=True,
    )


def _is_local_allowlisted(base_url: str) -> bool:
    raw = (base_url or "").strip()
    if not raw:
        return False
    parsed = urlparse(raw if "://" in raw else f"http://{raw}")
    scheme = (parsed.scheme or "").lower()
    # acp:// and other non-HTTP native transports are not hosted OpenAI-wire.
    if scheme not in ("", "http", "https"):
        return True
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return False
    if host in _LOCAL_HOSTS or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _is_native_adapter_url(base_url: str) -> bool:
    host = base_url_hostname(base_url)
    if not host:
        return False
    if any(base_url_host_matches(base_url, domain) for domain in _NATIVE_ADAPTER_DOMAINS):
        return True
    # bedrock-runtime.<region>.amazonaws.com is not a subdomain of bedrock.amazonaws.com.
    return host.endswith(".amazonaws.com") and "bedrock" in host.split(".")


def apply_okvevo_gateway(client_kwargs: dict) -> dict:
    """If a live ID token exists, rewrite hosted OpenAI-wire creds to the gateway.

    Loopback / localhost / non-HTTP native transports are left alone.
    Anthropic / Copilot / Gemini / Bedrock hosts are left alone (ambient BYOK gap).

    ponytail: /images/generations, /credits, /key on this base_url are unmetered
    this pass — meter those routes later if they pick up the same rewrite.
    """
    token = read_okvevo_id_token()
    if not token:
        return client_kwargs
    base_url = str(client_kwargs.get("base_url") or "")
    if _is_local_allowlisted(base_url) or _is_native_adapter_url(base_url):
        return client_kwargs
    client_kwargs["base_url"] = okvevo_gateway_base_url()
    client_kwargs["api_key"] = token
    return client_kwargs
