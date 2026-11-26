"""Billable portal calls send the selected org. One header source, four accounts."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from plugins.okvevo.auto_router import install_auto_wire_swap
from plugins.okvevo.errors import map_public_error
from plugins.okvevo.gateway import apply_okvevo_org_header, okvevo_org_headers, okvevo_portal_headers

# The desktop does not branch per account. Each named case is a selected org id,
# and every billable call must send that id.
CASES = {
    "promoted_child_owner": "org_child_promoted",
    "independent_creator": "org_independent_creator",
    "code_join_member": "org_code_join_member",
    "promoted_independent_owner": "org_promoted_owner",
    "platform_admin_member": "org_admin_member",
}

ORIGIN = "https://portal.example"


def _select(monkeypatch, tmp_path: Path, org: str) -> None:
    path = tmp_path / "okvevo-org"
    path.write_text(org, encoding="utf-8")
    monkeypatch.setenv("OKVEVO_ORG_FILE", str(path))
    monkeypatch.setenv("OKVEVO_WEB_ORIGIN", ORIGIN)
    monkeypatch.delenv("OKVEVO_BUILD_CHANNEL", raising=False)


@pytest.mark.parametrize("case", list(CASES))
def test_billable_calls_send_the_selected_org(monkeypatch, tmp_path, case):
    org = CASES[case]
    _select(monkeypatch, tmp_path, org)

    chat = httpx.Request("POST", f"{ORIGIN}/api/gateway/chat/completions")
    apply_okvevo_org_header(chat)
    assert chat.headers["X-OkVevo-Org"] == org
    other = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    apply_okvevo_org_header(other)
    assert "X-OkVevo-Org" not in other.headers

    captured = {}

    def _post(url, json, timeout, headers):
        captured["search"] = headers
        class _Response:
            status_code = 200
            text = "{}"
            def json(self):
                return {}
        return _Response()

    monkeypatch.setattr("plugins.okvevo.web.httpx.post", _post)
    from plugins.okvevo.web import _post_gateway

    _post_gateway("search", {"query": "hi"}, "token")
    assert captured["search"]["X-OkVevo-Org"] == org
    assert captured["search"]["Authorization"] == "Bearer token"

    from plugins.okvevo import media

    class _Client:
        def submit(self, endpoint, arguments, headers):
            captured["image"] = headers
            return {"request_id": "r"}

    monkeypatch.setattr(media, "_okvevo_fal_client", lambda: _Client())
    monkeypatch.setattr(
        "tools.fal_common.submit_managed_fal_with_rate_limit_retry",
        lambda submit, **_kw: submit({"x-idempotency-key": "k"}),
    )
    media._submit_okvevo_fal_once("openai/gpt-image-2", {"prompt": "hi"}, what="image")
    assert captured["image"]["X-OkVevo-Org"] == org


def test_async_auxiliary_call_sends_the_selected_org(monkeypatch, tmp_path):
    """Titles, compression, vision, and summaries rebuild an async client."""
    import asyncio

    from agent.auxiliary_client import _to_async_client

    class _Sync:
        def __init__(self, base_url: str) -> None:
            self.base_url = base_url
            self.api_key = "token"

    async def _stamp(client, url: str) -> httpx.Request:
        request = httpx.Request("POST", url)
        hook = client._client.event_hooks["request"][0]
        await hook(request)
        await client.close()
        return request

    _select(monkeypatch, tmp_path, CASES["promoted_child_owner"])
    selected, _model = _to_async_client(_Sync(f"{ORIGIN}/api/gateway"), "openrouter/auto")
    stamped = asyncio.run(_stamp(selected, f"{ORIGIN}/api/gateway/chat/completions"))
    assert stamped.headers["X-OkVevo-Org"] == CASES["promoted_child_owner"]

    _select(monkeypatch, tmp_path, "")
    personal, _model = _to_async_client(_Sync(f"{ORIGIN}/api/gateway"), "openrouter/auto")
    bare = asyncio.run(_stamp(personal, f"{ORIGIN}/api/gateway/chat/completions"))
    assert "X-OkVevo-Org" not in bare.headers


def test_empty_org_file_sends_no_header(monkeypatch, tmp_path):
    _select(monkeypatch, tmp_path, "")
    assert okvevo_org_headers() == {}
    assert "X-OkVevo-Org" not in okvevo_portal_headers("token")
    chat = httpx.Request("POST", f"{ORIGIN}/api/gateway/chat/completions")
    apply_okvevo_org_header(chat)
    assert "X-OkVevo-Org" not in chat.headers


def test_header_follows_the_file(monkeypatch, tmp_path):
    _select(monkeypatch, tmp_path, CASES["independent_creator"])
    assert okvevo_org_headers()["X-OkVevo-Org"] == CASES["independent_creator"]
    path = Path(tmp_path / "okvevo-org")
    path.write_text(CASES["platform_admin_member"], encoding="utf-8")
    assert okvevo_org_headers()["X-OkVevo-Org"] == CASES["platform_admin_member"]


def test_auto_alias_sends_requested_model():
    from agent.transports.chat_completions import ChatCompletionsTransport

    install_auto_wire_swap()
    transport = ChatCompletionsTransport()
    for alias in ("okvevo/auto-cost", "okvevo/auto-intelligence"):
        kwargs = transport.build_kwargs(
            model=alias,
            messages=[{"role": "user", "content": "ping"}],
            request_overrides={"model": alias},
        )
        assert kwargs["extra_headers"]["X-OkVevo-Requested-Model"] == alias
    specific = transport.build_kwargs(
        model="openai/gpt-4o-mini",
        messages=[{"role": "user", "content": "ping"}],
        request_overrides={"model": "openai/gpt-4o-mini"},
    )
    assert "X-OkVevo-Requested-Model" not in (specific.get("extra_headers") or {})


def test_org_access_denied_copy(monkeypatch, tmp_path):
    _select(monkeypatch, tmp_path, CASES["platform_admin_member"])
    text = map_public_error("org_access_denied", status=403, error_type="org_access_denied")
    assert text == (
        "You no longer have access to org_admin_member. "
        "Pick another account in Settings › Billing."
    )
    assert map_public_error(text, status=403) == text
