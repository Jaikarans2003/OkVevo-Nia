"""Skills preamble must encode reply-language + named-model rules (RC4/RC6)."""

from __future__ import annotations

from pathlib import Path

from agent.prompt_builder import build_skills_system_prompt


def test_skills_preamble_includes_reply_language_and_named_model_rules(tmp_path):
    skill_dir = tmp_path / "skills" / "demo"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo\ndescription: demo skill\n---\n\n# Demo\n",
        encoding="utf-8",
    )
    prompt = build_skills_system_prompt(skills_dir_override=tmp_path / "skills")
    assert "Reply in the user's language" in prompt
    assert "never omit it after a refusal" in prompt
    assert "never redraw" in prompt
