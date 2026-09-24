"""S3 C3: GUI-injection scanner — hard-block terminal/execute_code; MCP executable-arg approval only."""

from __future__ import annotations

from unittest.mock import patch

from tools.approval import _floor_block, check_all_command_guards, check_execute_code_guard
from tools.approval_detection import detect_gui_injection
from tools.mcp_tool_handlers import _gui_injection_approval, _mcp_executable_texts


CASES = (
    ('tell application "System Events" to keystroke "hi"', "System Events"),
    ("cliclick c:10,10", "cliclick"),
    ("xdotool click 1", "xdotool"),
    ("import pyautogui; pyautogui.click()", "pyautogui"),
    ("from pynput.keyboard import Controller", "pynput"),
    ("CGEventPost(0, ev)", "CGEventPost"),
    ("ctypes.windll.user32.SendInput(1, p, sz)", "SendInput"),
    ("$wshell.SendKeys('hello')", "SendKeys"),
    ("AutoHotkey.exe script.ahk", "AutoHotkey"),
    ("nircmd sendkeypress a", "nircmd"),
)


def test_detect_gui_injection_patterns():
    for text, kind in CASES:
        hit, desc = detect_gui_injection(text)
        assert hit, text
        assert kind.lower() in desc.lower() or kind in desc
    safe, _ = detect_gui_injection("echo hello && git status")
    assert safe is False


def test_terminal_hard_blocks_even_under_yolo():
    blocked = _floor_block("python -c 'import pyautogui; pyautogui.click()'")
    assert blocked is not None
    assert blocked.get("approved") is False
    result = check_all_command_guards("python -c 'import pyautogui; pyautogui.click()'", "local")
    assert result.get("approved") is False


def test_execute_code_hard_blocks_pyautogui():
    result = check_execute_code_guard("import pyautogui\npyautogui.click()", "local")
    assert result.get("approved") is False
    assert "computer_use" in (result.get("message") or "")


def test_echo_is_not_blocked():
    assert _floor_block("echo hello") is None


def test_mcp_note_text_pyautogui_is_not_scanned():
    texts = _mcp_executable_texts("srv", "add_note", {"note": "use pyautogui", "text": "import pyautogui"})
    assert texts == []
    assert _gui_injection_approval("srv", "add_note", {"note": "import pyautogui"}) is None


def test_mcp_command_arg_requires_approval_not_hard_block():
    with patch("tools.approval.request_tool_approval", return_value={"approved": False, "message": "denied"}):
        err = _gui_injection_approval("srv", "run", {"command": "import pyautogui; pyautogui.click()"})
    assert err is not None
    assert "denied" in err or "pyautogui" in err or "GUI" in err
    with patch("tools.approval.request_tool_approval", return_value={"approved": True}) as gate:
        assert _gui_injection_approval("srv", "run", {"command": "import pyautogui; pyautogui.click()"}) is None
        gate.assert_called_once()
