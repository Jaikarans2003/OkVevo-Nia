"""S3 package contracts: schema freeze, open_app, fail-closed, Shift+Return, 2 retries, AX-first, query."""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from tools.computer_use.backend import ActionResult, CaptureResult, UIElement
from tools.computer_use.schema import COMPUTER_USE_SCHEMA
from tools.computer_use import tool as cu_tool


@pytest.fixture(autouse=True)
def _reset(grant_computer_use_approvals):
    cu_tool.reset_backend_for_tests()
    with patch.dict(os.environ, {"HERMES_COMPUTER_USE_BACKEND": "noop"}, clear=False):
        yield
    cu_tool.reset_backend_for_tests()


def test_schema_routing_safety_open_app_frozen():
    desc = COMPUTER_USE_SCHEMA["description"]
    enum = COMPUTER_USE_SCHEMA["parameters"]["properties"]["action"]["enum"]
    assert "open_app" in enum
    assert "query" in COMPUTER_USE_SCHEMA["parameters"]["properties"]
    assert "Office files (xlsx/docx/pptx/csv)" in desc
    assert "Never click/type from terminal" in desc
    assert "osascript System Events / SendKeys" in desc
    assert "SAFETY:" in desc
    assert "hermes computer-use doctor" in desc
    assert "Requires cua-driver to be installed." in desc
    assert "Tally" not in desc


def test_open_app_routes_to_launch_app():
    backend = cu_tool._get_backend()
    out = json.loads(cu_tool.handle_computer_use({"action": "open_app", "app": "Notes"}))
    assert out.get("error") is None
    assert any(name == "launch_app" for name, _ in backend.calls)
    kw = next(c[1] for c in backend.calls if c[0] == "launch_app")
    assert kw.get("name") == "Notes"


def test_type_newlines_are_shift_return_not_return():
    backend = cu_tool._get_backend()
    out = json.loads(cu_tool.handle_computer_use({"action": "type", "text": "hi\nthere"}))
    assert out.get("error") is None
    names = [c[0] for c in backend.calls]
    assert names.count("type") == 2
    assert "key" in names
    keys = [c[1].get("keys") for c in backend.calls if c[0] == "key"]
    assert "shift+return" in keys
    assert "return" not in keys


def test_third_failed_verify_asks():
    escalate = json.dumps({"ok": False, "effect": "suspected_noop", "verdict": {"decision": "escalate"}})
    first = json.loads(cu_tool._cap_failed_verifies("s", escalate))
    second = json.loads(cu_tool._cap_failed_verifies("s", escalate))
    third = json.loads(cu_tool._cap_failed_verifies("s", escalate))
    assert first["verdict"]["decision"] == "escalate"
    assert second["verdict"]["decision"] == "escalate"
    assert third["code"] == "ask_user"
    assert third["verdict"]["decision"] == "ask"


def test_fail_closed_when_not_ready(monkeypatch):
    monkeypatch.setenv("HERMES_COMPUTER_USE_FORCE_READY_CHECK", "1")
    monkeypatch.delenv("HERMES_COMPUTER_USE_BACKEND", raising=False)

    def _status(_cmd=None):
        return {"ready": False, "platform": "darwin", "installed": True,
                "accessibility": False, "screen_recording": False, "error": "denied"}

    monkeypatch.setattr("tools.computer_use.permissions.computer_use_status", _status)
    out = json.loads(cu_tool.handle_computer_use({"action": "capture"}))
    assert out["code"] == "not_ready"
    assert "doctor" in out
    assert "grant" in out
    assert "computer_use" in out["hint"]


def test_ax_first_upgrades_when_tree_empty():
    class _Backend(cu_tool._NoopBackend):
        def capture(self, mode="ax", app=None, pid=None, window_id=None, query=None):
            self.calls.append(("capture", {"mode": mode, "query": query}))
            if mode == "ax":
                return CaptureResult(mode="ax", width=0, height=0, png_b64=None, elements=[], app="", window_title="")
            return CaptureResult(
                mode="som", width=100, height=100, png_b64=None,
                elements=[UIElement(index=1, role="AXButton", label="Send", bounds=(0, 0, 10, 10))],
                app="WA", window_title="x",
            )

    backend = _Backend()
    cu_tool._do_capture(backend, "capture", {}, fence=lambda: None)
    modes = [c[1]["mode"] for c in backend.calls if c[0] == "capture"]
    assert modes == ["ax", "som"]


def test_query_forwarded_on_capture():
    class _Backend(cu_tool._NoopBackend):
        def capture(self, mode="ax", app=None, pid=None, window_id=None, query=None):
            self.calls.append(("capture", {"mode": mode, "query": query}))
            return CaptureResult(
                mode=mode, width=100, height=100, png_b64=None,
                elements=[UIElement(index=1, role="AXButton", label="Send", bounds=(0, 0, 10, 10))],
                app="WA", window_title="x",
            )

    backend = _Backend()
    cu_tool._do_capture(backend, "capture", {"query": "Send"}, fence=lambda: None)
    assert backend.calls[0][1]["query"] == "Send"


def test_gws_args_include_query_and_ax_skips_screenshot():
    from tools.computer_use.cua_backend_capture import _CaptureMixin

    class _Stub(_CaptureMixin):
        _active_pid = 1
        _active_window_id = 2
        _session_id = "s"
        _capture_query = "Send"
        _capture_mode = "ax"

    args = _Stub()._gws_args()
    assert args["query"] == "Send"
    assert args["include_screenshot"] is False


def test_check_fn_still_binary_only():
    """Registry must still offer the tool when TCC is missing — fail-closed is handler-only."""
    import inspect
    src = inspect.getsource(cu_tool.check_computer_use_requirements)
    assert "computer_use_status" not in src
    assert "cua_driver_binary_available" in src
