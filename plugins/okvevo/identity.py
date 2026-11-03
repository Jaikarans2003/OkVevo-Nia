"""Workaround: identity_guidance (docs/okvevo/WORKAROUNDS.md) — DEP-3.

Description: every session's stable prompt tier carries upstream's
  ``HERMES_AGENT_HELP_GUIDANCE(_NO_SKILLS)`` ("You run on Hermes Agent (by
  Nous Research)… hermes-agent.nousresearch.com"), so bots say Hermes/Nous
  when asked who made them or where to get help. v0.22.4 has no supported
  replace/suppress mechanism: no config gate, no plugin hook, and the
  documented ``HERMES_AGENT_HELP_GUIDANCE`` env var is never read in code
  (grep-verified 2026-11-03). This module holds the single-source OkVevo
  wording and swaps both constants at plugin ``register()`` — the same
  attributes upstream's own tests patch
  (``tests/agent/test_system_prompt.py`` setattr on ``agent.system_prompt``).
Bug: none filed (draft upstream proposal in docs/okvevo/WORKAROUNDS.md).
Forwarded: no
Applied-Upstream: no
Last-Update: 2026-11-03

Toggle off (``okvevo.workarounds.identity_guidance: false``) leaves upstream's
guidance untouched.
"""
from __future__ import annotations

from pathlib import Path

import hermes_yaml as yaml

_DEFAULTS_PATH = Path(__file__).resolve().parents[2] / "okvevo" / "config" / "okvevo-defaults.yaml"

# Single source of the OkVevo help/identity wording. Keep the same function as
# upstream's constants: a help pointer in the stable tier, not a persona (the
# persona slot is SOUL.md's). `hermes-agent` (the skill name) is an allowlisted
# internal identifier, not user-facing branding.
_OKVEVO_HELP_GUIDANCE_BASE = (
    "You run on Nia, the OkVevo desktop agent (built by OkVevo). When the user needs help with the app — "
    "configuring, setting up, using, extending, or troubleshooting it — or when you need to understand your "
    "own features, tools, or capabilities, the OkVevo site at https://www.okvevo.com is the authoritative "
    "reference and always holds the latest, most up-to-date information. Never call yourself Hermes or "
    "credit any other company for the app: you are Nia, built by OkVevo."
)

# Skills variant: keep the skill_view pointer (the skill exists on Okvevo
# builds too; the name is an internal identifier).
OKVEVO_AGENT_HELP_GUIDANCE = (
    _OKVEVO_HELP_GUIDANCE_BASE
    + " The `hermes-agent` skill has the actual commands and proven workflows — load it with "
    "skill_view(name='hermes-agent') before configuring, modifying, or troubleshooting the app so you "
    "don't guess or invent workarounds."
)

# Variant for sessions without the skills toolset: naming skill_view() there would dangle.
OKVEVO_AGENT_HELP_GUIDANCE_NO_SKILLS = _OKVEVO_HELP_GUIDANCE_BASE


def identity_guidance_enabled() -> bool:
    """The shipped toggle (default true). Unreadable defaults fail ON: the
    workaround is the shipped behavior, a missing file must not leak Hermes."""
    try:
        tree = yaml.safe_load(_DEFAULTS_PATH.read_text(encoding="utf-8")) or {}
    except Exception:
        return True
    value = ((tree.get("okvevo") or {}).get("workarounds") or {}).get("identity_guidance")
    return value is not False


def apply_identity_guidance_override() -> bool:
    """Swap upstream's help-guidance constants for the OkVevo wording.

    Patches ``agent.prompt_builder`` (the definition) and ``agent.system_prompt``
    (the imported references the prompt builder actually reads). Idempotent;
    returns True when the override is in place.
    """
    if not identity_guidance_enabled():
        return False
    try:
        from agent import prompt_builder, system_prompt
    except Exception:
        return False
    for module in (prompt_builder, system_prompt):
        module.HERMES_AGENT_HELP_GUIDANCE = OKVEVO_AGENT_HELP_GUIDANCE
        module.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS = OKVEVO_AGENT_HELP_GUIDANCE_NO_SKILLS
    return True
