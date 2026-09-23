"""Reset app state before each scored run. AX/UIA + AppleScript; no phone numbers."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

NOTE_TITLE = "Nia P0 test note"


def _run(cmd: list[str], timeout: float = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def reset_notes(title: str = NOTE_TITLE) -> str:
    if sys.platform != "darwin":
        # Windows "Notes" / OneNote is not the Mac Notes app. Best-effort: no-op
        # if we cannot find a Notes window; dump/checkers still score Mac Notes.
        return "notes_reset_skipped_non_darwin"
    script = f'''
tell application "Notes"
    try
        repeat with n in notes
            if name of n is "{title}" then delete n
        end repeat
    end try
end tell
'''
    _run(["osascript", "-e", script])
    return "notes_reset_ok"


def reset_calc() -> str:
    app = Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
    if sys.platform == "win32":
        found = any(
            Path(p).exists()
            for p in (
                r"C:\Program Files\LibreOffice\program\soffice.exe",
                r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            )
        )
        if not found and not shutil.which("soffice"):
            return "calc_missing"
        ps = Path(__file__).with_name("calc_reset.ps1")
        r = _run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps)],
            timeout=30,
        )
        return ((r.stdout or r.stderr or "calc_reset")[:200]).strip() or "calc_reset"
    if not app.exists() and not shutil.which("soffice"):
        return "calc_missing"
    script = '''
tell application "System Events"
    set procName to ""
    if exists process "soffice" then set procName to "soffice"
    if procName is "" and exists process "LibreOffice" then set procName to "LibreOffice"
    if procName is "" then return "calc_not_running"
    tell process procName
        set frontmost to true
        keystroke "a" using command down
        delay 0.15
        key code 51
    end tell
end tell
'''
    _run(["osascript", "-e", script])
    return "calc_reset_select_all_delete"


def reset_tally() -> str:
    if sys.platform != "win32":
        return "tally_skipped_non_windows"
    ps = Path(__file__).with_name("tally_reset.ps1")
    if not ps.exists():
        return "tally_reset_script_missing"
    r = _run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ps),
        ],
        timeout=60,
    )
    return ((r.stdout or r.stderr or "tally_reset")[:200]).strip() or "tally_reset"


def reset_kind(kind: str) -> str:
    if kind in {"notes", "multi"}:
        return reset_notes()
    if kind == "calc":
        return reset_calc()
    if kind == "tally":
        return reset_tally()
    if kind == "whatsapp":
        return "whatsapp_no_delete_unique_marker"
    return "no_reset"
