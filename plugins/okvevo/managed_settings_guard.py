"""Public builds: the agent cannot change settings OkVevo manages.

First layer only. The desktop app re-applies the same keys whenever any
``config.yaml`` changes (``apps/desktop/electron/okvevo-config-migration.ts``),
so a ``sed`` / Python edit that slips past this hook is still reverted.

Managed keys are every leaf in ``okvevo/config/okvevo-defaults.yaml``.
``image_gen.model`` is not one of them: the agent may switch it, but only to a
model the portal quote accepts, so a model the portal cannot price never
replaces a working one.

Matches command tokens, not prose: ``echo "run hermes config set ..."`` passes.
Credential files (.env, auth.json, token files) are ``secrets_guard.py``'s job
on every build. Internal builds (``OKVEVO_BUILD_CHANNEL=internal``) skip this hook.
"""
from __future__ import annotations

import ast
import os
import shlex
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

import hermes_yaml as yaml

MANAGED_MESSAGE = "This setting is managed by OkVevo."

_GUARDED_TOOLS = frozenset({"terminal", "execute_code", "write_file", "patch"})
_DEFAULTS_PATH = Path(__file__).resolve().parents[2] / "okvevo" / "config" / "okvevo-defaults.yaml"
_WRAPPERS = frozenset({"sudo", "env", "command", "exec", "nohup", "time"})
_PYTHONS = frozenset({"python", "python3", "python.exe", "python3.exe", "py"})
_PROFILE_FLAGS = frozenset({"-p", "--profile"})
_IMAGE_MODEL_KEY = "image_gen.model"
_REQUIRED_PROVIDER = "okvevo"
_REQUIRED_PLUGIN = "okvevo"


def _leaves(tree: Any, prefix: str = "") -> Iterable[tuple[str, Any]]:
    if isinstance(tree, dict) and tree:
        for key, value in tree.items():
            yield from _leaves(value, f"{prefix}.{key}" if prefix else str(key))
    elif prefix:
        yield prefix, tree


@lru_cache(maxsize=1)
def _managed_defaults() -> dict[str, Any]:
    return dict(_leaves(yaml.safe_load(_DEFAULTS_PATH.read_text(encoding="utf-8")) or {}))


def _is_managed_key(key: str) -> bool:
    key = key.strip().strip(".")
    if not key or key == _IMAGE_MODEL_KEY:
        return False
    return any(leaf == key or leaf.startswith(key + ".") or key.startswith(leaf + ".")
               for leaf in _managed_defaults())


def _blocked(message: str = MANAGED_MESSAGE) -> dict[str, str]:
    return {"action": "block", "message": message}


# --- commands -------------------------------------------------------------------------------------

def _segments(text: str) -> Iterable[list[str]]:
    """Shell-ish command segments split on newlines, ``;``, ``&&``, ``||``, ``|``."""
    for line in (text or "").splitlines():
        try:
            lex = shlex.shlex(line, posix=True, punctuation_chars=";&|")
            lex.whitespace_split = True
            tokens = list(lex)
        except ValueError:
            tokens = line.split()
        current: list[str] = []
        for token in tokens:
            if token and set(token) <= set(";&|"):
                if current:
                    yield current
                current = []
            else:
                current.append(token)
        if current:
            yield current


def _hermes_args(tokens: list[str]) -> Optional[list[str]]:
    """Arguments after ``hermes`` when this segment runs the Hermes CLI, else None."""
    i = 0
    while i < len(tokens) and (tokens[i] in _WRAPPERS or ("=" in tokens[i] and not tokens[i].startswith("-"))):
        i += 1
    if i >= len(tokens):
        return None
    head = Path(tokens[i]).name.lower()
    if head in ("hermes", "hermes.exe"):
        return tokens[i + 1:]
    if head in _PYTHONS and tokens[i + 1:i + 2] == ["-m"] and tokens[i + 2:i + 3] \
            and tokens[i + 2].split(".")[0] == "hermes_cli":
        return tokens[i + 3:]
    return None


def _positional(args: list[str]) -> list[str]:
    out: list[str] = []
    skip = False
    for token in args:
        if skip:
            skip = False
            continue
        if token in _PROFILE_FLAGS:
            skip = True
            continue
        out.append(token)
    return out


def _flag_value(args: list[str], flag: str) -> Optional[str]:
    for i, token in enumerate(args):
        if token == flag and i + 1 < len(args):
            return args[i + 1]
        if token.startswith(flag + "="):
            return token.split("=", 1)[1]
    return None


