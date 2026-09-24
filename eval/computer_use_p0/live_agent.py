"""Where the packaged Nia gateway is actually running from.

The Electron shell is always /Applications/Nia.app (or Nia.exe). Python is
the extracted copy at ~/.hermes/hermes-agent unless this checkout is bound
via HERMES_DESKTOP_HERMES_ROOT (preferred) or rsync into the extracted tree.
Never print tokens.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

CHECKOUT = Path(__file__).resolve().parents[2]
ACTIVE = Path.home() / ".hermes" / "hermes-agent"
BIND_LOG = Path("/tmp/nia-p0-bind.log") if sys.platform != "win32" else Path(os.environ.get("TEMP", ".") ) / "nia-p0-bind.log"


def _run(cmd: list[str], timeout: float = 10) -> str:
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return (r.stdout or r.stderr or "").strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _has_pin(root: Path) -> str:
    for rel in ("hermes_cli/tools_config_cua.py", "hermes_cli/tools_config.py"):
        path = root / rel
        if not path.exists():
            continue
        try:
            if "PINNED_CUA_DRIVER_VERSION" in path.read_text(encoding="utf-8"):
                return "0.28.2"
        except OSError:
            return "unreadable"
    return "missing" if not (root / "hermes_cli" / "tools_config.py").exists() else "unpinned"


def _serve_pid() -> int | None:
    out = _run(["ps", "-ax", "-o", "pid=,command="]) if sys.platform != "win32" else _run(
        ["wmic", "process", "where", "name='python.exe'", "get", "processid,commandline"]
    )
    for line in out.splitlines():
        if "-m hermes_cli.main" in line and "serve" in line:
            try:
                return int(line.split(None, 1)[0])
            except ValueError:
                continue
    return None


def _safe_env(pid: int) -> dict[str, str]:
    """Read a few env keys from a live process. Skip anything that looks like a token."""
    raw = _run(["ps", "eww", "-p", str(pid)])
    wanted = ("HERMES_DESKTOP_HERMES_ROOT", "PYTHONPATH", "PWD", "HERMES_HOME")
    found: dict[str, str] = {}
    for key in wanted:
        match = re.search(rf"(?:^|\s){re.escape(key)}=([^\s]+)", raw)
        if match:
            val = match.group(1)
            if "TOKEN" in key.upper() or "SECRET" in key.upper() or "KEY" in key.upper():
                continue
            found[key] = val[:300]
    return found


def _bind_stamp() -> dict[str, Any] | None:
    path = ACTIVE / ".p0-checkout-bind"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _checkout_sha() -> str:
    return _run(["git", "-C", str(CHECKOUT), "rev-parse", "HEAD"])[:40]


def _write_bind_stamp(mode: str) -> None:
    ACTIVE.mkdir(parents=True, exist_ok=True)
    payload = {
        "checkout": str(CHECKOUT),
        "sha": _checkout_sha(),
        "mode": mode,
    }
    (ACTIVE / ".p0-checkout-bind").write_text(json.dumps(payload) + "\n", encoding="utf-8")


def nia_executable() -> Path | None:
    if sys.platform == "darwin":
        p = Path("/Applications/Nia.app/Contents/MacOS/Nia")
        return p if p.exists() else None
    if sys.platform == "win32":
        p = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Nia" / "Nia.exe"
        return p if p.is_file() else None
    return None


def quit_nia() -> None:
    if sys.platform == "darwin":
        subprocess.run(
            ["osascript", "-e", 'tell application "Nia" to quit'],
            capture_output=True,
            timeout=15,
        )
        for _ in range(12):
            if not _run(["pgrep", "-x", "Nia"]):
                break
            time.sleep(0.4)
        if _run(["pgrep", "-x", "Nia"]):
            subprocess.run(["killall", "Nia"], capture_output=True, timeout=10)
            time.sleep(1)
        return
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/IM", "Nia.exe", "/F"], capture_output=True, timeout=15)
        time.sleep(2)


def launch_nia_bound() -> None:
    """Start the installed Nia shell with this checkout as the Python root.

    `open -a Nia` drops env, so the packaged app would keep serving ~/.hermes.
    LaunchServices `--env` (macOS 14+) or the inner executable keeps the var.
    """
    env = os.environ.copy()
    env["HERMES_DESKTOP_HERMES_ROOT"] = str(CHECKOUT)
    exe = nia_executable()
    if exe is None:
        raise SystemExit("Installed Nia executable not found")
    BIND_LOG.parent.mkdir(parents=True, exist_ok=True)
    logf = open(BIND_LOG, "ab")
    subprocess.Popen(
        [str(exe)],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=logf,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )


def rsync_checkout_into_active() -> None:
    """Fallback: copy checkout Python into the tree packaged Nia already executes."""
    if not ACTIVE.is_dir():
        raise SystemExit(
            f"No extracted agent at {ACTIVE} — open Nia once so first-run bootstrap can finish, then rerun."
        )
    if sys.platform == "win32":
        subprocess.run(
            [
                "robocopy",
                str(CHECKOUT),
                str(ACTIVE),
                "/E",
                "/XD",
                ".git",
                "venv",
                ".venv",
                "node_modules",
                "eval",
                ".cursor",
                "graphify-out",
            ],
            check=False,
            timeout=180,
        )
        return
    # Exclude `venv` without a trailing slash — checkout venv is a symlink and
    # `venv/` would still copy it over the real extracted venv.
    r = subprocess.run(
        [
            "rsync",
            "-a",
            "--exclude",
            ".git",
            "--exclude",
            "venv",
            "--exclude",
            ".venv",
            "--exclude",
            "node_modules",
            "--exclude",
            "eval",
            "--exclude",
            ".cursor",
            "--exclude",
            "graphify-out",
            f"{CHECKOUT}/",
            f"{ACTIVE}/",
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if r.returncode not in (0,):
        raise SystemExit(f"rsync into {ACTIVE} failed ({r.returncode}): {(r.stderr or r.stdout)[:400]}")


def inspect_backend() -> dict[str, Any]:
    stamp_path = ACTIVE / ".nia-pack-stamp"
    stamp = None
    if stamp_path.exists():
        try:
            stamp = json.loads(stamp_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            stamp = {"raw": stamp_path.read_text(encoding="utf-8")[:200]}
    pid = _serve_pid()
    env = _safe_env(pid) if pid else {}
    pythonpath = (env.get("PYTHONPATH") or "").split(os.pathsep)
    first_path = pythonpath[0] if pythonpath and pythonpath[0] else ""
    override = env.get("HERMES_DESKTOP_HERMES_ROOT") or ""
    cmdline = ""
    if pid:
        cmdline = _run(["ps", "-p", str(pid), "-o", "command="])
        cmdline = re.sub(r"token=[^&\s]+", "token=***", cmdline)
    checkout_s = str(CHECKOUT)
    active_s = str(ACTIVE)
    from_env = bool(
        (override and os.path.realpath(override) == os.path.realpath(CHECKOUT))
        or (first_path and os.path.realpath(first_path) == os.path.realpath(CHECKOUT))
        or (checkout_s in cmdline)
    )
    bind = _bind_stamp()
    sha = _checkout_sha()
    from_rsync = bool(
        bind
        and bind.get("sha") == sha
        and bind.get("mode") == "rsync"
        and _has_pin(ACTIVE) == "0.28.2"
        and pid
        and active_s in cmdline
        and checkout_s not in cmdline
    )
    using_checkout = from_env or from_rsync
    agent_root = override or first_path or (checkout_s if from_env else active_s)
    return {
        "checkout": checkout_s,
        "extracted_active": active_s,
        "pack_stamp": stamp,
        "pin_in_checkout": _has_pin(CHECKOUT),
        "pin_in_extracted_tree": _has_pin(ACTIVE),
        "gateway_pid": pid,
        "gateway_cmd": cmdline[:240],
        "HERMES_DESKTOP_HERMES_ROOT": override,
        "pythonpath0": first_path[:240],
        "agent_root": agent_root,
        "using_this_checkout": using_checkout,
        "bind_mode": "env" if from_env else ("rsync" if from_rsync else ""),
        "bind_stamp": bind,
        "checkout_sha": sha,
        "cua_driver": _run(["cua-driver", "--version"]),
    }


def live_uses_checkout(info: dict[str, Any] | None = None) -> bool:
    data = info or inspect_backend()
    return bool(data.get("using_this_checkout") and data.get("gateway_pid"))


def _checkout_has_venv(root: Path) -> bool:
    for rel in ("venv/bin/python", "venv/bin/python3", ".venv/bin/python"):
        if (root / rel).is_file():
            return True
    return False


def _wait_rsync_gateway(*, wait_s: float) -> dict[str, Any]:
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        info = inspect_backend()
        if live_uses_checkout(info) or (info.get("gateway_pid") and _has_pin(ACTIVE) == "0.28.2"):
            print(f"Gateway pid {info.get('gateway_pid')} serving synced {ACTIVE}", flush=True)
            return inspect_backend()
        time.sleep(0.5)
    return inspect_backend()


def bind_via_rsync(*, wait_s: float = 40) -> dict[str, Any]:
    """Copy this checkout into ~/.hermes (keep venv), then open packaged Nia.

    A bare git worktree has no venv. HERMES_DESKTOP_HERMES_ROOT then starts
    system Python and dies on ``import yaml`` (Nia “couldn't start”).
    """
    if not (CHECKOUT / "hermes_cli" / "main.py").is_file():
        raise SystemExit(f"Not a hermes-agent checkout: {CHECKOUT}")
    print("Quitting Nia", flush=True)
    quit_nia()
    print(f"Rsync {CHECKOUT} -> {ACTIVE} (keep venv)", flush=True)
    rsync_checkout_into_active()
    _write_bind_stamp("rsync")
    if sys.platform == "darwin":
        subprocess.run(["open", "-a", "Nia"], timeout=20)
    else:
        exe = nia_executable()
        if exe is None:
            raise SystemExit("Installed Nia executable not found")
        env = os.environ.copy()
        env.pop("HERMES_DESKTOP_HERMES_ROOT", None)
        BIND_LOG.parent.mkdir(parents=True, exist_ok=True)
        logf = open(BIND_LOG, "ab")
        subprocess.Popen(
            [str(exe)],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=logf,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    return _wait_rsync_gateway(wait_s=wait_s)


def bind_checkout(*, wait_s: float = 40) -> dict[str, Any]:
    """Quit Nia, start the installed app on this checkout's Python, wait for serve."""
    if not (CHECKOUT / "hermes_cli" / "main.py").is_file():
        raise SystemExit(f"Not a hermes-agent checkout: {CHECKOUT}")
    if not _checkout_has_venv(CHECKOUT):
        print("Checkout has no venv; rsync into ~/.hermes", flush=True)
        return bind_via_rsync(wait_s=wait_s)
    print("Quitting Nia", flush=True)
    quit_nia()
    print(f"Launching installed Nia with HERMES_DESKTOP_HERMES_ROOT={CHECKOUT}", flush=True)
    launch_nia_bound()
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        info = inspect_backend()
        if live_uses_checkout(info):
            _write_bind_stamp("env")
            print(f"Gateway pid {info['gateway_pid']} is this checkout", flush=True)
            return inspect_backend()
        time.sleep(0.5)
    print("Env bind did not stick; copying checkout into ~/.hermes (keep venv)", flush=True)
    return bind_via_rsync(wait_s=wait_s)


def require_checkout_backend() -> dict[str, Any]:
    info = inspect_backend()
    if os.environ.get("P0_ALLOW_PACKAGED") == "1":
        return info
    if live_uses_checkout(info):
        return info
    raise SystemExit(
        "Packaged Nia is not serving this checkout's Python "
        f"(agent_root={info.get('agent_root')}, checkout={CHECKOUT}). "
        "Harness files in eval/computer_use_p0 already run live. Agent edits "
        "do not, until Nia is bound:\n"
        "  eval/computer_use_p0/bind_checkout.sh\n"
        "That relaunches Nia.app (same installed shell, this folder's Python). "
        "No DMG reinstall. Set P0_ALLOW_PACKAGED=1 only to score the extracted copy."
    )


def ensure_bound_backend() -> dict[str, Any]:
    if os.environ.get("P0_ALLOW_PACKAGED") == "1":
        return inspect_backend()
    info = inspect_backend()
    if live_uses_checkout(info):
        return info
    info = bind_checkout()
    if live_uses_checkout(info):
        return info
    raise SystemExit(
        "Could not bind packaged Nia to this checkout. "
        f"Last inspect: pid={info.get('gateway_pid')} root={info.get('agent_root')} "
        f"cmd={info.get('gateway_cmd')}"
    )


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "inspect"
    if cmd == "bind":
        info = bind_checkout()
        print(json.dumps({k: v for k, v in info.items() if k != "pack_stamp"}, default=str))
        return 0 if live_uses_checkout(info) else 1
    print(json.dumps(inspect_backend(), default=str, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
