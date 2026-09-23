"""Discover a packaged Nia gateway the same way Electron does: HTTP + injected token.

Entry the desktop chat uses (do not use `hermes serve` / Vite dev):

- session.create — apps/desktop/src/app/session/hooks/use-session-actions/index.ts
  desktopSessionCreateParams L247–280, requestGateway session.create L532–538
- prompt.submit — apps/desktop/src/app/session/hooks/use-prompt-actions/submit.ts
  submitParams L756–773, requestGateway L790
- server — tui_gateway/methods_session.py L14 session.create
  tui_gateway/methods_prompt.py L287 prompt.submit
- WS URL — apps/desktop/electron/main.ts L12308
  token scrape — apps/desktop/electron/dashboard-token.ts L38–69
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Optional
from urllib.parse import urlencode

TOKEN_RE = re.compile(
    r"window\.__HERMES_SESSION_TOKEN__\s*=\s*(\"(?:\\.|[^\"\\])*\"|'[^']*')"
)


def _get(url: str, timeout: float = 2.0) -> Optional[str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
        return None


def token_from_html(html: str) -> Optional[str]:
    match = TOKEN_RE.search(html or "")
    if not match:
        return None
    raw = match.group(1)
    try:
        return json.loads(raw) if raw.startswith('"') else raw.strip("'")
    except json.JSONDecodeError:
        return raw.strip("\"'")


def probe_gateway(base_url: str, token: str) -> bool:
    url = base_url.rstrip("/") + "/api/status"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
        html = _get(base_url.rstrip("/") + "/")
        return bool(html and token_from_html(html) == token)


def loopback_listen_ports() -> list[int]:
    ports: set[int] = set()
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["netstat", "-ano", "-p", "tcp"],
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
            )
        except (OSError, subprocess.SubprocessError):
            return []
        for line in out.splitlines():
            if "LISTENING" not in line.upper() and "LISTEN" not in line.upper():
                continue
            if "127.0.0.1" not in line and "[::1]" not in line:
                continue
            parts = line.split()
            for part in parts:
                if ":" in part:
                    try:
                        ports.add(int(part.rsplit(":", 1)[-1]))
                    except ValueError:
                        pass
        return sorted(p for p in ports if p > 0)
    try:
        out = subprocess.check_output(
            ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"],
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    for line in out.splitlines()[1:]:
        if "127.0.0.1" not in line and "[::1]" not in line and "localhost" not in line:
            continue
        # NAME column like 127.0.0.1:36123 (LISTEN)
        match = re.search(r":(\d+)\s+\(LISTEN\)", line)
        if match:
            ports.add(int(match.group(1)))
    return sorted(ports)


def discover(explicit_url: str = "") -> tuple[str, str]:
    """Return (base_url, token) for a live packaged Nia dashboard."""
    if explicit_url:
        base = explicit_url.rstrip("/")
        html = _get(base + "/") or ""
        token = token_from_html(html)
        if not token:
            raise SystemExit(
                f"No window.__HERMES_SESSION_TOKEN__ at {base}/ — is packaged Nia running?"
            )
        return base, token
    env_url = os.environ.get("NIA_GATEWAY_URL", "").strip()
    env_token = os.environ.get("NIA_GATEWAY_TOKEN", "").strip()
    if env_url and env_token:
        return env_url.rstrip("/"), env_token
    for port in loopback_listen_ports():
        base = f"http://127.0.0.1:{port}"
        html = _get(base + "/")
        if not html:
            continue
        if "__HERMES_SESSION_TOKEN__" not in html and "Nia" not in html and "Hermes" not in html:
            continue
        token = token_from_html(html)
        if token:
            return base, token
    raise SystemExit(
        "Packaged Nia gateway not found on 127.0.0.1. Open Nia, sign in, leave it running, then retry."
    )


def ws_url(base_url: str, token: str) -> str:
    host = base_url.replace("http://", "ws://").replace("https://", "wss://").rstrip("/")
    return f"{host}/api/ws?{urlencode({'token': token})}"
