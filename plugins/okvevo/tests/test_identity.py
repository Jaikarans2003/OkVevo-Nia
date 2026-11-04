"""Identity: the generated OkVevo SOUL is upstream's SOUL with ONLY the identity phrases swapped,
and it flows through upstream's real identity slot (#1: SOUL.md via load_soul_md / _identity_parts).

Also pins the seams the desktop migration relies on (DEFAULT_SOUL_MD parity, _identity_parts
signature) so an upstream sync that moves them fails here, loudly.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_make_soul():
    spec = importlib.util.spec_from_file_location(
        "okvevo_make_soul", REPO_ROOT / "scripts" / "okvevo" / "make_soul.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


make_soul_mod = _load_make_soul()
UPSTREAM_SOUL = (REPO_ROOT / "SOUL.md").read_text(encoding="utf-8")


def test_generated_soul_identity_phrases_only():
    out = make_soul_mod.make_soul(UPSTREAM_SOUL)
    assert out.startswith("You are OkVevo agent, built by OkVevo.")
    assert "Hermes Agent" not in out
    assert "Nous Research" not in out
    # ONLY the identity phrases changed: reversing the swap restores upstream byte-for-byte.
    restored = out.replace("OkVevo agent", "Hermes Agent").replace("built by OkVevo", "built by Nous Research")
    assert restored == UPSTREAM_SOUL


def test_make_soul_fails_closed_on_reworded_upstream():
    with pytest.raises(ValueError, match="Hermes Agent"):
        make_soul_mod.make_soul("You are Something Else, built by Nous Research.")
    with pytest.raises(ValueError, match="Nous Research"):
        make_soul_mod.make_soul("You are Hermes Agent, built by someone.")


def test_cli_fails_closed(tmp_path):
    bad = tmp_path / "SOUL.md"
    bad.write_text("totally reworded", encoding="utf-8")
    assert make_soul_mod.main(["--src", str(bad)]) == 1


def test_repo_soul_matches_seeded_default():
    """Canary: upstream seeds DEFAULT_SOUL_MD into ~/.hermes/SOUL.md on first run and keeps it
    'identical to' repo SOUL.md. The desktop migration upgrades files that byte-match the seeded
    default, so if upstream ever diverges the two, re-decide which text make_soul transforms."""
    from hermes_cli.default_soul import DEFAULT_SOUL_MD, is_legacy_template_soul

    assert UPSTREAM_SOUL.strip() == DEFAULT_SOUL_MD.strip()
    # The generated OkVevo soul must NOT look like an upstream auto-seeded template, or upstream's
    # in-place scaffold upgrade would overwrite the OkVevo identity with the Hermes one.
    assert not is_legacy_template_soul(make_soul_mod.make_soul(UPSTREAM_SOUL))


# ---------------------------------------------------------------------------
# Prompt assembly: identity slot #1 end to end (default bot / new bot / subagent)
# ---------------------------------------------------------------------------

def _home_with_okvevo_soul(tmp_path: Path) -> Path:
    home = tmp_path / "hermes-home"
    home.mkdir()
    (home / "SOUL.md").write_text(make_soul_mod.make_soul(UPSTREAM_SOUL), encoding="utf-8")
    return home


def _fake_agent(home: Path, *, skip_context_files: bool = False, load_soul_identity: bool = False):
    # _agent_home(agent) falls back to the parent of _session_db.db_path (= <home>/state.db).
    return SimpleNamespace(
        skip_context_files=skip_context_files,
        load_soul_identity=load_soul_identity,
        _session_db=SimpleNamespace(db_path=str(home / "state.db")),
    )


def test_default_bot_prompt_identifies_as_okvevo(tmp_path):
    """(a) default bot: SOUL.md in the profile home → identity part is the OkVevo soul."""
    from agent.system_prompt import _identity_parts

    home = _home_with_okvevo_soul(tmp_path)
    parts, soul_loaded = _identity_parts(_fake_agent(home), None)
    assert soul_loaded is True
    assert parts[0].startswith("You are OkVevo agent, built by OkVevo.")
    assert "Hermes Agent" not in parts[0] and "Nous Research" not in parts[0]


def test_new_bot_profile_prompt_identifies_as_okvevo(tmp_path):
    """(b) newly created bot: its own profile home gets the generated soul (migration writes it);
    the prompt builder reads that profile's SOUL.md, not the root's."""
    from agent.system_prompt import _identity_parts

    profile_home = tmp_path / "profiles" / "my-bot"
    profile_home.mkdir(parents=True)
    (profile_home / "SOUL.md").write_text(make_soul_mod.make_soul(UPSTREAM_SOUL), encoding="utf-8")
    parts, soul_loaded = _identity_parts(_fake_agent(profile_home), None)
    assert soul_loaded is True
    assert parts[0].startswith("You are OkVevo agent, built by OkVevo.")


def test_subagent_keeps_okvevo_identity(tmp_path):
    """(c) subagent/cron: skip_context_files=True but load_soul_identity=True (managed_worker's
    non-ignore_rules path) still loads the persona → OkVevo, not DEFAULT_AGENT_IDENTITY."""
    from agent.system_prompt import _identity_parts

    home = _home_with_okvevo_soul(tmp_path)
    parts, soul_loaded = _identity_parts(
        _fake_agent(home, skip_context_files=True, load_soul_identity=True), None
    )
    assert soul_loaded is True
    assert parts[0].startswith("You are OkVevo agent, built by OkVevo.")


def test_internal_fallback_is_upstream_default(tmp_path):
    """Documented residual: sessions that skip the soul entirely (curator, ignore_rules workers)
    fall back to upstream DEFAULT_AGENT_IDENTITY. Internal-only surfaces; accepted, no KEEP-PATCH."""
    from agent.prompt_builder import DEFAULT_AGENT_IDENTITY
    from agent.system_prompt import _identity_parts

    home = _home_with_okvevo_soul(tmp_path)
    parts, soul_loaded = _identity_parts(
        _fake_agent(home, skip_context_files=True, load_soul_identity=False), None
    )
    assert soul_loaded is False
    assert parts == [DEFAULT_AGENT_IDENTITY]


# ---------------------------------------------------------------------------
# Workaround identity_guidance: the every-session help guidance names Nia/OkVevo
# ---------------------------------------------------------------------------

# The leaks this PR fixes. Deliberately NOT bare "Hermes": accepted residuals
# are internal identifiers (allowlisted) — `@hermes` (protocol handle),
# `~/.hermes`, the `hermes` CLI, the `hermes-agent` skill, `HERMES_*` env vars,
# and upstream's "Active Hermes profile" / "Hermes desktop app" platform hints.
_FORBIDDEN_IDENTITY_PHRASES = (
    "Nous Research",
    "hermes-agent.nousresearch.com",
    "You run on Hermes",
    "You are Hermes Agent",
)


@pytest.fixture
def guidance_override():
    """Apply the real override, then restore the upstream constants: the patch
    mutates process-global modules other tests in this run rely on."""
    from agent import prompt_builder, system_prompt

    from plugins.okvevo.identity import apply_identity_guidance_override

    saved = (
        prompt_builder.HERMES_AGENT_HELP_GUIDANCE,
        prompt_builder.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
        system_prompt.HERMES_AGENT_HELP_GUIDANCE,
        system_prompt.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
    )
    try:
        assert apply_identity_guidance_override() is True
        yield
    finally:
        (
            prompt_builder.HERMES_AGENT_HELP_GUIDANCE,
            prompt_builder.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
            system_prompt.HERMES_AGENT_HELP_GUIDANCE,
            system_prompt.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
        ) = saved


def _prompt_agent(home: Path):
    agent = _fake_agent(home)
    agent.valid_tool_names = {"read_file"}
    agent._task_completion_guidance = False
    agent._tool_use_enforcement = False
    agent._environment_probe = False
    agent._kanban_worker_guidance = ""
    agent._memory_store = None
    agent._memory_manager = None
    agent.model = ""
    agent.provider = ""
    agent.platform = ""
    agent.pass_session_id = False
    agent.session_id = ""
    agent._emit_status = lambda *_args, **_kwargs: None
    return agent


def _build_prompt(home: Path) -> str:
    from unittest.mock import patch

    from agent.system_prompt import build_system_prompt

    with (
        patch("agent.prompt_builder.build_environment_hints", return_value=""),
        patch("agent.prompt_builder.build_context_files_prompt", return_value=""),
        patch("agent.coding_context.coding_system_prompt_parts", return_value=([], [], [])),
        patch("agent.system_prompt.get_hermes_home", lambda: home),
    ):
        return build_system_prompt(_prompt_agent(home))


def test_guidance_override_patches_the_upstream_seam(guidance_override):
    """Same attributes upstream's own tests patch (tests/agent/test_system_prompt.py)."""
    from agent import prompt_builder, system_prompt

    from plugins.okvevo.identity import (
        OKVEVO_AGENT_HELP_GUIDANCE,
        OKVEVO_AGENT_HELP_GUIDANCE_NO_SKILLS,
    )

    for module in (prompt_builder, system_prompt):
        assert module.HERMES_AGENT_HELP_GUIDANCE == OKVEVO_AGENT_HELP_GUIDANCE
        assert module.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS == OKVEVO_AGENT_HELP_GUIDANCE_NO_SKILLS
    for phrase in _FORBIDDEN_IDENTITY_PHRASES:
        assert phrase not in OKVEVO_AGENT_HELP_GUIDANCE
        assert phrase not in OKVEVO_AGENT_HELP_GUIDANCE_NO_SKILLS
    assert "https://www.okvevo.com" in OKVEVO_AGENT_HELP_GUIDANCE_NO_SKILLS


