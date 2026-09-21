"""Integration-marked Phase B probe for OkVevo Auto (OpenRouter auto-beta).

Skipped unless OPENROUTER_API_KEY is available. Run explicitly:

  pytest -m integration tests/providers/test_okvevo_auto_router_probe.py -q
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "probe_okvevo_auto_router.py"


def _load_probe():
    spec = importlib.util.spec_from_file_location("probe_okvevo_auto_router", _SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.integration
def test_okvevo_auto_router_live_probe():
    probe = _load_probe()
    if not probe._load_api_key():
        pytest.skip("OPENROUTER_API_KEY absent")
    assert probe.main() == 0
