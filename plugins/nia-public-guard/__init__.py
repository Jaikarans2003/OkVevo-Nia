"""nia-public-guard — least-privilege internals policy for public Nia builds.

OWASP LLM02 (Sensitive Information Disclosure) defense in depth:

* ``pre_tool_call`` — block file/shell access to the agent data folder and
  the ``hermes`` CLI; redirect bot work to ``manage_bot``.
* ``transform_tool_result`` / ``transform_terminal_output`` — redact secrets.
  Absolute paths stay absolute so a later ``~`` expansion cannot drop
  ``.hermes`` from a generated-media path.
* ``transform_llm_output`` — brand/internals scrub persisted with the turn.
* ``post_llm_call`` — optional fire-and-forget Jev leak classify (off unless
  ``NIA_JEV_LEAK_CLASSIFY=1`` and an OpenRouter key is present). Never rewrites.

All hooks no-op when ``nia_is_internal_channel()`` is true.
"""

from __future__ import annotations

import glob as glob_mod
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

_tls = threading.local()
_JEV_CLASSIFY_TRUTHY = frozenset({"1", "true", "yes", "on"})
_GLOB_EXPAND_CAP = 64

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

# Settings filenames only count under agent home (see _token_is_hermes_home).
_SENSITIVE_BASENAMES = frozenset({
    ".env",
    "auth.json",
    "config.yaml",
    "profile.yaml",
})

# Auth token files — block by basename anywhere (not only under .hermes).
_ABSOLUTE_BLOCK_BASENAMES = frozenset({
    "okvevo-firebase-id-token",
    "okvevo-firebase-refresh-token",
})

_TOKEN_ENV_NAMES = frozenset({
    "OKVEVO_FIREBASE_ID_TOKEN_FILE",
    "OKVEVO_FIREBASE_REFRESH_TOKEN_FILE",
})

# Shell globs that target the agent home even when expand yields nothing.
_HERMES_HOME_GLOB_RE = re.compile(
    r"(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|%HOMEPATH%)[/\\]\.h[^\s'\"`;|&<>)]*",
    re.IGNORECASE,
)

# Env / user-data path forms that name the token file or HERMES_HOME token path.
_TOKEN_ENV_REF_RE = re.compile(
    r"(?:"
    r"\$\{?(?:OKVEVO_FIREBASE_(?:ID|REFRESH)_TOKEN_FILE)\}?"
    r"|%OKVEVO_FIREBASE_(?:ID|REFRESH)_TOKEN_FILE%"
    r"|\$\{?HERMES_HOME\}?[/\\][^\s'\"`;|&<>)]*okvevo-firebase-(?:id|refresh)-token"
    r"|%HERMES_HOME%[/\\][^\s'\"`;|&<>)]*okvevo-firebase-(?:id|refresh)-token"
    r")",
    re.IGNORECASE,
)


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


def _user_data_prefixes() -> List[Path]:
    """Electron userData root from NIA_USER_DATA_DIR (never hard-coded)."""
    raw = (os.environ.get("NIA_USER_DATA_DIR") or "").strip()
    if not raw:
        return []
    path = Path(raw)
    out = [path]
    try:
        out.append(path.resolve())
    except OSError:
        pass
    return out


def _protected_prefixes() -> List[Path]:
    return _hermes_home_prefixes() + _user_data_prefixes()


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


# Path-shaped tokens inside a command. A string-prefix check is not used to
# decide the generated-media allow; that decision is resolve + is_relative_to.
# Also captures $HOME/... and %USERPROFILE%\... so shell-env path forms enter
# the same glob/resolve pipeline as ~/...
_PATH_TOKEN_RE = re.compile(
    r"(?:"
    r"~[/\\][^\s'\"`;|&<>)]+"
    r"|\$\{?(?:HOME|HERMES_HOME|USERPROFILE|OKVEVO_FIREBASE_(?:ID|REFRESH)_TOKEN_FILE)\}?"
    r"(?:[/\\][^\s'\"`;|&<>)]*)?"
    r"|%(?:HOME|HERMES_HOME|USERPROFILE|OKVEVO_FIREBASE_(?:ID|REFRESH)_TOKEN_FILE)%"
    r"(?:[/\\][^\s'\"`;|&<>)]*)?"
    r"|/(?:[^\s'\"`;|&<>)]+)"
    r"|[A-Za-z]:[/\\][^\s'\"`;|&<>)]+"
    r"|\.\.?[/\\][^\s'\"`;|&<>)]+"
    r")"
)


