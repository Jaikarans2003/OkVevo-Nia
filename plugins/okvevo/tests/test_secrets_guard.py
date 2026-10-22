"""Credential-file guard: block .env / auth.json / OkVevo tokens, allow the rest of ~/.hermes."""
from plugins.okvevo.secrets_guard import on_pre_tool_call


def test_blocks_env_file_read():
    got = on_pre_tool_call("read_file", {"path": "/Users/x/.hermes/.env"})
    assert got and got["action"] == "block"


def test_blocks_auth_json_write():
    got = on_pre_tool_call("write_file", {"path": "~/.hermes/auth.json", "content": "{}"})
    assert got and got["action"] == "block"


def test_blocks_token_via_terminal():
    got = on_pre_tool_call("terminal", {"command": "cat ~/.hermes/okvevo-firebase-id-token"})
    assert got and got["action"] == "block"


def test_blocks_token_env_ref():
    got = on_pre_tool_call("terminal", {"command": "cat $OKVEVO_FIREBASE_ID_TOKEN_FILE"})
    assert got and got["action"] == "block"


def test_allows_soul_and_profile():
    assert on_pre_tool_call("read_file", {"path": "~/.hermes/SOUL.md"}) is None
    assert on_pre_tool_call("write_file", {"path": "~/.hermes/profiles/work/SOUL.md", "content": "x"}) is None
    assert on_pre_tool_call("terminal", {"command": "ls ~/.hermes/profiles"}) is None


def test_allows_unrelated_tools():
    assert on_pre_tool_call("web_search", {"query": "auth.json leak"}) is None
