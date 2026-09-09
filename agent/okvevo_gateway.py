"""Redirect hosted OpenAI-wire clients through the OkVevo LLM gateway.

Reads the Firebase ID token file on every call (tokens rotate ~hourly).
Does not cache the token. Signed-out / empty file → today's BYOK.

When signed in, rewrite unless the URL is loopback/localhost (local models)
or a native-adapter host. Native adapters that never call this helper are
not closed by the rewrite — see PRE-LIVE-BACKLOG ambient native-provider BYOK.
"""

from __future__ import annotations

import ipaddress
import logging
import os
from typing import Optional
from urllib.parse import urlparse

from utils import base_url_host_matches, base_url_hostname

logger = logging.getLogger(__name__)

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


# Mirror of SUBMIT_KEYS in OkVevo-Web src/lib/fal/handleQueue.ts — the only
# argument keys the gateway meters on. Filtering here keeps multi-MB data-URL
# image payloads out of the quote POST and makes quote == submit-time debit.
_QUOTE_ARG_KEYS = frozenset({
    "duration", "num_images", "image_size", "generate_audio", "resolution",
    "num_frames", "width", "height", "enable_web_search", "web_search",
})


def _quote_okvevo_fal_credits(endpoint: str, args: dict) -> Optional[int]:
    """POST /api/fal/quote on the OkVevo portal. Read-only (no reserve, no
    debit). Returns None on ANY failure — a quote outage must never block a
    generation, it just degrades the approval text to the tier label."""
    token = read_okvevo_id_token()
    origin = (os.environ.get("OKVEVO_WEB_ORIGIN") or "").strip().rstrip("/")
    if not token or not origin:
        return None
    try:
        import httpx

        res = httpx.post(
            f"{origin}/api/fal/quote",
            headers={"Authorization": f"Key {token}"},
            json={
                "endpoint": endpoint,
                "args": {k: v for k, v in (args or {}).items() if k in _QUOTE_ARG_KEYS},
            },
            timeout=10.0,
        )
        if res.status_code != 200:
            logger.warning("okvevo fal quote %s: HTTP %s", endpoint, res.status_code)
            return None
        credits = res.json().get("credits")
        if isinstance(credits, (int, float)) and credits >= 0:
            return int(credits)
        return None
    except Exception as exc:  # noqa: BLE001 — quote must fail open
        logger.warning("okvevo fal quote failed (%s): %s", endpoint, exc)
        return None


def _catalog_tier_label(tool_name: str, endpoint: str) -> str:
    try:
        from tools import media_catalog

        kind = "photos" if tool_name == "image_generate" else "videos"
        row = media_catalog.find_shipped(kind, endpoint)
        if row and row.get("tier") == "expensive":
            return "expensive model"
    except Exception:  # noqa: BLE001
        pass
    return "standard"


def okvevo_fal_spend_gate(
    tool_name: str,
    endpoint: str,
    args: dict,
    *,
    extra_note: str = "",
) -> Optional[str]:
    """Quote + human-approval gate for an OkVevo-credit Fal spend.

    Call only when the resolved submit path is the OkVevo gateway
    (``vendor == "okvevo-fal"``). Returns None to proceed, or the
    denial/block message. ``approvals.mode: off`` and yolo skip the gate
    without even quoting. Manual and smart both prompt:
    ``request_tool_approval`` never runs the smart shell guardian. A quote
    failure still prompts (catalog tier label instead of a number) — the
    gate never opens because the quote 5xx'd, and never blocks on quote
    availability alone. Denial returns before submit, so no reserve/debit
    exists yet (the hold is created inside the gateway's submit handler).
    """
    from tools.approval import is_approval_bypass_active, request_tool_approval

    if is_approval_bypass_active():
        return None

    credits = _quote_okvevo_fal_credits(endpoint, args)
    what = "image" if tool_name == "image_generate" else "video"
    if nia_is_internal_channel():
        if credits is not None:
            cost_text = f"estimated ≈ {credits} OkVevo credits"
        else:
            cost_text = (
                f"credit quote unavailable — catalog tier: "
                f"{_catalog_tier_label(tool_name, endpoint)}"
            )
        description = (
            f"Generate {what} with {endpoint} — {cost_text}. "
            "Charged to your OkVevo balance; the final amount settles after completion."
            f"{extra_note}"
        )
    else:
        # Public builds: the approval headline never names the model endpoint.
        article = "an" if what == "image" else "a"
        if credits is not None:
            description = (
                f"Generate {article} {what} — estimated ≈ {credits} OkVevo "
                "credits. Charged to your OkVevo balance; the final amount "
                f"settles after completion.{extra_note}"
            )
        else:
            tier = _catalog_tier_label(tool_name, endpoint)
            premium = " with a premium model" if tier == "expensive model" else ""
            description = (
                f"Generate {article} {what}{premium} — charged to your "
                f"OkVevo balance.{extra_note}"
            )
    verdict = request_tool_approval(
        tool_name,
        description,
        # Per tool+model allowlist grain: [a]lways on "image_generate with
        # nano-banana-pro" must not blanket-approve every image model.
        rule_key=f"{tool_name}:{endpoint}",
    )
    if verdict.get("approved"):
        return None
    return verdict.get("message") or f"BLOCKED: {tool_name} was denied."


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
