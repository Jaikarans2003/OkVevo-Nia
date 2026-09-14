"""nia-public-guard — least-privilege internals policy for public Nia builds.

OWASP LLM02 (Sensitive Information Disclosure) defense in depth:

* ``pre_tool_call`` — block file/shell access to the agent data folder and
  the ``hermes`` CLI; redirect bot work to ``manage_bot``.
* ``transform_tool_result`` / ``transform_terminal_output`` — redact secrets
  and collapse absolute home paths before the model sees them.
* ``transform_llm_output`` — brand/internals scrub persisted with the turn.

All hooks no-op when ``nia_is_internal_channel()`` is true.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

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
    "Use manage_bot for bots; settings are managed in the app."
)

_HERMES_CLI_RE = re.compile(
    r"(?:^|[\n;&|`]|\b(?:sudo|command|time|nohup)\s+|(?:&&|\|\|)\s*)"
    r"hermes(?:\s|$)|"
    r"python(?:3)?\s+-m\s+hermes(?:_cli)?\b|"
    r"\bhermes\s+-[a-zA-Z]*p\b",
    re.IGNORECASE,
)

_SENSITIVE_BASENAMES = frozenset({
    ".env",
    "auth.json",
    "config.yaml",
    "profile.yaml",
})


def _public_channel() -> bool:
    try:
        from agent.okvevo_gateway import nia_is_internal_channel

        return not nia_is_internal_channel()
    except Exception:
        # Fail closed for the public product: missing helper → treat as public.
        return (os.environ.get("NIA_BUILD_CHANNEL") or "").strip().lower() != "internal"


def _hermes_home_prefixes() -> List[Path]:
    prefixes: List[Path] = []
    try:
        from hermes_constants import get_hermes_home

        home = get_hermes_home()
        prefixes.append(home)
        try:
            prefixes.append(home.resolve())
        except OSError:
            pass
    except Exception:
        pass
    env_home = (os.environ.get("HERMES_HOME") or "").strip()
    if env_home:
        prefixes.append(Path(env_home))
    prefixes.append(Path.home() / ".hermes")
    # Dedup while preserving order (longest match is decided per path later).
    seen: set[str] = set()
    out: List[Path] = []
    for item in prefixes:
        key = str(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


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


def _normalize_candidate(text: str) -> str:
    expanded = os.path.expanduser(os.path.expandvars(text.strip()))
    return expanded.replace("\\", "/")


def _path_is_hermes_home(text: str) -> bool:
    candidate = _normalize_candidate(text)
    if not candidate:
        return False
    lowered = candidate.lower()
    if "hermes_home" in lowered:
        return True
    if "/.hermes" in lowered or lowered.endswith(".hermes") or lowered.startswith(".hermes"):
        return True
    try:
        resolved = Path(candidate).expanduser()
        try:
            resolved = resolved.resolve()
        except OSError:
            pass
        for prefix in _hermes_home_prefixes():
            try:
                resolved.relative_to(prefix)
                return True
            except (ValueError, OSError):
                try:
                    resolved.relative_to(prefix.resolve())
                    return True
                except (ValueError, OSError):
                    continue
    except (OSError, RuntimeError, ValueError):
        pass
    basename = Path(candidate).name.lower()
    if basename in _SENSITIVE_BASENAMES:
        # Bare settings filenames only count when they sit under the agent home
        # (already returned) or are written as ~/.hermes/... (already returned).
        # A user's project config.yaml must remain editable.
        return False
    return False


def _invokes_hermes_cli(text: str) -> bool:
    return bool(_HERMES_CLI_RE.search(text or ""))


def _args_touch_internals(args: Any) -> bool:
    for text in _walk_strings(args):
        if _path_is_hermes_home(text) or _invokes_hermes_cli(text):
            return True
    return False


def _on_pre_tool_call(
    tool_name: str = "",
    args: Any = None,
    **_: Any,
) -> Optional[Dict[str, str]]:
    if not _public_channel():
        return None
    if tool_name not in _GUARDED_TOOLS:
        return None
    if not _args_touch_internals(args):
        return None
    return {"action": "block", "message": _BLOCK_MESSAGE}


def _collapse_home_paths(text: str) -> str:
    if not text:
        return text
    prefixes: List[str] = []
    try:
        from hermes_constants import get_hermes_home

        prefixes.append(str(get_hermes_home()))
        try:
            prefixes.append(str(get_hermes_home().resolve()))
        except OSError:
            pass
    except Exception:
        pass
    prefixes.append(str(Path.home()))
    try:
        prefixes.append(str(Path.home().resolve()))
    except OSError:
        pass
    seen: set[str] = set()
    ordered: List[str] = []
    for prefix in sorted(prefixes, key=len, reverse=True):
        if prefix and prefix not in seen:
            seen.add(prefix)
            ordered.append(prefix)
    for prefix in ordered:
        text = text.replace(prefix, "~")
        text = text.replace(prefix.replace("/", "\\"), "~")
    return text


def _redact_and_collapse(text: str) -> str:
    from agent.redact import redact_sensitive_text

    redacted = redact_sensitive_text(text, force=True, file_read=True)
    return _collapse_home_paths(redacted)


def _on_transform_tool_result(
    tool_name: str = "",
    args: Any = None,
    result: Any = None,
    **_: Any,
) -> Optional[str]:
    if not _public_channel():
        return None
    if not isinstance(result, str) or not result:
        return None
    transformed = _redact_and_collapse(result)
    return transformed if transformed != result else None


def _on_transform_terminal_output(
    command: str = "",
    output: Any = None,
    **_: Any,
) -> Optional[str]:
    if not _public_channel():
        return None
    if not isinstance(output, str) or not output:
        return None
    transformed = _redact_and_collapse(output)
    return transformed if transformed != output else None


def _on_transform_llm_output(
    response_text: str = "",
    **_: Any,
) -> Optional[str]:
    if not _public_channel():
        return None
    if not response_text:
        return None
    from agent.brand_scrub import sanitize_user_facing_brand

    scrubbed = sanitize_user_facing_brand(response_text)
    return scrubbed if scrubbed != response_text else None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("transform_tool_result", _on_transform_tool_result)
    ctx.register_hook("transform_terminal_output", _on_transform_terminal_output)
    ctx.register_hook("transform_llm_output", _on_transform_llm_output)
