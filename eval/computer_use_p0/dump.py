"""AX (Mac) + UIA (Windows) dumps for WhatsApp, Notes, TallyPrime, LibreOffice Calc.

Ghost is optional on Windows (P3). cua-driver dump is attempted when the binary exists.
Output under dumps/ (sanitized) and dumps/raw/ (gitignored).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DUMPS = HERE / "dumps"
RAW = DUMPS / "raw"

MAC_APPS = [
    ("WhatsApp", ["WhatsApp"]),
    ("Notes", ["Notes"]),
    ("LibreOffice Calc", ["soffice", "LibreOffice"]),
    ("TallyPrime Educational Mode", ["TallyPrime", "tally"]),
]
WIN_APPS = [
    ("WhatsApp", ["WhatsApp"]),
    ("Notes", ["Notes", "Sticky Notes", "OneNote"]),
    ("TallyPrime Educational Mode", ["tally", "TallyPrime", "tallyw"]),
    ("LibreOffice Calc", ["LibreOffice", "soffice", "scalc"]),
]


def _run(cmd: list[str], timeout: float = 45) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def _jxa_tree(app: str) -> dict[str, Any]:
    js = f'''
function run() {{
  var se = Application("System Events");
  var procs = se.processes.whose({{ name: "{app}" }});
  if (procs.length === 0) return JSON.stringify({{error: "process_missing", app: "{app}"}});
  var p = procs[0];
  var texts = [];
  function node(el, depth) {{
    if (depth > 8) return null;
    var o = {{role: "", name: "", value: "", position: "", size: "", kids: []}};
    try {{ o.role = el.role(); }} catch (e) {{}}
    try {{ o.name = (el.name() || "").toString().slice(0, 200); }} catch (e) {{}}
    try {{ o.value = (el.value() || "").toString().slice(0, 200); }} catch (e) {{}}
    try {{ o.position = (el.position() || "").toString(); }} catch (e) {{}}
    try {{ o.size = (el.size() || "").toString(); }} catch (e) {{}}
    var leaf = (o.name || o.value || "").trim();
    if (leaf && texts.length < 250) texts.push(o.role + "|" + leaf.slice(0, 200));
    try {{
      var kids = el.uiElements();
      for (var i = 0; i < Math.min(kids.length, 40); i++) {{
        var c = node(kids[i], depth + 1);
        if (c) o.kids.push(c);
      }}
    }} catch (e) {{}}
    return o;
  }}
  var wins = [];
  try {{
    var wlist = p.windows();
    for (var i = 0; i < wlist.length; i++) wins.push(node(wlist[i], 0));
  }} catch (e) {{
    return JSON.stringify({{error: String(e), app: "{app}"}});
  }}
  return JSON.stringify({{app: "{app}", texts: texts, windows: wins}});
}}
'''
    r = _run(["osascript", "-l", "JavaScript", "-e", js], timeout=60)
    try:
        return json.loads(r.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return {"app": app, "error": "parse", "stderr": (r.stderr or "")[:400]}


def _ensure_cua_daemon() -> None:
    st = _run(["cua-driver", "status"], timeout=10)
    text = (st.stdout or "") + (st.stderr or "")
    if "not running" in text.lower() or "daemon is not running" in text.lower():
        subprocess.Popen(
            ["cua-driver", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        import time as _time

        for _ in range(15):
            _time.sleep(0.4)
            st = _run(["cua-driver", "status"], timeout=5)
            t2 = (st.stdout or "") + (st.stderr or "")
            if "not running" not in t2.lower():
                return


def _unwrap_cua(obj: Any) -> Any:
    if isinstance(obj, str):
        try:
            return _unwrap_cua(json.loads(obj))
        except json.JSONDecodeError:
            return obj
    if not isinstance(obj, dict):
        return obj
    if any(k in obj for k in ("windows", "elements", "element_count", "app_name")):
        return obj
    for k in ("structuredContent", "result", "data"):
        inner = obj.get(k)
        if isinstance(inner, (dict, list)):
            return _unwrap_cua(inner)
    content = obj.get("content")
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
                return _unwrap_cua(item["text"])
    return obj


def _cua_json(tool: str, args: dict[str, Any]) -> dict[str, Any]:
    driver = shutil.which("cua-driver")
    if not driver:
        return {"error": "cua-driver_missing"}
    r = _run([driver, "call", tool, json.dumps(args)], timeout=45)
    raw = (r.stdout or "").strip()
    try:
        start = raw.find("{")
        parsed = json.loads(raw[start:]) if start >= 0 else {"stdout": raw[:4000]}
    except json.JSONDecodeError:
        return {"error": "parse", "stdout": raw[:4000], "stderr": (r.stderr or "")[:800]}
    unwrapped = _unwrap_cua(parsed)
    if isinstance(unwrapped, dict):
        return unwrapped
    if isinstance(unwrapped, list):
        return {"windows": unwrapped, "elements": unwrapped}
    return {"value": unwrapped}


def _elements_only(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop screenshots / huge blobs from committed dumps."""
    sc = dict(payload) if isinstance(payload, dict) else {}
    for drop in ("screenshot", "screenshot_base64", "image", "png"):
        sc.pop(drop, None)
    els = sc.get("elements") or []
    slim = []
    for el in els[:200]:
        if not isinstance(el, dict):
            continue
        slim.append(
            {
                "i": el.get("element_index") if el.get("element_index") is not None else el.get("index"),
                "role": el.get("role") or el.get("role_description") or el.get("control_type"),
                "name": (el.get("label") or el.get("name") or el.get("title") or "")[:120],
                "value": str(el.get("value") or el.get("text") or "")[:120],
                "frame": el.get("frame") or el.get("bbox"),
            }
        )
    return {
        "app_name": sc.get("app_name") or sc.get("app"),
        "window_title": sc.get("window_title") or sc.get("title"),
        "element_count": sc.get("element_count") or len(slim),
        "elements": slim,
        "degraded_reason": sc.get("degraded_reason"),
        "keys": sorted(sc.keys())[:30] if not slim else None,
    }


