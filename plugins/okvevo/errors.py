"""Public-build user-facing error copy (OkVevo).

Recognized error categories get friendly copy BEFORE the text can feed the
next LLM turn, so the model never echoes vendor setup instructions (API
keys, portal links) into chat. The desktop renderer applies its own
default-deny fallback for anything still unrecognized at display time.

Internal builds (OKVEVO_BUILD_CHANNEL=internal) keep raw text everywhere.
Keyed on HTTP status / structured error_type first, message markers second
— never vendor-name matching.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

CREDITS_COPY = (
    "You're out of OkVevo credits — top up at okvevo.com and I'll pick up "
    "right where we left off."
)
RATE_LIMIT_COPY = (
    "Whoa, slow down — too many requests at once. Give it a few seconds and "
    "try again."
)
SERVER_COPY = "Something broke on our side. The OkVevo team is on it — try again in a bit."
AUTH_COPY = "Please sign in again"
_LEGACY_AUTH_COPY = "Your session hit a snag — sign in to OkVevo again and we should be good."
_CLI_HINTS = (
    "hermes fallback add",
    "hermes setup",
    "hermes model",
    "hermes auth",
)
SUBSCRIPTION_COPY = (
    "Your OkVevo subscription isn't active — visit okvevo.com to get back on a plan."
)
NETWORK_COPY = "Can't reach OkVevo right now — check your internet and try again."
CONTENT_BLOCKED_COPY = "That one got blocked by content filters — try rephrasing."
UNREADABLE_FILE_COPY = "I couldn't read that file — try attaching it again."
VENDOR_REJECTED_COPY = "The image service refused this request. Your credits were returned."
VENDOR_UNAVAILABLE_COPY = (
    "The image service is temporarily unavailable. Your credits were returned."
)
FALLBACK_COPY = "Something went wrong on my end — give that another try."

_COPY_BY_CATEGORY = {
    "credits": CREDITS_COPY,
    "rate_limit": RATE_LIMIT_COPY,
    "server": SERVER_COPY,
    "auth": AUTH_COPY,
    "subscription": SUBSCRIPTION_COPY,
    "network": NETWORK_COPY,
    "content_blocked": CONTENT_BLOCKED_COPY,
    "unreadable_file": UNREADABLE_FILE_COPY,
    "vendor_rejected": VENDOR_REJECTED_COPY,
    "vendor_unavailable": VENDOR_UNAVAILABLE_COPY,
}

# OkVevo portal ``error.code`` values. When a (status, code) pair matches,
# it decides the category and ``message`` is never read.
_PORTAL_CODE_CATEGORY = {
    (401, "invalid_token"): "auth",
    (402, "insufficient_quota"): "credits",
    (502, "vendor_rejected"): "vendor_rejected",
    (502, "vendor_unavailable"): "vendor_unavailable",
}

# Already-friendly copy must survive a second pass through the mapper
# (renderer re-sanitizes text the Python side already mapped).
_KNOWN_FRIENDLY = frozenset(_COPY_BY_CATEGORY.values()) | {FALLBACK_COPY}

_HTTP_STATUS_RE = re.compile(r"\bHTTP\s{0,2}(\d{3})\b", re.IGNORECASE)

# Portal 429 (in_flight_budget_exhausted / plan_concurrency_limit) carries
# error.reset_at = now + Retry-After; the retry loop waits for Retry-After.
_BUSY_RE = re.compile(r"^Busy, retrying at \d{2}:\d{2}$")


def busy_until_copy(reset_at: Any) -> Optional[str]:
    """``Busy, retrying at HH:MM`` (local time) for a portal ``reset_at``, else None.

    Accepts epoch seconds, epoch milliseconds (> 1e12), or ISO-8601 (no offset = UTC).
    """
    if isinstance(reset_at, bool):
        return None
    ts: Optional[float] = None
    if isinstance(reset_at, (int, float)):
        ts = float(reset_at)
    elif isinstance(reset_at, str) and reset_at.strip():
        text = reset_at.strip()
        try:
            ts = float(text)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return None
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            ts = parsed.timestamp()
    if ts is None or ts <= 0:
        return None
    if ts > 1e12:
        ts /= 1000.0
    return f"Busy, retrying at {datetime.fromtimestamp(ts).strftime('%H:%M')}"

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
    """Return the copy-deck category for an error, or None when unrecognized."""
    by_code = _PORTAL_CODE_CATEGORY.get((status, (error_type or "").strip().lower()))
    if by_code:
        return by_code
    text = (raw or "").strip()
    if not text:
        return None
    if text == _LEGACY_AUTH_COPY or any(hint in text.lower() for hint in _CLI_HINTS):
        return "auth"
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
    if (
        et == "plan_not_active"
        or "plan not active" in lowered
        or "subscription isn't active" in lowered
    ):
        return "subscription"
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


def portal_status_and_code(exc: BaseException) -> tuple[Optional[int], Optional[str]]:
    """HTTP status and portal ``error.code`` from an httpx / fal_client error."""
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if not isinstance(status, int):
        status = getattr(exc, "status_code", None)
    if not isinstance(status, int):
        status = None
    code = None
    try:
        error = response.json().get("error") if response is not None else None
        if isinstance(error, dict) and isinstance(error.get("code"), str):
            code = error["code"]
    except Exception:
        pass
    return status, code


def _is_internal() -> bool:
    from plugins.okvevo.gateway import okvevo_is_internal_channel

    return okvevo_is_internal_channel()


def map_public_error(
    raw: str,
    *,
    status: Optional[int] = None,
    error_type: Optional[str] = None,
) -> Optional[str]:
    """Recognized category → friendly copy on public builds; otherwise None.

    None means "no opinion" — callers that feed the model pass the original
    text through so the agent keeps self-correction detail, while display
    surfaces apply their own default-deny fallback.
    Internal builds always return None (raw text everywhere).
    """
    if _is_internal():
        return None
    if _BUSY_RE.fullmatch((raw or "").strip()):
        return raw.strip()
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
