"""Regression guards for Nia product identity in prompts and skill bodies."""

import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from agent.prompt_builder import PRODUCT_IDENTITY_GUIDANCE
from agent.system_prompt import build_system_prompt_parts

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SKILL_ROOTS = (
    _REPO_ROOT / "skills",
    _REPO_ROOT / "optional-skills",
)

_FORBIDDEN_SKILL_BODY_PATTERNS = (
    re.compile(r"\bHermes Agent is\b"),
    re.compile(r"\bby Nous Research\b"),
    re.compile(r"\bbuilt by Nous\b"),
    re.compile(r"\bpart of Hermes\b"),
    re.compile(r"\bHermes Agent framework\b"),
    re.compile(r"\bdesigned for the Hermes agent\b", re.I),
    re.compile(r"## Rules for Hermes Agents\b"),
    re.compile(r"## Hermes Agent Integration\b"),
    re.compile(r"\binto Hermes Agent\b"),
    re.compile(r"\bHermes desktop app\b"),
    re.compile(r"\bHermes desktop DOM\b", re.I),
)

# ponytail: naive vendor-name scan — catches enumerated disambiguation lists only
_VENDOR_NAMES = (
    "MiniMax",
    "OpenAI",
    "Anthropic",
    "Google",
    "DeepSeek",
    "Alibaba",
    "OpenRouter",
)


def _make_agent(**overrides):
    base = dict(
        load_soul_identity=False,
        skip_context_files=False,
        valid_tool_names=[],
        _task_completion_guidance=False,
        _tool_use_enforcement=False,
        _environment_probe=False,
        _kanban_worker_guidance="",
        _memory_store=None,
        _memory_manager=None,
        model="minimax-m3",
        provider="minimax",
        platform="desktop",
        pass_session_id=False,
        session_id="",
        _emit_status=lambda *_args, **_kwargs: None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _skill_body(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    return text[end + 4 :].lstrip("\n")


def _iter_skill_files():
    for root in _SKILL_ROOTS:
        if not root.is_dir():
            continue
        yield from sorted(root.rglob("SKILL.md"))


class TestProductIdentityGuidance:
    def test_present_in_stable_tier_after_identity_response_guidance(self):
        with (
            patch("run_agent.load_soul_md", return_value=""),
            patch("run_agent.build_environment_hints", return_value=""),
            patch("run_agent.build_context_files_prompt", return_value=""),
        ):
            stable = build_system_prompt_parts(_make_agent())["stable"]

        assert PRODUCT_IDENTITY_GUIDANCE in stable
        assert stable.index("capability brochure") < stable.index(
            "Model:` and `Provider:`"
        )

    def test_does_not_enumerate_vendor_names(self):
        lowered = PRODUCT_IDENTITY_GUIDANCE.lower()
        for vendor in _VENDOR_NAMES:
            assert vendor.lower() not in lowered

    def test_active_nia_profile_not_hermes(self, monkeypatch, tmp_path):
        root = tmp_path / ".hermes"
        root.mkdir(parents=True)
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        monkeypatch.setenv("HERMES_HOME", str(root))
        monkeypatch.delenv("TERMINAL_CWD", raising=False)

        with (
            patch("run_agent.load_soul_md", return_value=""),
            patch("run_agent.build_environment_hints", return_value=""),
            patch("run_agent.build_context_files_prompt", return_value=""),
        ):
            parts = build_system_prompt_parts(_make_agent())
        prompt = "\n\n".join(parts.values())

        assert "Active Nia profile: default." in prompt
        assert "Active Hermes profile" not in prompt

    def test_steer_channel_uses_nia_not_hermes(self):
        from agent.prompt_builder import STEER_CHANNEL_NOTE

        assert "Nia appends their message" in STEER_CHANNEL_NOTE
        assert "Hermes appends their message" not in STEER_CHANNEL_NOTE


class TestSkillBodyIdentityScan:
    def test_no_forbidden_identity_framing_in_skill_bodies(self):
        violations = []
        for path in _iter_skill_files():
            body = _skill_body(path)
            rel = path.relative_to(_REPO_ROOT)
            for line_no, line in enumerate(body.splitlines(), start=1):
                for pattern in _FORBIDDEN_SKILL_BODY_PATTERNS:
                    if pattern.search(line):
                        violations.append(f"{rel}:{line_no}: {line.strip()}")
        assert not violations, "Identity-framing hits in skill bodies:\n" + "\n".join(
            violations
        )
