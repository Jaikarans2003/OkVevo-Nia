"""Public-build user-facing error copy (Nia).

Every error a public Nia build surfaces — from any tool, skill, or LLM
provider, present or future — maps to one of the category lines below.
Two cooperating layers share the design:

- Python source mapping (this module): recognized categories get friendly
  copy BEFORE the text can feed the next LLM turn, so the model never
  echoes vendor setup instructions (API keys, portal links) into chat.
- Renderer default-deny (apps/desktop/src/lib/user-facing-error.ts):
  anything still unrecognized at display time becomes the generic
  fallback. Keep the two copies in sync.

Internal builds (NIA_BUILD_CHANNEL=internal) keep raw text everywhere.
"""

from __future__ import annotations

import re
from typing import Optional

CREDITS_COPY = (
    "You're out of OkVevo credits — top up at okvevo.com and I'll pick up "
    "right where we left off."
)
RATE_LIMIT_COPY = (
    "Whoa, slow down — too many requests at once. Give it a few seconds and "
    "try again."
)
SERVER_COPY = "Something broke on our side. The OkVevo team is on it — try again in a bit."
AUTH_COPY = "Your session hit a snag — restart Nia and we should be good."
NETWORK_COPY = "Can't reach OkVevo right now — check your internet and try again."
CONTENT_BLOCKED_COPY = "That one got blocked by content filters — try rephrasing."
UNREADABLE_FILE_COPY = "I couldn't read that file — try attaching it again."
FALLBACK_COPY = "Something went wrong on my end — give that another try."

_COPY_BY_CATEGORY = {
    "credits": CREDITS_COPY,
    "rate_limit": RATE_LIMIT_COPY,
    "server": SERVER_COPY,
    "auth": AUTH_COPY,
    "network": NETWORK_COPY,
    "content_blocked": CONTENT_BLOCKED_COPY,
    "unreadable_file": UNREADABLE_FILE_COPY,
}

# Already-friendly copy must survive a second pass through the mapper
# (renderer net re-sanitizes text the Python side already mapped).
_KNOWN_FRIENDLY = frozenset(_COPY_BY_CATEGORY.values()) | {FALLBACK_COPY}

_HTTP_STATUS_RE = re.compile(r"\bHTTP\s{0,2}(\d{3})\b", re.IGNORECASE)

# Same low-level markers run_agent._summarize_api_error uses for offline
# detection, plus the wrapped shapes httpx/requests surface.
_NETWORK_MARKERS = (
    "temporary failure in name resolution",
    "name or service not known",
    "nodename nor servname provided, or not known",
    "getaddrinfo failed",
    "no address associated with hostname",
    "network is unreachable",
    "may be offline",
    "connection error",
    "connection refused",
    "connection reset",
    "connect timeout",
    "read timeout",
    "timed out",
    "dns",
)

_AUTH_ERROR_TYPES = {
    "auth_required",
    "authentication",
    "authentication_error",
    "permission_denied",
    "unauthorized",
}

_BILLING_ERROR_TYPES = {
    "billing",
    "billing_unverified",
    "insufficient_credits",
    "payment_required",
}


def _extract_status(raw: str, status: Optional[int]) -> Optional[int]:
    if isinstance(status, int):
        return status
    match = _HTTP_STATUS_RE.search(raw or "")
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None
    return None


def categorize_error(
    raw: str,
    *,
    status: Optional[int] = None,
    error_type: Optional[str] = None,
) -> Optional[str]:
    """Return the copy-deck category for an error, or None when unrecognized.

    Keyed on HTTP status / structured error_type first, message markers
    second — never vendor-name matching.
    """
    text = (raw or "").strip()
    if not text:
        return None
    if text in _KNOWN_FRIENDLY:
        # Idempotent: already-mapped copy categorizes as itself.
        for category, copy in _COPY_BY_CATEGORY.items():
            if text == copy:
                return category
        return None

    et = (error_type or "").strip().lower()
    lowered = text.lower()
    code = _extract_status(text, status)

    if (
        code == 402
        or et in _BILLING_ERROR_TYPES
        or "insufficient credits" in lowered
        or "out of credits" in lowered
        or "payment required" in lowered
        or "okvevo credits" in lowered
    ):
        return "credits"
    if (
        code == 429
        or "rate_limit" in et
        or "rate limit" in lowered
        or "too many requests" in lowered
    ):
        return "rate_limit"
    if code in (401, 403) or et in _AUTH_ERROR_TYPES:
        return "auth"
    if code is not None and 500 <= code < 600 or et in ("server_error", "internal_error"):
        return "server"
    if et in ("content_blocked", "content_filter", "safety") or (
        "content filter" in lowered
        or "content policy" in lowered
        or "blocked by safety" in lowered
        or "safety system" in lowered
    ):
        return "content_blocked"
    if et in ("network", "network_error", "connection_error", "timeout") or any(
        marker in lowered for marker in _NETWORK_MARKERS
    ):
        return "network"
    if et == "unreadable_file":
        return "unreadable_file"
    return None


def _is_internal() -> bool:
    # Lazy import: tools/registry.py (a caller) loads before agent.* is safe
    # to import at module scope.
    from agent.okvevo_gateway import nia_is_internal_channel

    return nia_is_internal_channel()


def map_public_error(
    raw: str,
    *,
    status: Optional[int] = None,
    error_type: Optional[str] = None,
) -> Optional[str]:
    """Recognized category → friendly copy on public builds; otherwise None.

    None means "no opinion" — callers that feed the model (tool_error) pass
    the original text through so the agent keeps self-correction detail,
    while display surfaces apply their own default-deny fallback.
    Internal builds always return None (raw text everywhere).
    """
    if _is_internal():
        return None
    category = categorize_error(raw, status=status, error_type=error_type)
    return _COPY_BY_CATEGORY.get(category) if category else None


def public_error_message(
    raw: str,
    *,
    status: Optional[int] = None,
    error_type: Optional[str] = None,
) -> str:
    """Default-deny mapping for display: unrecognized → generic fallback.

    Internal builds return ``raw`` unchanged.
    """
    if _is_internal():
        return raw
    return map_public_error(raw, status=status, error_type=error_type) or FALLBACK_COPY
