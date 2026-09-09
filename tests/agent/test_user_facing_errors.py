"""Public-build error mapper: category copy, default-deny, internal passthrough."""

from __future__ import annotations

import pytest

from agent import user_facing_errors as ufe


@pytest.fixture
def public(monkeypatch):
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    yield


@pytest.fixture
def internal(monkeypatch):
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "internal")
    yield


def test_credits_category(public):
    assert ufe.public_error_message("HTTP 402: Insufficient credits.") == ufe.CREDITS_COPY
    assert ufe.public_error_message("payment required by provider") == ufe.CREDITS_COPY
    assert (
        ufe.public_error_message("x", error_type="billing") == ufe.CREDITS_COPY
    )


def test_rate_limit_category(public):
    assert ufe.public_error_message("HTTP 429 too many requests") == ufe.RATE_LIMIT_COPY
    assert ufe.public_error_message("Rate limit exceeded") == ufe.RATE_LIMIT_COPY


def test_server_category(public):
    assert ufe.public_error_message("HTTP 503: service unavailable") == ufe.SERVER_COPY
    assert ufe.public_error_message("upstream exploded", status=502) == ufe.SERVER_COPY


def test_auth_category(public):
    assert ufe.public_error_message("HTTP 401 unauthorized") == ufe.AUTH_COPY
    assert ufe.public_error_message("x", error_type="auth_required") == ufe.AUTH_COPY


def test_network_category(public):
    assert (
        ufe.public_error_message("Connection error. getaddrinfo failed")
        == ufe.NETWORK_COPY
    )
    assert ufe.public_error_message("read timeout") == ufe.NETWORK_COPY


def test_content_blocked_category(public):
    assert (
        ufe.public_error_message("rejected by the content filter")
        == ufe.CONTENT_BLOCKED_COPY
    )


def test_unreadable_file_category(public):
    assert (
        ufe.public_error_message("x", error_type="unreadable_file")
        == ufe.UNREADABLE_FILE_COPY
    )


def test_unknown_is_generic_fallback(public):
    assert (
        ufe.public_error_message("weird vendor-specific failure xyz")
        == ufe.FALLBACK_COPY
    )


def test_internal_channel_passthrough(internal):
    raw = "HTTP 402: Insufficient credits. Nous Research portal."
    assert ufe.public_error_message(raw) == raw
    assert ufe.map_public_error(raw) is None


def test_map_public_error_no_opinion_on_unknown(public):
    assert ufe.map_public_error("some ordinary tool error") is None
    assert ufe.map_public_error("HTTP 429") == ufe.RATE_LIMIT_COPY


def test_mapping_is_idempotent(public):
    for copy in [
        ufe.CREDITS_COPY,
        ufe.RATE_LIMIT_COPY,
        ufe.SERVER_COPY,
        ufe.AUTH_COPY,
        ufe.NETWORK_COPY,
        ufe.CONTENT_BLOCKED_COPY,
        ufe.UNREADABLE_FILE_COPY,
        ufe.FALLBACK_COPY,
    ]:
        assert ufe.public_error_message(copy) == copy


def test_status_arg_wins_over_text(public):
    assert ufe.public_error_message("no codes here", status=402) == ufe.CREDITS_COPY
