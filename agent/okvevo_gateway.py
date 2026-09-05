"""Redirect OpenRouter wire clients through the OkVevo LLM gateway.

Reads the Firebase ID token file on every call (tokens rotate ~hourly).
Does not cache the token. Non-OpenRouter hosts are left alone (BYOK).
"""

from __future__ import annotations

import os
from typing import Optional

from utils import base_url_host_matches

_OPENROUTER_HOST = "openrouter.ai"
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


def apply_okvevo_gateway(client_kwargs: dict) -> dict:
    """If a live ID token exists and *base_url* is OpenRouter, rewrite wire creds.

    ponytail: /images/generations, /credits, /key on this base_url are unmetered
    this pass — meter those routes later if they pick up the same rewrite.
    """
    token = read_okvevo_id_token()
    if not token:
        return client_kwargs
    base_url = str(client_kwargs.get("base_url") or "")
    if not base_url_host_matches(base_url, _OPENROUTER_HOST):
        return client_kwargs
    client_kwargs["base_url"] = okvevo_gateway_base_url()
    client_kwargs["api_key"] = token
    return client_kwargs
