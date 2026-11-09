"""Public builds open no Webapp listener (Hermes v0.23.0 browser-hosted Desktop behind Nous sign-in).

The gateway plans its one listener with ``gateway.webapp_listener.listener_plan``. With OkVevo's
first-run defaults it must stay the private loopback listener on an ephemeral port: no webapp port,
no webapp mount, no public URL.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from gateway.webapp_listener import DEFAULT_PORT, listener_plan

DEFAULTS = Path(__file__).resolve().parents[3] / "okvevo" / "config" / "okvevo-defaults.yaml"


def test_public_defaults_open_no_webapp_listener(tmp_path):
    shutil.copy(DEFAULTS, tmp_path / "config.yaml")

    host, port, mount, reason = listener_plan(tmp_path)

    assert (host, port) == ("127.0.0.1", 0)
    assert port != DEFAULT_PORT
    assert mount is None
    assert reason is None


def test_control_enabled_webapp_does_bind_the_webapp_port(tmp_path):
    (tmp_path / "config.yaml").write_text("webapp:\n  enabled: true\n", encoding="utf-8")

    host, port, mount, _ = listener_plan(tmp_path)

    assert (host, port) == ("127.0.0.1", DEFAULT_PORT)
    assert mount is not None