def _check_image_model(model_id: str) -> Optional[dict[str, str]]:
    from plugins.okvevo.gateway import okvevo_fal_quote, okvevo_image_endpoint

    credits, reason = okvevo_fal_quote(okvevo_image_endpoint(model_id), {"prompt": "model check", "num_images": 1})
    if credits is not None:
        return None
    return _blocked(
        f"OkVevo can't use image model {model_id} ({reason}). The current image model was kept."
    )


def _check_hermes(args: list[str]) -> Optional[dict[str, str]]:
    words = _positional(args)
    if not words:
        return None
    sub = words[0]
    if sub == "auth":
        return _blocked()
    if sub == "config" and len(words) >= 3 and words[1] in ("set", "unset"):
        key = words[2]
        if _is_managed_key(key):
            return _blocked()
        if key.strip() == _IMAGE_MODEL_KEY and words[1] == "set" and len(words) >= 4:
            return _check_image_model(words[3])
        return None
    if sub == "model":
        provider = _flag_value(args, "--provider")
        if provider is not None and provider.strip().lower() != _REQUIRED_PROVIDER:
            return _blocked()
        return None
    if sub == "plugins" and len(words) >= 3 and words[1] in ("enable", "disable") \
            and words[2] == _REQUIRED_PLUGIN:
        return _blocked()
    return None


def _check_command_text(text: str) -> Optional[dict[str, str]]:
    for tokens in _segments(text):
        args = _hermes_args(tokens)
        if args is not None:
            verdict = _check_hermes(args)
            if verdict:
                return verdict
    return None


def _code_commands(code: str) -> Iterable[str]:
    """String literals (and argv lists) in Python source, the only place a command can hide."""
    try:
        tree = ast.parse(code or "")
    except SyntaxError:
        yield code or ""
        return
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, (ast.List, ast.Tuple)):
            parts = [elt.value for elt in node.elts if isinstance(elt, ast.Constant) and isinstance(elt.value, str)]
            if parts and len(parts) == len(node.elts):
                yield shlex.join(parts)


# --- config.yaml writes ---------------------------------------------------------------------------

def _is_hermes_config(path_text: str) -> bool:
    from hermes_constants import get_default_hermes_root

    path = Path(os.path.expanduser(path_text or "")).resolve()
    if path.name != "config.yaml":
        return False
    root = get_default_hermes_root().resolve()
    return path.parent == root or path.parent.parent == root / "profiles"


def _managed_values(text: str) -> Optional[dict[str, Any]]:
    try:
        tree = yaml.safe_load(text or "") or {}
    except yaml.YAMLError:
        return None
    if not isinstance(tree, dict):
        return None
    flat = dict(_leaves(tree))
    return {leaf: flat.get(leaf) for leaf in _managed_defaults()}


def _check_config_write(path_text: str, new_text: str) -> Optional[dict[str, str]]:
    path = Path(os.path.expanduser(path_text))
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    before, after = _managed_values(current), _managed_values(new_text)
    if after is None or before != after:
        return _blocked()
    return None


def _v4a_targets(patch: str) -> Iterable[str]:
    for line in (patch or "").splitlines():
        for marker in ("*** Update File:", "*** Add File:", "*** Delete File:", "*** Move to:"):
            if line.startswith(marker):
                yield line[len(marker):].strip()


def _check_file_tool(tool_name: str, args: dict) -> Optional[dict[str, str]]:
    if tool_name == "patch" and args.get("mode") == "patch":
        # A V4A patch cannot be replayed here; it may not touch config.yaml at all.
        if any(_is_hermes_config(target) for target in _v4a_targets(str(args.get("patch") or ""))):
            return _blocked()
        return None
    path_text = str(args.get("path") or "")
    if not _is_hermes_config(path_text):
        return None
    if tool_name == "write_file":
        return _check_config_write(path_text, str(args.get("content") or ""))
    path = Path(os.path.expanduser(path_text))
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    old, new = str(args.get("old_string") or ""), str(args.get("new_string") or "")
    if not old or old not in current:
        return _blocked()
    return _check_config_write(path_text, current.replace(old, new, 1))


def on_pre_tool_call(tool_name: str = "", args: Any = None, **_: Any) -> Optional[dict[str, str]]:
    from plugins.okvevo.gateway import okvevo_is_internal_channel

    if tool_name not in _GUARDED_TOOLS or okvevo_is_internal_channel() or not isinstance(args, dict):
        return None
    if tool_name == "terminal":
        return _check_command_text(str(args.get("command") or ""))
    if tool_name == "execute_code":
        for text in _code_commands(str(args.get("code") or "")):
            verdict = _check_command_text(text)
            if verdict:
                return verdict
        return None
    return _check_file_tool(tool_name, args)
