"""Vendored Drama Skills stay inside Nia. No fetch from upstream."""
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
NAMES = (
    "short-drama",
    "short-drama-novel-analyze",
    "short-drama-develop",
    "short-drama-write",
    "short-drama-assets",
    "short-drama-image-prompts",
    "short-drama-storyboard",
    "short-drama-video-prompts",
    "short-drama-produce",
    "short-drama-edit",
    "short-drama-review",
)


def test_drama_skills_load_from_bundled_dir():
    from tools.skills_sync import _discover_bundled_skills, _get_bundled_dir

    found = dict(_discover_bundled_skills(_get_bundled_dir()))
    for name in NAMES:
        assert name in found, name
        skill_dir = found[name]
        text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
        assert text.startswith("---")
        assert (skill_dir / "LICENSE").is_file()
        assert not (skill_dir / ".git").exists()


def test_production_profile_example_parses():
    path = (
        REPO
        / "skills/creative/short-drama/references/okvevo-production-profile.example.json"
    )
    data = json.loads(path.read_text(encoding="utf-8"))
    choices = data["choices"]
    assert choices["quality_band"] in ("draft", "standard", "best")
    assert isinstance(choices["spend_cap_credits"], int)
    assert "target_video_model" in choices


def test_no_upstream_fetch():
    gitmodules = REPO / ".gitmodules"
    if gitmodules.exists():
        assert "zenstory" not in gitmodules.read_text(encoding="utf-8")
        assert "drama-skills" not in gitmodules.read_text(encoding="utf-8")
    workflows = REPO / ".github/workflows"
    for path in workflows.rglob("*"):
        if path.suffix not in {".yml", ".yaml"}:
            continue
        text = path.read_text(encoding="utf-8")
        assert "zenstory-ai" not in text, path
        assert "drama-skills" not in text, path
    for name in NAMES:
        assert not (REPO / "skills/creative" / name / ".git").exists()
