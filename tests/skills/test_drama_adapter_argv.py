"""B1: adapter argv absolutized against config dir (foreign cwd + Windows paths)."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

_SCRIPTS = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "creative"
    / "short-drama-produce"
    / "scripts"
)


def _load_production_tool():
    path = _SCRIPTS / "production_tool.py"
    spec = importlib.util.spec_from_file_location("drama_production_tool", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def pt():
    return _load_production_tool()


def test_load_adapter_absolutizes_relative_script_from_foreign_cwd(pt, tmp_path, monkeypatch):
    # Resolve relative to the config file's directory (references/ + ../scripts/).
    layout = tmp_path / "skill" / "references"
    layout.mkdir(parents=True)
    script_dir = tmp_path / "skill" / "scripts"
    script_dir.mkdir()
    script = script_dir / "provider_adapters.py"
    script.write_text("# stub\n", encoding="utf-8")
    cfg = layout / "adapter.json"
    cfg.write_text(
        json.dumps(
            {
                "adapters": {
                    "okvevo-image": {
                        "command": ["python3", "../scripts/provider_adapters.py", "portal"],
                        "timeout_seconds": 60,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    project = tmp_path / "drama-project"
    project.mkdir()
    foreign = tmp_path / "elsewhere"
    foreign.mkdir()
    monkeypatch.chdir(foreign)
    command, timeout, declared = pt._load_adapter(cfg, "okvevo-image", project)
    assert command[0] == sys.executable
    assert Path(command[1]).is_absolute()
    assert Path(command[1]).resolve() == script.resolve()
    assert command[2] == "portal"
    assert timeout == 60
    assert declared is None


def test_load_adapter_windows_backslash_script(pt, tmp_path, monkeypatch):
    layout = tmp_path / "skill" / "references"
    layout.mkdir(parents=True)
    script_dir = tmp_path / "skill" / "scripts"
    script_dir.mkdir()
    script = script_dir / "provider_adapters.py"
    script.write_text("# stub\n", encoding="utf-8")
    cfg = layout / "adapter.json"
    cfg.write_text(
        json.dumps(
            {
                "adapters": {
                    "okvevo-video": {
                        "command": [
                            "python3",
                            "..\\scripts\\provider_adapters.py",
                            "portal",
                        ],
                        "timeout_seconds": 120,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    project = tmp_path / "proj"
    project.mkdir()
    monkeypatch.chdir(tmp_path / "other" if False else tmp_path)
    command, _, _ = pt._load_adapter(cfg, "okvevo-video", project)
    assert command[0] == sys.executable
    assert Path(command[1]).resolve() == script.resolve()


def test_load_adapter_missing_script_fails_closed(pt, tmp_path):
    layout = tmp_path / "references"
    layout.mkdir()
    cfg = layout / "adapter.json"
    cfg.write_text(
        json.dumps(
            {
                "adapters": {
                    "okvevo-image": {
                        "command": ["python3", "../scripts/missing.py", "portal"],
                        "timeout_seconds": 60,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    project = tmp_path / "proj"
    project.mkdir()
    with pytest.raises(ValueError, match="adapter script not found"):
        pt._load_adapter(cfg, "okvevo-image", project)


def test_example_json_uses_relative_scripts_path():
    example = (
        Path(__file__).resolve().parents[2]
        / "skills"
        / "creative"
        / "short-drama-produce"
        / "references"
        / "okvevo-adapter.example.json"
    )
    data = json.loads(example.read_text(encoding="utf-8"))
    for profile, body in data["adapters"].items():
        assert body["command"] == [
            "python3",
            "../scripts/provider_adapters.py",
            "portal",
        ], profile
