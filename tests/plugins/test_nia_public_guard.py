"""Tests for plugins/nia-public-guard — L1 block policy, L2 redaction, L3 scrub."""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest
import yaml


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_plugin():
    plugin_dir = _repo_root() / "plugins" / "nia-public-guard"
    if "hermes_plugins" not in sys.modules:
        ns = types.ModuleType("hermes_plugins")
        ns.__path__ = []
        sys.modules["hermes_plugins"] = ns
    spec = importlib.util.spec_from_file_location(
        "hermes_plugins.nia_public_guard",
        plugin_dir / "__init__.py",
        submodule_search_locations=[str(plugin_dir)],
    )
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "hermes_plugins.nia_public_guard"
    mod.__path__ = [str(plugin_dir)]
    sys.modules["hermes_plugins.nia_public_guard"] = mod
    spec.loader.exec_module(mod)
    return mod


CANARIES = ("hermes", "openrouter", ".env", "config.yaml", "api key", "~/.hermes", "minimax")

NITISH_EXCERPT = (
    "Created ~/.hermes/profiles/nitish with openrouter and minimax/minimax-m3. "
    "No API key found for provider 'openrouter'. Wrote .env and config.yaml."
)

ADHARSH_EXCERPT = (
    "Ran `hermes profile create adharsh` then cat ~/.hermes/profiles/adharsh/.env. "
    "Configure API keys for OpenRouter / Bedrock."
)


@pytest.fixture()
def public_env(tmp_path, monkeypatch):
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    monkeypatch.setenv("NIA_BUILD_CHANNEL", "public")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return hermes_home


@pytest.fixture()
def plugin(public_env):
    return _load_plugin()


class TestPreToolCallPolicy:
    @pytest.mark.parametrize(
        "tool_name,args",
        [
            ("terminal", {"command": "ls ~/.hermes/profiles"}),
            ("terminal", {"command": "hermes profile list"}),
            ("terminal", {"command": "hermes -p coder chat"}),
            ("read_file", {"path": "~/.hermes/profiles/nitish/SOUL.md"}),
            ("write_file", {"path": "~/.hermes/.env", "content": "x"}),
            ("patch", {"path": "~/.hermes/config.yaml", "old_string": "a", "new_string": "b"}),
            ("search_files", {"path": "~/.hermes", "pattern": "openrouter"}),
            ("execute_code", {"code": "open('/Users/me/.hermes/auth.json').read()"}),
        ],
    )
    def test_blocks_internals(self, plugin, tool_name, args):
        out = plugin._on_pre_tool_call(tool_name=tool_name, args=args)
        assert out is not None
        assert out["action"] == "block"
        assert out["message"] == plugin._BLOCK_MESSAGE
        lowered = out["message"].lower()
        for term in CANARIES:
            assert term not in lowered

    @pytest.mark.parametrize(
        "tool_name,args",
        [
            ("terminal", {"command": "ls ~/Documents"}),
            ("read_file", {"path": "~/Documents/budget.csv"}),
            ("write_file", {"path": "src/app.ts", "content": "export const n = 1"}),
            ("search_files", {"path": ".", "pattern": "TODO"}),
            ("execute_code", {"code": "print(2+2)"}),
            ("web_search", {"query": "~/.hermes should not matter"}),
        ],
    )
    def test_allows_user_workspace(self, plugin, tool_name, args):
        assert plugin._on_pre_tool_call(tool_name=tool_name, args=args) is None

    def test_noop_on_internal_channel(self, plugin, monkeypatch):
        monkeypatch.setenv("NIA_BUILD_CHANNEL", "internal")
        out = plugin._on_pre_tool_call(
            tool_name="terminal", args={"command": "ls ~/.hermes/profiles"}
        )
        assert out is None


class TestBoundaryRedaction:
    def test_collapses_home_and_redacts_secrets(self, plugin, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        secret = "sk-ant-api03-" + ("a" * 40)
        raw = f"home={tmp_path} token={secret}"
        out = plugin._on_transform_tool_result(tool_name="terminal", result=raw)
        assert out is not None
        assert str(tmp_path) not in out
        assert secret not in out
        assert "redacted" in out.lower()


class TestOutputRail:
    def test_transcript_excerpts_drop_canaries(self, plugin):
        from agent.brand_scrub import sanitize_user_facing_brand

        for excerpt in (NITISH_EXCERPT, ADHARSH_EXCERPT):
            scrubbed = plugin._on_transform_llm_output(response_text=excerpt)
            assert scrubbed is not None
            lowered = scrubbed.lower()
            for term in CANARIES:
                assert term not in lowered, (term, scrubbed)
            # Same function the hook uses.
            assert sanitize_user_facing_brand(excerpt).lower() == lowered


class TestPluginDiscovery:
    def test_loads_via_plugin_manager(self, public_env, monkeypatch):
        (public_env / "config.yaml").write_text(yaml.safe_dump({"plugins": {"enabled": []}}))
        for key in list(sys.modules):
            if key.startswith(("hermes_plugins", "hermes_cli.plugins")):
                del sys.modules[key]

        from hermes_cli.plugins import _ensure_plugins_discovered

        mgr = _ensure_plugins_discovered(force=True)
        loaded = set(mgr._plugins.keys()) if hasattr(mgr, "_plugins") else set()
        assert "nia-public-guard" in loaded
        plugin = mgr._plugins["nia-public-guard"]
        assert plugin.enabled
