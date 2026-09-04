"""OkVevo gateway wire rewrite: OpenRouter host + live ID token only."""

from __future__ import annotations

import pytest

from agent.okvevo_gateway import (
    OKVEVO_ORIGIN_MISSING,
    OkvevoGatewayConfigError,
    apply_okvevo_gateway,
    okvevo_gateway_base_url,
)


def test_no_file_leaves_kwargs(monkeypatch, tmp_path):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    monkeypatch.delenv("OKVEVO_WEB_ORIGIN", raising=False)
    kw = {"base_url": "https://openrouter.ai/api/v1", "api_key": "sk-user"}
    apply_okvevo_gateway(kw)
    assert kw["base_url"] == "https://openrouter.ai/api/v1"
    assert kw["api_key"] == "sk-user"


def test_empty_file_is_byok(monkeypatch, tmp_path):
    p = tmp_path / "tok"
    p.write_text("  \n", encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    kw = {"base_url": "https://openrouter.ai/api/v1", "api_key": "sk-user"}
    apply_okvevo_gateway(kw)
    assert kw["api_key"] == "sk-user"
    assert "openrouter.ai" in kw["base_url"]


def test_non_openrouter_host_untouched(monkeypatch, tmp_path):
    p = tmp_path / "tok"
    p.write_text("idt", encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    kw = {"base_url": "https://api.anthropic.com", "api_key": "sk-ant"}
    apply_okvevo_gateway(kw)
    assert kw["base_url"] == "https://api.anthropic.com"
    assert kw["api_key"] == "sk-ant"


def test_openrouter_rewrites_to_gateway(monkeypatch, tmp_path):
    p = tmp_path / "tok"
    p.write_text("idt-live", encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "http://localhost:3000")
    kw = {"base_url": "https://openrouter.ai/api/v1", "api_key": "sk-user"}
    apply_okvevo_gateway(kw)
    assert kw["base_url"] == "http://localhost:3000/api/gateway"
    assert kw["api_key"] == "idt-live"


def test_token_without_origin_is_fail_closed(monkeypatch, tmp_path):
    p = tmp_path / "tok"
    p.write_text("idt", encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    monkeypatch.delenv("OKVEVO_WEB_ORIGIN", raising=False)
    kw = {"base_url": "https://openrouter.ai/api/v1", "api_key": "x"}
    with pytest.raises(OkvevoGatewayConfigError, match=OKVEVO_ORIGIN_MISSING):
        apply_okvevo_gateway(kw)
    with pytest.raises(OkvevoGatewayConfigError) as excinfo:
        okvevo_gateway_base_url()
    assert str(excinfo.value) == OKVEVO_ORIGIN_MISSING


def test_config_error_message_is_the_chat_string():
    assert str(OkvevoGatewayConfigError(OKVEVO_ORIGIN_MISSING)) == OKVEVO_ORIGIN_MISSING
    assert "traceback" not in OKVEVO_ORIGIN_MISSING.lower()
    assert "www.okvevo.com" not in OKVEVO_ORIGIN_MISSING


def test_token_is_reread_every_call(monkeypatch, tmp_path):
    p = tmp_path / "tok"
    p.write_text("first", encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "http://localhost:3000")
    kw1 = {"base_url": "https://openrouter.ai/api/v1", "api_key": "sk"}
    apply_okvevo_gateway(kw1)
    assert kw1["api_key"] == "first"
    p.write_text("second", encoding="utf-8")
    kw2 = {"base_url": "https://openrouter.ai/api/v1", "api_key": "sk"}
    apply_okvevo_gateway(kw2)
    assert kw2["api_key"] == "second"


def test_evil_openrouter_substring_is_not_rewritten(monkeypatch, tmp_path):
    p = tmp_path / "tok"
    p.write_text("idt", encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    kw = {"base_url": "https://evil.com/openrouter.ai/v1", "api_key": "sk"}
    apply_okvevo_gateway(kw)
    assert kw["base_url"] == "https://evil.com/openrouter.ai/v1"
    assert kw["api_key"] == "sk"
