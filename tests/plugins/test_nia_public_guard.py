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


class TestJevShadowHook:
    def test_off_by_default_does_not_schedule(self, plugin, monkeypatch):
        monkeypatch.delenv("NIA_JEV_LEAK_CLASSIFY", raising=False)
        scheduled = []
        monkeypatch.setattr(
            plugin, "_shadow_classify", lambda *a, **k: scheduled.append(1)
        )
        assert plugin._on_post_llm_call(assistant_response="I set up Nidhi's bot") is None
        assert scheduled == []

    def test_env_zero_does_not_schedule(self, plugin, monkeypatch):
        monkeypatch.setenv("NIA_JEV_LEAK_CLASSIFY", "0")
        monkeypatch.setattr("tools.openrouter_client.check_api_key", lambda: True)
        scheduled = []
        monkeypatch.setattr(
            plugin, "_shadow_classify", lambda *a, **k: scheduled.append(1)
        )
        assert plugin._on_post_llm_call(assistant_response="I set up Nidhi's bot") is None
        assert scheduled == []

    def test_internal_channel_does_not_schedule(self, plugin, monkeypatch):
        monkeypatch.setenv("NIA_BUILD_CHANNEL", "internal")
        monkeypatch.setenv("NIA_JEV_LEAK_CLASSIFY", "1")
        monkeypatch.setattr("tools.openrouter_client.check_api_key", lambda: True)
        scheduled = []
        monkeypatch.setattr(
            plugin, "_shadow_classify", lambda *a, **k: scheduled.append(1)
        )
        assert plugin._on_post_llm_call(assistant_response="I set up Nidhi's bot") is None
        assert scheduled == []

    def test_no_key_does_not_schedule(self, plugin, monkeypatch):
        monkeypatch.setenv("NIA_JEV_LEAK_CLASSIFY", "1")
        monkeypatch.setattr("tools.openrouter_client.check_api_key", lambda: False)
        scheduled = []
        monkeypatch.setattr(
            plugin, "_shadow_classify", lambda *a, **k: scheduled.append(1)
        )
        assert plugin._on_post_llm_call(assistant_response="I set up Nidhi's bot") is None
        assert scheduled == []

    def test_schedules_post_scrub_when_enabled(self, plugin, monkeypatch):
        import threading

        done = threading.Event()
        seen = []

        def _capture(text, regex_rewrote):
            seen.append((text, regex_rewrote))
            done.set()

        monkeypatch.setenv("NIA_JEV_LEAK_CLASSIFY", "1")
        monkeypatch.setattr("tools.openrouter_client.check_api_key", lambda: True)
        monkeypatch.setattr(plugin, "_shadow_classify", _capture)
        scrubbed = plugin._on_transform_llm_output(response_text=NITISH_EXCERPT)
        assert plugin._on_post_llm_call(assistant_response=scrubbed) is None
        assert done.wait(1.0)
        assert seen == [(scrubbed, True)]

    def test_returns_immediately_on_forced_timeout(self, plugin, monkeypatch):
        import time

        from agent.brand_scrub import sanitize_user_facing_brand

        monkeypatch.setenv("NIA_JEV_LEAK_CLASSIFY", "1")
        monkeypatch.setattr("tools.openrouter_client.check_api_key", lambda: True)

        def _hang(*_a, **_k):
            time.sleep(2.0)

        monkeypatch.setattr(plugin, "_shadow_classify", _hang)
        expected = sanitize_user_facing_brand(NITISH_EXCERPT)
        got = plugin._on_transform_llm_output(response_text=NITISH_EXCERPT)
        assert got == expected
        t0 = time.perf_counter()
        assert plugin._on_post_llm_call(assistant_response=got) is None
        assert (time.perf_counter() - t0) < 0.25

    def test_post_llm_does_not_call_sanitize(self, plugin, monkeypatch):
        monkeypatch.setenv("NIA_JEV_LEAK_CLASSIFY", "1")
        monkeypatch.setattr("tools.openrouter_client.check_api_key", lambda: True)
        monkeypatch.setattr(plugin, "_shadow_classify", lambda *a, **k: None)
        import agent.brand_scrub as brand_scrub

        calls = {"n": 0}
        real = brand_scrub.sanitize_user_facing_brand

        def _spy(text):
            calls["n"] += 1
            return real(text)

        monkeypatch.setattr(brand_scrub, "sanitize_user_facing_brand", _spy)
        assert plugin._on_post_llm_call(assistant_response="I set up Nidhi's bot") is None
        assert calls["n"] == 0

    def test_transform_still_scrubs_when_jev_on(self, plugin, monkeypatch):
        from agent.brand_scrub import sanitize_user_facing_brand

        monkeypatch.setenv("NIA_JEV_LEAK_CLASSIFY", "1")
        monkeypatch.setattr("tools.openrouter_client.check_api_key", lambda: True)
        monkeypatch.setattr(plugin, "_shadow_classify", lambda *a, **k: None)
        got = plugin._on_transform_llm_output(response_text=NITISH_EXCERPT)
        assert got == sanitize_user_facing_brand(NITISH_EXCERPT)


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
