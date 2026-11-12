"""Block file/shell access to credential files only.

Does **not** block the rest of ``~/.hermes``. The dropped ``nia-public-guard``
denied the whole agent home on public builds. Upstream ``agent.file_safety``
already refuses reads of ``.env`` / ``auth.json`` under HERMES_HOME; this hook
also stops the terminal/execute_code bypass and the OkVevo Firebase token files
which file_safety does not know about.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Optional

_BLOCKED_BASENAMES = frozenset({
    ".env",
    "auth.json",
    "okvevo-firebase-id-token",
    "okvevo-firebase-refresh-token",
})

_TOKEN_ENV_MARKERS = (
    "OKVEVO_FIREBASE_ID_TOKEN_FILE",
    "OKVEVO_FIREBASE_REFRESH_TOKEN_FILE",
)

_GUARDED_TOOLS = frozenset({
    "terminal",
    "execute_code",
    "read_file",
    "write_file",
    "patch",
    "list_files",
    "search_files",
})

_BLOCK_MESSAGE = (
    "Access denied: .env, auth.json, and token files cannot be read or written through tools."
)


def _walk_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, dict):
        for nested in value.values():
            yield from _walk_strings(nested)
        return
    if isinstance(value, (list, tuple)):
        for nested in value:
            yield from _walk_strings(nested)


def _name_blocked(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    if any(marker in s for marker in _TOKEN_ENV_MARKERS):
        return True
    normalized = s.replace("\\", "/")
    for raw in normalized.replace(";", " ").replace("|", " ").split():
        name = Path(raw.strip("\"'`")).name.lower()
        if name in _BLOCKED_BASENAMES:
            return True
    return Path(normalized).name.lower() in _BLOCKED_BASENAMES


def on_pre_tool_call(tool_name: str = "", args: Any = None, **_: Any) -> Optional[dict[str, str]]:
    if tool_name not in _GUARDED_TOOLS:
        return None
    for text in _walk_strings(args):
        if _name_blocked(text):
            return {"action": "block", "message": _BLOCK_MESSAGE}
    return None