def test_guidance_override_toggle_off_leaves_upstream(monkeypatch):
    from agent import prompt_builder

    from plugins.okvevo import identity

    monkeypatch.setattr(identity, "identity_guidance_enabled", lambda: False)
    assert identity.apply_identity_guidance_override() is False
    assert "Nous Research" in prompt_builder.HERMES_AGENT_HELP_GUIDANCE


def test_identity_guidance_enabled_reads_the_shipped_toggle(tmp_path, monkeypatch):
    from plugins.okvevo import identity

    # Shipped default: on.
    assert identity.identity_guidance_enabled() is True
    # Explicit off in the defaults file.
    off = tmp_path / "off.yaml"
    off.write_text("okvevo:\n  workarounds:\n    identity_guidance: false\n", encoding="utf-8")
    monkeypatch.setattr(identity, "_DEFAULTS_PATH", off)
    assert identity.identity_guidance_enabled() is False
    # Unreadable defaults fail ON: a missing file must not leak Hermes identity.
    monkeypatch.setattr(identity, "_DEFAULTS_PATH", tmp_path / "missing.yaml")
    assert identity.identity_guidance_enabled() is True


def test_full_prompt_has_no_identity_leak(tmp_path, guidance_override):
    """Full-prompt scan with the OkVevo SOUL and the override: the two PR 1.3
    leaks are gone from the whole stable tier, not just the identity slot."""
    prompt = _build_prompt(_home_with_okvevo_soul(tmp_path))
    for phrase in _FORBIDDEN_IDENTITY_PHRASES:
        assert phrase not in prompt, f"{phrase!r} leaked into the system prompt"
    assert "You are OkVevo agent, built by OkVevo." in prompt
    assert "https://www.okvevo.com" in prompt


def test_full_prompt_without_override_would_catch_the_leak(tmp_path):
    """Teeth check for the scan above: without the override the forbidden
    phrases ARE in the built prompt, so a regression cannot pass silently."""
    from agent import prompt_builder  # noqa: F401 — prove unpatched state

    prompt = _build_prompt(_home_with_okvevo_soul(tmp_path))
    assert "Nous Research" in prompt
    assert "hermes-agent.nousresearch.com" in prompt
