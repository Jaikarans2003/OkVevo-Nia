"""Read real app state via AX (Mac) / UIA (Windows). Never log TEST_CONTACT."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

NOTE_TITLE = "Nia P0 test note"


def _run(cmd: list[str], timeout: float = 40) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 124, "", "timeout")


def _jxa_ax_texts(app: str) -> list[str]:
    """Flatten AXStaticText / AXTextArea values for a frontmost-ish process."""
    js = f'''
ObjC.import("AppKit");
function run() {{
  var se = Application("System Events");
  se.includeStandardAdditions = true;
  var procs = se.processes.whose({{ name: "{app}" }});
  if (procs.length === 0) return JSON.stringify([]);
  var p = procs[0];
  var out = [];
  function walk(el, depth) {{
    if (depth > 8) return;
    try {{
      var role = "";
      try {{ role = el.role(); }} catch (e) {{}}
      var val = "";
      try {{ val = el.value(); }} catch (e) {{}}
      var nm = "";
      try {{ nm = el.name(); }} catch (e) {{}}
      var t = (val || nm || "").toString();
      if (t && t.length < 500) out.push(role + "|" + t);
      var kids = [];
      try {{ kids = el.uiElements(); }} catch (e) {{ kids = []; }}
      for (var i = 0; i < Math.min(kids.length, 40); i++) walk(kids[i], depth + 1);
    }} catch (e) {{}}
  }}
  try {{
    var wins = p.windows();
    for (var w = 0; w < wins.length; w++) walk(wins[w], 0);
  }} catch (e) {{}}
  return JSON.stringify(out);
}}
'''
    r = _run(["osascript", "-l", "JavaScript", "-e", js], timeout=20)
    try:
        return json.loads(r.stdout.strip() or "[]")
    except json.JSONDecodeError:
        return []


def check_notes(title: str = NOTE_TITLE, needle: str = "") -> dict[str, Any]:
    if sys.platform == "darwin":
        script = f'''
tell application "Notes"
    set found to false
    set bodyText to ""
    repeat with n in notes
        if name of n is "{title}" then
            set found to true
            set bodyText to body of n as text
            exit repeat
        end if
    end repeat
    return (found as text) & "\t" & bodyText
end tell
'''
        r = _run(["osascript", "-e", script])
        line = (r.stdout or "").strip()
        found = line.lower().startswith("true")
        body = line.split("\t", 1)[1] if "\t" in line else ""
        if needle and needle not in body and needle not in line:
            return {"ok": False, "reason": "note_missing_marker", "found": found}
        return {"ok": found, "reason": "ok" if found else "note_missing"}
    ps = Path(__file__).with_name("uia_dump.ps1")
    r = _run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps), "-App", "Notes"])
    text = r.stdout or ""
    if title in text and (not needle or needle in text):
        return {"ok": True, "reason": "note_in_uia"}
    return {"ok": False, "reason": "note_not_in_uia"}


def check_whatsapp_last_bubble(marker: str) -> dict[str, Any]:
    if not marker:
        return {"ok": False, "reason": "no_marker"}
    if sys.platform == "darwin":
        texts = _jxa_ax_texts("WhatsApp")
        hits = [row for row in texts if marker in row]
        if hits:
            return {"ok": True, "reason": "marker_in_last_ax"}
        try:
            from dump import cua_app_texts

            cua_hits = [row for row in cua_app_texts("WhatsApp") if marker in row]
            if cua_hits:
                return {"ok": True, "reason": "marker_in_cua"}
        except Exception:
            pass
        return {"ok": False, "reason": "marker_not_in_ax"}
    ps = Path(__file__).with_name("uia_dump.ps1")
    if not ps.exists():
        return {"ok": False, "reason": "uia_dump_missing"}
    r = _run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps), "-App", "WhatsApp"])
    if marker in (r.stdout or ""):
        return {"ok": True, "reason": "marker_in_uia"}
    return {"ok": False, "reason": "marker_not_in_uia"}


def check_calc_a4(expected: int = 60) -> dict[str, Any]:
    needle = str(expected)
    if sys.platform == "darwin":
        for app in ("LibreOffice", "soffice"):
            texts = _jxa_ax_texts(app)
            joined = "\n".join(texts)
            if needle in joined:
                return {"ok": True, "reason": "a4_in_ax"}
        try:
            from dump import cua_app_texts

            cua = "\n".join(cua_app_texts("soffice") + cua_app_texts("LibreOffice"))
            if needle in cua:
                return {"ok": True, "reason": "a4_in_cua"}
        except Exception:
            pass
        if not Path("/Applications/LibreOffice.app").exists() and not shutil.which("soffice"):
            return {"ok": False, "reason": "calc_not_installed"}
        return {"ok": False, "reason": "a4_not_in_ax"}
    ps = Path(__file__).with_name("uia_dump.ps1")
    r = _run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps), "-App", "LibreOffice"])
    if needle in (r.stdout or ""):
        return {"ok": True, "reason": "a4_in_uia"}
    r2 = _run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps), "-App", "soffice"])
    if needle in (r2.stdout or ""):
        return {"ok": True, "reason": "a4_in_uia"}
    return {"ok": False, "reason": "a4_not_in_uia"}


def check_tally_ledger(name: str = "Test Ledger", under: str = "Sundry Debtors") -> dict[str, Any]:
    if sys.platform != "win32":
        return {"ok": False, "reason": "tally_windows_only"}
    ps = Path(__file__).with_name("uia_dump.ps1")
    r = _run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps), "-App", "tally"])
    text = r.stdout or ""
    if name in text and under in text:
        return {"ok": True, "reason": "ledger_in_uia"}
    if name in text:
        return {"ok": False, "reason": "ledger_name_without_group"}
    return {"ok": False, "reason": "ledger_not_in_uia"}


def check_kind(kind: str, *, marker: str, cfg: dict) -> dict[str, Any]:
    if kind in {"whatsapp", "multi"}:
        return check_whatsapp_last_bubble(marker)
    if kind == "notes":
        return check_notes(cfg.get("note_title") or NOTE_TITLE, marker)
    if kind == "calc":
        return check_calc_a4(int(cfg.get("calc_total") or 60))
    if kind == "tally":
        return check_tally_ledger(cfg.get("tally_ledger") or "Test Ledger", cfg.get("tally_under") or "Sundry Debtors")
    return {"ok": None, "reason": "no_checker"}