def _window_list(wins: dict[str, Any]) -> list[dict[str, Any]]:
    blob = wins if isinstance(wins, dict) else {}
    windows = blob.get("windows") or blob.get("items") or blob.get("value") or []
    if isinstance(windows, dict):
        windows = windows.get("windows") or []
    return windows if isinstance(windows, list) else []


def cua_app_texts(app: str) -> list[str]:
    """Element names/values from cua-driver for checkers (no screenshots)."""
    dump = _cua_dump(app)
    tree = dump.get("tree") or {}
    out: list[str] = []
    for el in tree.get("elements") or []:
        if not isinstance(el, dict):
            continue
        for k in ("name", "value", "role"):
            v = str(el.get(k) or "").strip()
            if v:
                out.append(v)
    return out


def _cua_dump(app: str) -> dict[str, Any]:
    driver = shutil.which("cua-driver")
    if not driver:
        return {"error": "cua-driver_missing"}
    _ensure_cua_daemon()
    wins = _cua_json("list_windows", {})
    windows = _window_list(wins)
    rows = []
    needle = app.lower()
    aliases = {needle, "soffice"} if needle in {"libreoffice", "soffice"} else {needle}
    if "tally" in needle:
        aliases.update({"tally", "tallyprime"})
    hits = []
    for w in windows:
        if not isinstance(w, dict):
            continue
        title = str(w.get("title") or w.get("app") or w.get("app_name") or "")
        app_name = str(w.get("app_name") or w.get("app") or "")
        rows.append({"title": title[:80], "app": app_name[:40], "pid": w.get("pid"), "window_id": w.get("window_id") or w.get("id")})
        blob = (title + " " + app_name).lower()
        if any(a in blob for a in aliases):
            b = w.get("bounds") if isinstance(w.get("bounds"), dict) else {}
            area = float(b.get("width") or 0) * float(b.get("height") or 0)
            hits.append((area, w))
    picked = max(hits, key=lambda t: t[0])[1] if hits else None
    if not picked:
        if rows:
            return {"list_windows": rows[:40], "error": "app_window_not_found"}
        return {"error": "no_windows", "raw": json.dumps(wins)[:1500]}
    pid = picked.get("pid")
    wid = picked.get("window_id") or picked.get("id")
    try:
        gws = _cua_json(
            "get_window_state",
            {
                "pid": int(pid),
                "window_id": int(wid),
                "include_screenshot": False,
                "max_elements": 150,
            },
        )
    except (TypeError, ValueError) as exc:
        return {"list_hit": rows[:8], "error": str(exc)}
    return {
        "picked": {
            "title": str(picked.get("title") or "")[:80],
            "app": str(picked.get("app_name") or "")[:40],
            "pid": picked.get("pid"),
            "window_id": wid,
        },
        "tree": _elements_only(gws),
    }


