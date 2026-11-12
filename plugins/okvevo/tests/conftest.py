"""Shared okvevo plugin test fixtures."""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _restore_identity_guidance_globals():
    """`register()` applies the identity_guidance workaround by patching
    process-global prompt constants. Snapshot and restore them so an
    in-process register() can never leak OkVevo wording into other tests
    that assert upstream's guidance text."""
    from agent import prompt_builder, system_prompt

    saved = (
        prompt_builder.HERMES_AGENT_HELP_GUIDANCE,
        prompt_builder.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
        system_prompt.HERMES_AGENT_HELP_GUIDANCE,
        system_prompt.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
    )
    yield
    (
        prompt_builder.HERMES_AGENT_HELP_GUIDANCE,
        prompt_builder.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
        system_prompt.HERMES_AGENT_HELP_GUIDANCE,
        system_prompt.HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS,
    ) = saved
