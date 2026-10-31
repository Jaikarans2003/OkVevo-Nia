"""OkVevo portal gateway helpers — token lifecycle, Fal quote/spend gate, availability.

The desktop app writes the Firebase ID token (rotates ~hourly) and refresh
token to files and exports ``OKVEVO_FIREBASE_ID_TOKEN_FILE`` /
``OKVEVO_WEB_ORIGIN`` into the agent environment. Everything here re-reads
those files per call — nothing caches a token.

Owned by OkVevo (not upstream Hermes). Imported by ``plugins/okvevo`` and
``plugins/model-providers/okvevo``.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

OKVEVO_ORIGIN_MISSING = (
    "You're signed in but the OkVevo portal URL is not configured. "
    "This build's pack-env is empty or unreadable. Reinstall the official OkVevo app."
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


def _okvevo_id_token_path() -> Optional[str]:
    path = (os.environ.get("OKVEVO_FIREBASE_ID_TOKEN_FILE") or "").strip()
    return path or None


def read_okvevo_refresh_token() -> Optional[str]:
    """Refresh token next to the ID token file (Electron writes both).

    Re-reading the ID token file alone cannot survive a 1h expiry — the JWT
    itself is stale. The refresh token is the durable half.
    """
    explicit = (os.environ.get("OKVEVO_FIREBASE_REFRESH_TOKEN_FILE") or "").strip()
    if explicit:
        path = explicit
    else:
        id_path = _okvevo_id_token_path()
        if not id_path:
            return None
        # Sibling of okvevo-firebase-id-token → okvevo-firebase-refresh-token
        from pathlib import Path

        path = str(Path(id_path).with_name("okvevo-firebase-refresh-token"))
    try:
        with open(path, encoding="utf-8") as fh:
            token = fh.read().strip()
    except OSError:
        return None
    return token or None


def id_token_exp_unix(id_token: str) -> Optional[int]:
    """Best-effort `exp` claim from a Firebase ID JWT. None if unreadable."""
    try:
        import base64
        import json as _json

        part = id_token.split(".")[1]
        pad = "=" * (-len(part) % 4)
        claims = _json.loads(base64.urlsafe_b64decode(part + pad))
        exp = claims.get("exp")
        return int(exp) if isinstance(exp, (int, float)) else None
    except (IndexError, ValueError, TypeError, OSError):
        return None


# Refresh when fewer than 5 minutes remain (matches Electron refreshDelayMs skew).
_ID_TOKEN_REFRESH_SKEW_S = 5 * 60


def id_token_needs_refresh(id_token: str, *, now: Optional[float] = None) -> bool:
    exp = id_token_exp_unix(id_token)
    if exp is None:
        return False
    import time as _time

    return float(exp) - (now if now is not None else _time.time()) <= _ID_TOKEN_REFRESH_SKEW_S


def _write_secret_file(path: str, value: str) -> None:
    import os as _os
    import tempfile
    from pathlib import Path

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".okvevo-tok-")
    try:
        with _os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(value)
        _os.chmod(tmp, 0o600)
        _os.replace(tmp, path)
    except Exception:
        try:
            _os.unlink(tmp)
        except OSError:
            pass
        raise


def refresh_okvevo_id_token(*, force: bool = False, now: Optional[float] = None) -> Optional[str]:
    """Exchange the refresh token for a fresh ID token; rewrite the ID file.

    Returns the new ID token, or the current one if refresh was not needed /
    not possible. Never raises — a failed refresh leaves the old token in place.
    """
    current = read_okvevo_id_token()
    if not current:
        return None
    if not force and not id_token_needs_refresh(current, now=now):
        return current
    refresh = read_okvevo_refresh_token()
    origin = (os.environ.get("OKVEVO_WEB_ORIGIN") or "").strip().rstrip("/")
    id_path = _okvevo_id_token_path()
    if not refresh or not origin or not id_path:
        return current
    import json as _json
    import urllib.error
    import urllib.request
    from pathlib import Path

    try:
        req = urllib.request.Request(
            f"{origin}/api/auth/desktop/refresh",
            data=_json.dumps({"refreshToken": refresh}).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = _json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning("okvevo id token refresh failed: %s", exc)
        return current
    new_id = body.get("idToken") if isinstance(body, dict) else None
    if not isinstance(new_id, str) or not new_id.strip():
        return current
    new_id = new_id.strip()
    try:
        _write_secret_file(id_path, new_id)
        new_refresh = body.get("refreshToken") if isinstance(body, dict) else None
        if isinstance(new_refresh, str) and new_refresh.strip():
            refresh_path = (os.environ.get("OKVEVO_FIREBASE_REFRESH_TOKEN_FILE") or "").strip() or str(
                Path(id_path).with_name("okvevo-firebase-refresh-token")
            )
            _write_secret_file(refresh_path, new_refresh.strip())
    except OSError as exc:
        logger.warning("okvevo id token write failed: %s", exc)
        return current
    return new_id


def ensure_okvevo_id_token(*, force: bool = False, now: Optional[float] = None) -> Optional[str]:
    """ID token for a portal call: refresh proactively when near expiry, else re-read."""
    refreshed = refresh_okvevo_id_token(force=force, now=now)
    return refreshed or read_okvevo_id_token()


def okvevo_signed_in() -> bool:
    """True when a non-empty OkVevo Firebase ID token file is present."""
    return bool(read_okvevo_id_token())


def okvevo_web_origin() -> str:
    """Portal origin from the pack-env, or '' when unset (CLI/dev runs)."""
    return (os.environ.get("OKVEVO_WEB_ORIGIN") or "").strip().rstrip("/")


def okvevo_gateway_base_url() -> str:
    origin = okvevo_web_origin()
    if not origin:
        raise OkvevoGatewayConfigError(OKVEVO_ORIGIN_MISSING)
    return f"{origin}/api/gateway"


def okvevo_is_internal_channel() -> bool:
    """Internal team builds keep raw vendor errors; public builds get the copy deck."""
    return (os.environ.get("OKVEVO_BUILD_CHANNEL") or "").strip().lower() == "internal"


# Mirror of SUBMIT_KEYS in OkVevo-Web src/lib/fal/handleQueue.ts — the only
# argument keys the gateway meters on. Filtering here keeps accidental junk
# out of the quote POST and makes quote == submit-time debit. Media references
# are short strings (drama-upload:// refs or fal.media URLs — uploads happen
# before quoting), so they are cheap to include and required for media pricing.
# data: payloads are not a price input and must not ride the quote POST.
_QUOTE_ARG_KEYS = frozenset({
    "duration", "num_images", "image_size", "generate_audio", "resolution",
    "num_frames", "width", "height", "enable_web_search", "web_search",
    "quality", "text", "lyrics", "size", "task", "aspect_ratio", "prompt",
    "voice_id", "language_boost", "model", "audio_url",
    "image_url", "start_image_url", "end_image_url", "middle_image_url",
    "mask_url", "target_audio_url", "image_urls", "reference_image_urls",
    "video_urls", "reference_video_urls", "audio_urls", "reference_audio_urls",
})


def _is_data_url(value: object) -> bool:
    return isinstance(value, str) and value.lstrip().startswith("data:")


def _quote_args(args: Optional[dict]) -> dict:
    """Metering keys only; drop data: payloads (keep short upload/Fal refs)."""
    out: dict = {}
    for key, value in (args or {}).items():
        if key not in _QUOTE_ARG_KEYS:
            continue
        if isinstance(value, list):
            kept = [item for item in value if not _is_data_url(item)]
            if kept:
                out[key] = kept
            continue
        if _is_data_url(value):
            continue
        out[key] = value
    return out


# Upstream catalog row id → the Fal endpoint the portal allowlists and prices
# (OkVevo-Web src/lib/fal/allowlist.ts). The row id stays the user-facing model id.
_PORTAL_IMAGE_ENDPOINTS = {"fal-ai/gpt-image-2": "openai/gpt-image-2"}


def okvevo_image_endpoint(model_id: str) -> str:
    """Text-to-image endpoint to quote and submit for an image catalog row."""
    return _PORTAL_IMAGE_ENDPOINTS.get(model_id, model_id)


def okvevo_fal_quote(endpoint: str, args: dict) -> tuple[Optional[int], Optional[str]]:
    """POST /api/fal/quote on the OkVevo portal. Read-only (no reserve, no
    debit). ``(credits, None)`` when the portal prices the request, else
    ``(None, reason)``. The spend gate fails open on a reason — a quote outage
    must never block a generation, it just degrades the approval text."""
    token = ensure_okvevo_id_token()
    origin = okvevo_web_origin()
    if not token or not origin:
        return None, "not signed in to OkVevo"
    try:
        import httpx

        def _post(bearer: str):
            return httpx.post(
                f"{origin}/api/fal/quote",
                headers={"Authorization": f"Key {bearer}"},
                json={"endpoint": endpoint, "args": _quote_args(args)},
                timeout=10.0,
            )

        res = _post(token)
        if res.status_code in (401, 403):
            refreshed = ensure_okvevo_id_token(force=True)
            if not refreshed or refreshed == token:
                return None, "not signed in to OkVevo"
            res = _post(refreshed)
        if res.status_code != 200:
            logger.warning("okvevo fal quote %s: HTTP %s", endpoint, res.status_code)
            reason = None
            try:
                error = res.json().get("error")
                reason = error.get("message") if isinstance(error, dict) else None
            except Exception:
                pass
            return None, reason or f"quote HTTP {res.status_code}"
        credits = res.json().get("credits")
        if isinstance(credits, (int, float)) and credits >= 0:
            return int(credits), None
        return None, "quote had no credit amount"
    except Exception as exc:  # noqa: BLE001 — quote must fail open
        logger.warning("okvevo fal quote failed (%s): %s", endpoint, exc)
        return None, "quote unavailable"


def okvevo_fal_spend_gate(
    tool_name: str,
    endpoint: str,
    args: dict,
    *,
    extra_note: str = "",
) -> Optional[str]:
    """Quote + human-approval gate for an OkVevo-credit Fal spend.

    Call only when the submit path is the OkVevo gateway. Returns None to
    proceed, or the denial/block message. ``approvals.mode: off`` and yolo
    skip the gate without even quoting. A quote failure still prompts (no
    number in the text) — the gate never opens because the quote 5xx'd, and
    never blocks on quote availability alone. Denial returns before submit,
    so no reserve/debit exists yet (the hold is created inside the gateway's
    submit handler).
    """
    from tools.approval import is_approval_bypass_active

    if is_approval_bypass_active():
        return None
    return okvevo_fal_spend_approval(tool_name, endpoint, args, extra_note=extra_note)[0]


def okvevo_fal_spend_approval(
    tool_name: str,
    endpoint: str,
    args: dict,
    *,
    extra_note: str = "",
) -> tuple[Optional[str], Optional[int]]:
    """``(denial, approved_credits)`` for an OkVevo-credit Fal spend.

    ``approved_credits`` is the quoted number the user approved; send it as the
    submit's ``approved_credits`` so the portal never reserves more (rate-card
    endpoints such as ``openai/gpt-image-2`` require it). Under approval bypass
    nothing is shown, but the read-only quote still runs so the submit carries
    it. None when the quote failed (the submit then goes without it).
    """
    from tools.approval import is_approval_bypass_active, request_tool_approval

    credits, _reason = okvevo_fal_quote(endpoint, args)
    if is_approval_bypass_active():
        return None, credits
    what = "image" if tool_name == "image_generate" else "video"
    if okvevo_is_internal_channel():
        cost_text = (
            f"estimated ≈ {credits} OkVevo credits" if credits is not None
            else "credit quote unavailable"
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
            description = (
                f"Generate {article} {what} — charged to your "
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
        return None, credits
    return verdict.get("message") or f"BLOCKED: {tool_name} was denied.", None


def ensure_okvevo_fal_run_id(arguments: dict) -> dict:
    """Attach one run_id per tool call. Reuse it on retries.

    The portal requires ``run_id`` on every metered submit (HTTP 400
    otherwise) and keys its reserve/settle idempotency on it. The image
    tool and drama-skill jobs send approved_credits (the quote the user
    confirmed); the video tool does not yet, so the portal reserves the
    server-computed price there.
    """
    out = dict(arguments)
    existing = out.get("run_id")
    if isinstance(existing, str) and existing.strip():
        out["run_id"] = existing.strip()
        return out
    out["run_id"] = str(uuid.uuid4())
    return out


def okvevo_fal_available() -> bool:
    """Signed-in OkVevo Fal path (public always; internal only without FAL_KEY)."""
    if not okvevo_signed_in():
        return False
    if okvevo_is_internal_channel():
        from tools.tool_backend_helpers import fal_key_is_configured

        if fal_key_is_configured():
            return False
    return True


def okvevo_tavily_available() -> bool:
    """Signed-in OkVevo web-search path (public always; internal only without TAVILY_API_KEY)."""
    if not okvevo_signed_in():
        return False
    if okvevo_is_internal_channel():
        from agent.web_search_provider import get_provider_env

        if (get_provider_env("TAVILY_API_KEY") or "").strip():
            return False
    return True


def resolve_okvevo_fal_gateway():
    """Queue origin + Firebase ID token, or None when signed out / unavailable.

    Consumed by the short-drama skill's provider adapters; the in-agent image
    and video providers build their own client in ``plugins/okvevo/media.py``.
    """
    if not okvevo_fal_available():
        return None
    token = ensure_okvevo_id_token()
    if not token:
        return None
    from types import SimpleNamespace

    return SimpleNamespace(
        vendor="okvevo-fal",
        gateway_origin=f"{okvevo_gateway_base_url()}/fal/queue",
        nous_user_token=token,
        managed_mode=True,
    )