def _ghost_see() -> dict[str, Any]:
    ghost = shutil.which("ghost") or shutil.which("ghost-mcp")
    if not ghost:
        return {"error": "ghost_not_installed"}
    r = _run([ghost, "--help"], timeout=10)
    return {"help": (r.stdout or r.stderr or "")[:2000], "note": "P0 records availability; P3 pins Ghost"}


def _sanitize(obj: Any, contact: str) -> Any:
    if isinstance(obj, str):
        out = obj
        if contact:
            out = out.replace(contact, "***CONTACT***")
        out = re.sub(r"\+?\d[\d\s\-()]{8,}\d", "***PHONE***", out)
        return out
    if isinstance(obj, list):
        return [_sanitize(x, contact) for x in obj]
    if isinstance(obj, dict):
        return {k: _sanitize(v, contact) for k, v in obj.items()}
    return obj


def run_dumps(contact: str = "") -> Path:
    DUMPS.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    os_name = "windows" if sys.platform == "win32" else "mac"
    if not contact:
        try:
            from config_load import load_config

            contact = str(load_config().get("TEST_CONTACT") or "")
        except Exception:
            contact = ""
    payload: dict[str, Any] = {
        "os": os_name,
        "date": stamp,
        "python": sys.version.split()[0],
        "cua_driver": (_run(["cua-driver", "--version"]).stdout or "").strip()
        if shutil.which("cua-driver")
        else None,
        "apps": {},
        "ghost": _ghost_see() if sys.platform == "win32" else {"skipped": "mac"},
    }
    if sys.platform == "darwin":
        for name in ("WhatsApp", "Notes", "LibreOffice"):
            subprocess.Popen(["open", "-a", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import time as _time

        _time.sleep(2)
    apps = WIN_APPS if sys.platform == "win32" else MAC_APPS
    for label, procs in apps:
        tree: Any = None
        cua: Any = None
        for proc in procs:
            if sys.platform == "win32":
                ps = HERE / "uia_dump.ps1"
                r = _run(
                    [
                        "powershell",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                        str(ps),
                        "-App",
                        proc,
                    ],
                    timeout=60,
                )
                text = r.stdout or ""
                if "NO_WINDOW_MATCH" in text and tree is None:
                    tree = {"uia_text": text[:8000], "stderr": (r.stderr or "")[:2000]}
                    continue
                tree = {"uia_text": text[:50000], "stderr": (r.stderr or "")[:2000], "matched": proc}
                break
            cand = _jxa_tree(proc)
            if cand.get("error") == "process_missing":
                tree = cand
                continue
            tree = cand
            break
        for proc in procs:
            cua = _cua_dump(proc)
            if cua.get("error") not in {"app_window_not_found", "no_windows", "cua-driver_missing"}:
                break
        payload["apps"][label] = {
            "ax_or_uia": tree,
            "cua": cua,
        }
    payload = _sanitize(payload, contact)
    out = DUMPS / f"p0_{os_name}_{stamp}.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False)[:1_000_000], encoding="utf-8")
    (RAW / f"p0_{os_name}_{stamp}.json").write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
    return out