def _path_tokens(text: str) -> List[str]:
    tokens: List[str] = []
    for match in _PATH_TOKEN_RE.finditer(text or ""):
        token = match.group(0).rstrip("),]}>'\"")
        if token:
            tokens.append(token)
    return tokens


def _tool_cwd(args: Any) -> Optional[Path]:
    if not isinstance(args, dict):
        return None
    for key in ("cwd", "working_directory", "workdir"):
        raw = args.get(key)
        if isinstance(raw, str) and raw.strip():
            try:
                return Path(os.path.expanduser(os.path.expandvars(raw.strip()))).resolve()
            except (OSError, RuntimeError, ValueError):
                return Path(raw.strip())
    return None


def _try_resolve(token: str, *, cwd: Optional[Path] = None) -> Optional[Path]:
    candidate = _normalize_candidate(token)
    if not candidate:
        return None
    try:
        path = Path(candidate)
        if not path.is_absolute() and cwd is not None:
            path = cwd / path
        return path.resolve()
    except (OSError, RuntimeError, ValueError):
        return None


def _has_glob_meta(token: str) -> bool:
    return any(ch in token for ch in "*?[")


def _glob_expand(token: str) -> List[str]:
    """Expand shell globs under expanduser/expandvars; cap at ``_GLOB_EXPAND_CAP``."""
    pattern = os.path.expanduser(os.path.expandvars(token.strip()))
    if not pattern or not _has_glob_meta(pattern):
        return []
    try:
        matches = glob_mod.glob(pattern)
    except (OSError, ValueError, re.error):
        return []
    return matches[:_GLOB_EXPAND_CAP]


def _generated_roots() -> List[Path]:
    roots: List[Path] = []
    for prefix in _hermes_home_prefixes():
        try:
            roots.append((prefix / "cache" / "generated").resolve())
        except OSError:
            roots.append(prefix / "cache" / "generated")
    return roots


def _is_generated_deliverable(resolved: Path) -> bool:
    """True only when *resolved* is inside ``cache/generated`` after symlink follow."""
    for root in _generated_roots():
        try:
            if resolved.is_relative_to(root):
                return True
        except (ValueError, OSError):
            continue
    return False


def _under_protected_root(resolved: Path) -> bool:
    for prefix in _protected_prefixes():
        try:
            root = prefix.resolve()
        except OSError:
            root = prefix
        try:
            if resolved.is_relative_to(root):
                return True
        except (ValueError, OSError):
            continue
    return False


def _basename_blocked(token: str) -> bool:
    candidate = _normalize_candidate(token) or token.strip().replace("\\", "/")
    if not candidate:
        return False
    name = Path(candidate).name.lower()
    # Bare env-expanded path may be just the token file name.
    if name in _ABSOLUTE_BLOCK_BASENAMES:
        return True
    # Unexpanded $VAR forms: basename of the literal string.
    raw_name = Path(token.strip().replace("\\", "/")).name.lower()
    return raw_name in _ABSOLUTE_BLOCK_BASENAMES


def _text_names_token_env(text: str) -> bool:
    if _TOKEN_ENV_REF_RE.search(text or ""):
        return True
    upper = (text or "").upper()
    for name in _TOKEN_ENV_NAMES:
        if name in upper:
            return True
    return False


def _token_is_hermes_home(token: str, *, cwd: Optional[Path] = None) -> bool:
    if _basename_blocked(token):
        return True
    if _HERMES_HOME_GLOB_RE.search(token):
        return True
    if _has_glob_meta(token):
        for match in _glob_expand(token):
            if _basename_blocked(match):
                return True
            resolved_match = _try_resolve(match, cwd=cwd)
            if resolved_match is not None:
                if _is_generated_deliverable(resolved_match):
                    continue
                if _under_protected_root(resolved_match):
                    return True
            lowered_match = _normalize_candidate(match).lower()
            if "/.hermes" in lowered_match or lowered_match.endswith(".hermes"):
                return True
    resolved = _try_resolve(token, cwd=cwd)
    # Deliverables under cache/generated may be read or copied. A symlink that
    # points at settings resolves outside that folder and stays blocked.
    if resolved is not None and _is_generated_deliverable(resolved):
        return False
    candidate = _normalize_candidate(token)
    if not candidate and cwd is not None and not Path(token).is_absolute():
        resolved = _try_resolve(token, cwd=cwd)
        candidate = _normalize_candidate(str(resolved)) if resolved else ""
    if not candidate:
        return False
    lowered = candidate.lower()
    if "hermes_home" in lowered:
        return True
    if resolved is not None and _under_protected_root(resolved):
        return True
    if "/.hermes" in lowered or lowered.endswith(".hermes") or lowered.startswith(".hermes"):
        return True
    basename = Path(candidate).name.lower()
    if basename in _SENSITIVE_BASENAMES:
        # Bare settings filenames only count when they sit under the agent home
        # (already returned) or are written as ~/.hermes/... (already returned).
        # A user's project config.yaml must remain editable.
        return False
    return False


