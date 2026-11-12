"""Portal errors are classified by HTTP status + ``error.code``, never the message text."""

from __future__ import annotations

import pytest

from plugins.okvevo.errors import (
    AUTH_COPY,
    CREDITS_COPY,
    VENDOR_REJECTED_COPY,
    VENDOR_UNAVAILABLE_COPY,
    map_public_error,
    portal_status_and_code,
)


class _Response:
    def __init__(self, status: int, body):
        self.status_code = status
        self._body = body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _PortalError(Exception):
    def __init__(self, status: int, body, text: str = ""):
        super().__init__(text)
        self.response = _Response(status, body)
        self.status_code = status


def _vendor_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "vendor": "fal", "vendor_status": 403,
                      "credits_returned": True, "message": message}}


@pytest.fixture(autouse=True)
def _public_build(monkeypatch):
    monkeypatch.delenv("OKVEVO_BUILD_CHANNEL", raising=False)


def test_vendor_rejected_ignores_http_digits_in_message():
    # 2026-10-30 14:26: "HTTP 403" in the message used to read as sign-in.
    msg = "Fal rejected this job (HTTP 403). Your credits were returned."
    assert map_public_error(msg, status=502, error_type="vendor_rejected") == VENDOR_REJECTED_COPY


@pytest.mark.parametrize("message", [
    "The image service is temporarily unavailable. Your credits were returned.",
    "Fal account locked (HTTP 403) — reworded later",
])
def test_vendor_unavailable_survives_message_changes(message):
    assert map_public_error(message, status=502, error_type="vendor_unavailable") == VENDOR_UNAVAILABLE_COPY


def test_other_portal_codes():
    assert map_public_error("whatever", status=401, error_type="invalid_token") == AUTH_COPY
    assert map_public_error("whatever", status=402, error_type="insufficient_quota") == CREDITS_COPY
    assert map_public_error("", status=502, error_type="vendor_rejected") == VENDOR_REJECTED_COPY


def test_status_and_code_from_response():
    exc = _PortalError(502, _vendor_body("vendor_unavailable", "x"))
    assert portal_status_and_code(exc) == (502, "vendor_unavailable")
    assert portal_status_and_code(_PortalError(502, ValueError("not json"))) == (502, None)
    assert portal_status_and_code(RuntimeError("no response")) == (None, None)


def test_image_submit_502_vendor_rejected_is_not_sign_in(monkeypatch):
    from plugins.okvevo import media

    calls = {"n": 0}
    body = _vendor_body("vendor_rejected", "Fal rejected this job (HTTP 403). Your credits were returned.")

    def fake_client():
        class Client:
            def submit(self, endpoint, arguments, headers=None):
                calls["n"] += 1
                raise _PortalError(502, body, text=body["error"]["message"])

        return Client()

    monkeypatch.setattr(media, "_okvevo_fal_client", fake_client)
    monkeypatch.setattr("plugins.okvevo.gateway.ensure_okvevo_id_token", lambda **_k: "token")

    with pytest.raises(ValueError) as raised:
        media._submit_okvevo_fal("fal-ai/flux-2/klein/9b", {"prompt": "flyer"}, what="image model")
    assert str(raised.value) == VENDOR_REJECTED_COPY
    assert calls["n"] == 1, "a vendor refusal must not trigger the sign-in refresh retry"


def test_chat_429_reset_at_says_busy_until_local_time():
    from datetime import datetime

    from plugins.okvevo import _classify_okvevo_api_error
    from plugins.okvevo.errors import busy_until_copy

    reset_at = 1793380000  # epoch seconds, as /api/gateway/chat/completions sends
    expected = f"Busy, retrying at {datetime.fromtimestamp(reset_at).strftime('%H:%M')}"
    body = {"error": {"code": "plan_concurrency_limit", "type": "rate_limit_error",
                      "message": "Too many requests are running for this plan.", "reset_at": reset_at}}

    got = _classify_okvevo_api_error(provider="okvevo", status_code=429, error_body=body)
    assert got == {"reason": "rate_limit", "message": expected, "should_rotate_credential": True,
                   "should_fallback": True, "error_context": {"reset_at": reset_at}}
    assert busy_until_copy(reset_at * 1000) == expected
    assert busy_until_copy("2026-10-30T18:00:00Z") is not None
    assert busy_until_copy(None) is None and busy_until_copy("soon") is None and busy_until_copy(True) is None
    assert _classify_okvevo_api_error(provider="okvevo", status_code=429, error_body={"error": {}}) is None
    assert _classify_okvevo_api_error(provider="openrouter", status_code=429, error_body=body) is None
    assert map_public_error(expected, status=429) == expected, "the display pass keeps the time"


def test_poll_failure_uses_code(monkeypatch):
    from plugins.okvevo import media

    exc = _PortalError(502, _vendor_body("vendor_unavailable", "anything"), text="HTTP 403 anything")
    assert media._public_failure(exc) == VENDOR_UNAVAILABLE_COPY
