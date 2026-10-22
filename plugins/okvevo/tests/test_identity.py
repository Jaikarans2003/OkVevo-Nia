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