def _path_is_hermes_home(text: str, *, cwd: Optional[Path] = None) -> bool:
    if _text_names_token_env(text):
        return True
    if _HERMES_HOME_GLOB_RE.search(text or ""):
        return True
    tokens = _path_tokens(text)
    if tokens:
        return any(_token_is_hermes_home(token, cwd=cwd) for token in tokens)
    # Whole-arg relative paths (read_file path=../../.hermes/...).
    stripped = (text or "").strip()
    if stripped and (
        stripped.startswith(".")
        or "/" in stripped
        or "\\" in stripped
        or _basename_blocked(stripped)
    ):
        return _token_is_hermes_home(stripped, cwd=cwd)
    return _token_is_hermes_home(text, cwd=cwd)


def _invokes_hermes_cli(text: str) -> bool:
    return bool(_HERMES_CLI_RE.search(text or ""))


def _args_touch_internals(args: Any) -> bool:
    cwd = _tool_cwd(args)
    for text in _walk_strings(args):
        if _path_is_hermes_home(text, cwd=cwd) or _invokes_hermes_cli(text):
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


def _redact_and_collapse(text: str) -> str:
    from agent.redact import redact_sensitive_text

    # Paint-only tildes live in displayPath. The tool string the model and the
    # UI both store stays the absolute path save_generated_url wrote.
    return redact_sensitive_text(text, force=True, file_read=True)


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
        _tls.regex_rewrote = False
        return None
    if not response_text:
        _tls.regex_rewrote = False
        return None
    from agent.brand_scrub import sanitize_user_facing_brand

    scrubbed = sanitize_user_facing_brand(response_text)
    rewrote = scrubbed != response_text
    _tls.regex_rewrote = rewrote
    return scrubbed if rewrote else None


def _jev_classify_enabled() -> bool:
    raw = (os.environ.get("NIA_JEV_LEAK_CLASSIFY") or "0").strip().lower()
    if raw not in _JEV_CLASSIFY_TRUTHY:
        return False
    try:
        from tools.openrouter_client import check_api_key

        return bool(check_api_key())
    except Exception:
        return False


def _shadow_classify(text: str, regex_rewrote: bool) -> None:
    try:
        from tools.openrouter_decisions import classify_leak

        result = classify_leak(text)
        if result is None:
            logger.debug(
                "jev leak classify skipped regex_rewrote=%s", regex_rewrote
            )
            return
        answers = result.get("answers") or {}
        leak = answers.get("is_leak") or {}
        logger.debug(
            "jev leak classify regex_rewrote=%s jev_choice=%s jev_confidence=%s nouls=%s",
            regex_rewrote,
            leak.get("choice"),
            leak.get("confidence"),
            {
                "hermes_brand": (answers.get("hermes_brand") or {}).get("noul"),
                "internal_mechanism": (answers.get("internal_mechanism") or {}).get(
                    "noul"
                ),
                "tooling_or_paths": (answers.get("tooling_or_paths") or {}).get("noul"),
            },
        )
    except Exception:
        logger.debug("jev leak classify failed", exc_info=True)


def _on_post_llm_call(assistant_response: Any = None, **_: Any) -> None:
    if not _public_channel():
        return None
    if not isinstance(assistant_response, str) or not assistant_response:
        return None
    if not _jev_classify_enabled():
        return None
    regex_rewrote = bool(getattr(_tls, "regex_rewrote", False))
    threading.Thread(
        target=_shadow_classify,
        args=(assistant_response, regex_rewrote),
        daemon=True,
        name="nia-jev-leak",
    ).start()
    return None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("transform_tool_result", _on_transform_tool_result)
    ctx.register_hook("transform_terminal_output", _on_transform_terminal_output)
    ctx.register_hook("transform_llm_output", _on_transform_llm_output)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
