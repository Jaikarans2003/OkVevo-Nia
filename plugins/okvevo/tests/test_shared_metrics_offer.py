"""Public builds never offer Nous shared metrics.

Hermes v0.23.0 re-asks a "No thanks" saved without ``offer_version`` (the composer strip says
"Share with Nous"). OkVevo's managed defaults must read as a settled "off" for the current offer.
"""
from __future__ import annotations

from pathlib import Path

from ruamel.yaml import YAML

from hermes_cli.observability.shared_metrics_consent import OFFER_VERSION, consent_state

DEFAULTS = Path(__file__).resolve().parents[3] / "okvevo" / "config" / "okvevo-defaults.yaml"


def test_public_defaults_settle_the_offer_off():
    defaults = YAML(typ="safe").load(DEFAULTS.read_text(encoding="utf-8"))

    assert consent_state(defaults) == {"enabled": False, "send": False, "decided": True, "reask": False}
    assert defaults["telemetry"]["shared_metrics"]["offer_version"] == OFFER_VERSION
