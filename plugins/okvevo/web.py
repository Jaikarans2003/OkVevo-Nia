"""OkVevo web search + extract — Tavily proxied through the OkVevo portal gateway.

Signed-in users route ``/search`` and ``/extract`` through
``{origin}/api/gateway/tavily/*`` with the Firebase ID token — never a local
Tavily key, never keyless. Signed out, the provider reports unavailable and
the registry's normal fallback chain (keyless ring, other providers) applies.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from plugins.okvevo.gateway import (
    OkvevoGatewayConfigError,
    ensure_okvevo_id_token,
    okvevo_gateway_base_url,
    okvevo_tavily_available,
)
from plugins.web._common import (
    SEARCH_LIMIT_CAP,
    BaseWebSearchProvider,
    http_status_detail,
    run_extract,
    run_search,
    setup_schema,
)

# Upstream-owned normalizers reused on purpose: the gateway proxies Tavily
# verbatim, so the response shape is Tavily's. test_upstream_seams.py fails
# loudly if an upstream sync renames them.
from plugins.web.tavily.provider import (
    _normalize_tavily_documents,
    _normalize_tavily_search_results,
)

logger = logging.getLogger(__name__)

_CLIENT_NAME = "okvevo-agent"


def _gateway_request(endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
    """POST to the portal's Tavily proxy. Non-2xx raises ValueError with the body."""
    token = ensure_okvevo_id_token()
    if not token:
        raise ValueError("You're signed in but the OkVevo session token is missing. Sign in again.")
    try:
        url = f"{okvevo_gateway_base_url()}/tavily/{endpoint.lstrip('/')}"
    except OkvevoGatewayConfigError as exc:
        raise ValueError(str(exc)) from exc
    logger.info("OkVevo web %s request via portal gateway", endpoint)
    response = httpx.post(
        url, json=payload, timeout=60,
        headers={"X-Client-Name": _CLIENT_NAME, "Authorization": f"Bearer {token}"},
    )
    if response.status_code >= 400:
        raise ValueError(http_status_detail(response))
    return response.json()


class OkvevoWebSearchProvider(BaseWebSearchProvider):
    """Search + extract included with an OkVevo plan (portal-metered)."""

    NAME = "okvevo"
    DISPLAY_NAME = "OkVevo"
    EXTRACT = True
    KEYLESS = False

    def is_available(self) -> bool:
        return okvevo_tavily_available()

    def search(self, query: str, limit: int = 5) -> dict[str, Any]:
        def _body() -> dict[str, Any]:
            logger.info("OkVevo search: '%s' (limit=%d)", query, limit)
            payload = {
                "query": query, "max_results": min(limit, SEARCH_LIMIT_CAP),
                "include_raw_content": False, "include_images": False,
            }
            return _normalize_tavily_search_results(_gateway_request("search", payload))

        return run_search("OkVevo", logger, _body)

    def extract(self, urls: list[str], **kwargs: Any) -> list[dict[str, Any]]:
        def _body() -> list[dict[str, Any]]:
            logger.info("OkVevo extract: %d URL(s)", len(urls))
            raw = _gateway_request("extract", {"urls": urls, "include_images": False})
            return _normalize_tavily_documents(raw)

        return run_extract("OkVevo", logger, urls, _body)

    def get_setup_schema(self) -> dict[str, Any]:
        return setup_schema(
            "OkVevo", "included", "Web search + reading included with your OkVevo plan.",
        )
