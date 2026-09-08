"""OkVevo Tavily routing: signed-in rewrite vs leftover key / internal BYOK / keyless."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from agent.okvevo_gateway import okvevo_tavily_available


def _sign_in(monkeypatch, tmp_path, token="idt"):
    p = tmp_path / "tok"
    p.write_text(token, encoding="utf-8")
    monkeypatch.setenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", str(p))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", "http://localhost:3000")


def _ok_response(payload=None):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = payload if payload is not None else {"results": []}
    mock_response.text = "{}"
    return mock_response


def test_signed_in_no_key_uses_okvevo(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    mock = _ok_response({"results": [{"title": "A", "url": "https://a.com", "content": "x"}]})
    with patch("plugins.web.tavily.provider.httpx.post", return_value=mock) as post:
        from plugins.web.tavily.provider import _tavily_request

        _tavily_request("search", {"query": "q"})
    assert post.call_args.args[0] == "http://localhost:3000/api/gateway/tavily/search"
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer idt"
    assert "X-Tavily-Access-Mode" not in post.call_args.kwargs["headers"]


def test_public_signed_in_ignores_leftover_tavily_key(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-leftover")
    assert okvevo_tavily_available() is True
    mock = _ok_response()
    with patch("plugins.web.tavily.provider.httpx.post", return_value=mock) as post:
        from plugins.web.tavily.provider import _tavily_request

        _tavily_request("extract", {"urls": ["https://a.com"]})
    assert "/api/gateway/tavily/extract" in post.call_args.args[0]
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer idt"
    assert post.call_args.kwargs["headers"].get("Authorization") != "Bearer tvly-leftover"


def test_signed_out_with_key_is_direct(monkeypatch):
    monkeypatch.delenv("OKVEVO_FIREBASE_ID_TOKEN_FILE", raising=False)
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-direct")
    mock = _ok_response()
    with patch("plugins.web.tavily.provider.httpx.post", return_value=mock) as post:
        from plugins.web.tavily.provider import _tavily_request

        _tavily_request("search", {"query": "q"})
    assert "api.tavily.com/search" in post.call_args.args[0]
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer tvly-direct"


def test_internal_signed_in_with_key_is_byok(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "internal")
    with patch("agent.web_search_provider.get_provider_env", return_value="tvly-byok"):
        assert okvevo_tavily_available() is False
    mock = _ok_response()
    with patch(
        "agent.web_search_provider.get_provider_env",
        side_effect=lambda k: {
            "TAVILY_API_KEY": "tvly-byok",
            "TAVILY_BASE_URL": "",
        }.get(k, ""),
    ), patch("plugins.web.tavily.provider.httpx.post", return_value=mock) as post:
        from plugins.web.tavily.provider import _tavily_request

        _tavily_request("search", {"query": "q"})
    assert "api.tavily.com/search" in post.call_args.args[0]
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer tvly-byok"


def test_search_skips_keyless_when_okvevo(monkeypatch, tmp_path):
    _sign_in(monkeypatch, tmp_path)
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    mock = _ok_response({"results": []})
    with patch("plugins.web.tavily.provider.httpx.post", return_value=mock) as post, patch(
        "plugins.web.keyless_mcp.search_with_failover"
    ) as failover:
        from plugins.web.tavily.provider import TavilyWebSearchProvider

        TavilyWebSearchProvider().search("q")
    failover.assert_not_called()
    assert "/api/gateway/tavily/search" in post.call_args.args[0]
