"""Public builds refuse agent changes to OkVevo-managed settings; internal builds allow them."""
from __future__ import annotations

import os

import hermes_yaml as yaml
import pytest

from plugins.okvevo import managed_settings_guard as guard
from plugins.okvevo.managed_settings_guard import MANAGED_MESSAGE, on_pre_tool_call


@pytest.fixture(autouse=True)
def _public_home(monkeypatch, tmp_path):
    monkeypatch.delenv("OKVEVO_BUILD_CHANNEL", raising=False)
    home = tmp_path / ".hermes"
    (home / "profiles" / "cfo").mkdir(parents=True)
    managed = {"model": {"provider": "okvevo", "default": "okvevo/auto-cost"},
               "image_gen": {"provider": "okvevo", "model": "fal-ai/flux-2/klein/9b"}}
    for config in (home / "config.yaml", home / "profiles" / "cfo" / "config.yaml"):
        config.write_text(yaml.safe_dump(managed), encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(home))
    import hermes_constants
    monkeypatch.setattr(hermes_constants, "_default_hermes_root_memo", None, raising=False)
    monkeypatch.setattr(hermes_constants, "get_default_hermes_root", lambda **_k: home)
    monkeypatch.setattr("plugins.okvevo.gateway.okvevo_fal_quote", lambda endpoint, args: (40, None))
    return home


def _blocked(tool: str, args: dict) -> bool:
    got = on_pre_tool_call(tool, args)
    return bool(got) and got["action"] == "block" and got["message"] == MANAGED_MESSAGE


@pytest.mark.parametrize("command", [
    "hermes config set model.provider anthropic",
    "hermes config unset auxiliary.vision.provider",
    "hermes config set image_gen.provider fal",
    "hermes config set video_gen.provider fal",
    "hermes config set web.search_backend tavily",
    "hermes config set telemetry.shared_metrics.send true",
    "hermes config set plugins.enabled '[]'",
    "hermes -p cfo config set model.provider openai",
    "cd /tmp && hermes config set model '{provider: x}'",
    "hermes auth add openrouter",
    "hermes model --provider openrouter",
    "hermes model --provider=anthropic --model claude",
    "hermes plugins disable okvevo",
    "/opt/venv/bin/python -m hermes_cli.main config set model.provider x",
])
def test_terminal_commands_are_refused(command):
    assert _blocked("terminal", {"command": command})


def test_execute_code_subprocess_is_refused():
    code = 'import subprocess\nsubprocess.run(["hermes", "config", "set", "model.provider", "x"])\n'
    assert _blocked("execute_code", {"code": code})


def test_config_yaml_write_of_managed_key_is_refused(_public_home):
    for config in (_public_home / "config.yaml", _public_home / "profiles" / "cfo" / "config.yaml"):
        text = config.read_text(encoding="utf-8").replace("provider: okvevo", "provider: anthropic", 1)
        assert _blocked("write_file", {"path": str(config), "content": text})
        assert _blocked("patch", {"path": str(config), "old_string": "provider: okvevo",
                                  "new_string": "provider: anthropic"})
    v4a = f"*** Begin Patch\n*** Update File: {_public_home / 'config.yaml'}\n-a\n+b\n*** End Patch"
    assert _blocked("patch", {"mode": "patch", "patch": v4a})


def test_reads_mentions_and_image_model_pass(_public_home):
    assert on_pre_tool_call("terminal", {"command": "ls ~/.hermes"}) is None
    assert on_pre_tool_call("terminal", {"command": "cat ~/.hermes/SOUL.md"}) is None
    assert on_pre_tool_call("terminal", {"command": "echo 'run hermes config set model.provider x'"}) is None
    assert on_pre_tool_call("terminal", {"command": "hermes model --provider okvevo"}) is None
    assert on_pre_tool_call("terminal", {"command": "hermes config set image_gen.model fal-ai/flux-2/klein/9b"}) is None
    assert on_pre_tool_call("write_file", {"path": str(_public_home / "SOUL.md"), "content": "x"}) is None
    config = _public_home / "config.yaml"
    switched = config.read_text(encoding="utf-8").replace("klein/9b", "schnell")
    assert on_pre_tool_call("write_file", {"path": str(config), "content": switched}) is None


def test_unpriced_image_model_is_refused_with_the_portal_reason(monkeypatch):
    monkeypatch.setattr(
        "plugins.okvevo.gateway.okvevo_fal_quote",
        lambda endpoint, args: (None, f"Fal endpoint is not meterable on the OkVevo gateway: {endpoint}"),
    )
    got = on_pre_tool_call("terminal", {"command": "hermes config set image_gen.model fal-ai/gpt-image-2"})
    assert got and got["action"] == "block"
    assert "not meterable" in got["message"] and "current image model was kept" in got["message"]


def test_internal_build_skips_the_guard(monkeypatch):
    monkeypatch.setenv("OKVEVO_BUILD_CHANNEL", "internal")
    assert on_pre_tool_call("terminal", {"command": "hermes config set model.provider anthropic"}) is None
    assert on_pre_tool_call("terminal", {"command": "hermes auth add openrouter"}) is None


def test_managed_keys_come_from_the_defaults_file():
    leaves = guard._managed_defaults()
    assert "model.provider" in leaves and "plugins.enabled" in leaves
    assert "image_gen.model" not in leaves


def test_next_turn_reads_the_reconciled_provider(_public_home):
    """A sed edit slips past the guard; the desktop reconciler's atomic rewrite wins on the next load."""
    from hermes_cli.config import load_config

    config = _public_home / "config.yaml"

    def with_provider(provider: str) -> str:
        tree = yaml.safe_load(config.read_text(encoding="utf-8"))
        tree["model"]["provider"] = provider
        return yaml.safe_dump(tree)

    assert load_config()["model"]["provider"] == "okvevo"
    config.write_text(with_provider("anthropic"), encoding="utf-8")
    assert load_config()["model"]["provider"] == "anthropic"
    tmp = config.with_name("config.yaml.okvevo-reconcile.tmp")
    tmp.write_text(with_provider("okvevo"), encoding="utf-8")
    os.replace(tmp, config)
    assert load_config()["model"]["provider"] == "okvevo"
