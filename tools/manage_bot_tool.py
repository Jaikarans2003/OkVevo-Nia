#!/usr/bin/env python3
"""First-class bot tool — create/list/update without touching internals files.

Public builds block raw file/shell access to the agent data folder. This is
the least-privilege replacement: brand-safe JSON only, no paths, model,
provider, or settings filenames.
"""

from __future__ import annotations

import json
import re

from tools.registry import registry, tool_error

_BOT_SLUG_RE = re.compile(r"[^a-z0-9_-]+")
_FORBIDDEN_KEYS = frozenset({
    "path", "model", "provider", "env", "alias", "skills", "mirrored",
})


def _slug_bot_name(raw: str) -> str:
    text = (raw or "").strip().lower()
    text = _BOT_SLUG_RE.sub("-", text).strip("-_")
    if not text:
        raise ValueError("name required")
    return text[:64]


def _compose_soul(name: str, role: str, personality: str) -> str:
    """Bot SOUL.md: always opens with "You are <name>, <role>." so the bot
    self-identifies even when the personality text never names it."""
    personality = (personality or "").strip()
    role = (role or "").strip()
    who = (name or "").strip()
    if who and role:
        lead = f"You are {who}, {role}."
    elif who:
        lead = f"You are {who}."
    elif role:
        lead = f"You are {role}."
    else:
        lead = ""
    if not personality:
        return lead
    if not lead or personality.lower().startswith(f"you are {who.lower()}"):
        return personality
    return f"{lead} {personality}"


def _safe_error(message: str) -> str:
    return json.dumps({"ok": False, "error": message}, ensure_ascii=False)


def _public_view(*, bot: str, description: str = "", **extra: object) -> dict:
    view = {"ok": True, "bot": bot, "description": description or ""}
    view.update(extra)
    return view


def _scrub_payload(payload: object) -> object:
    """Drop forbidden keys and scrub string values — never regex the JSON envelope."""
    if isinstance(payload, dict):
        return {
            key: _scrub_payload(value)
            for key, value in payload.items()
            if str(key).lower() not in _FORBIDDEN_KEYS
        }
    if isinstance(payload, list):
        return [_scrub_payload(item) for item in payload]
    if isinstance(payload, str):
        try:
            from agent.brand_scrub import sanitize_user_facing_brand

            return sanitize_user_facing_brand(payload)
        except Exception:
            return payload
    return payload


def _dumps(payload: dict) -> str:
    return json.dumps(_scrub_payload(payload), ensure_ascii=False)


def _create(name: str, role: str, personality: str, description: str) -> str:
    from hermes_cli.profiles import provision_named_profile, write_profile_meta

    display = (name or "").strip()
    if not display:
        return _safe_error("A bot needs a name.")
    try:
        slug = _slug_bot_name(display)
    except ValueError:
        return _safe_error("A bot needs a name.")
    desc = (description or role or "").strip()
    soul = _compose_soul(display, role, personality)
    try:
        provision_named_profile(
            name=slug,
            description=desc or None,
            soul=soul or None,
            mirror_credentials=True,
            share_auth=True,
        )
        from hermes_cli.profiles import get_profile_dir

        write_profile_meta(get_profile_dir(slug), display_name=display)
    except FileExistsError:
        return _safe_error(f"A bot called {display} already exists.")
    except (ValueError, FileNotFoundError):
        return _safe_error("Use a different bot name.")
    except Exception:
        return _safe_error("Could not create that bot. Try again from the bots list.")
    return _dumps(_public_view(bot=display, description=desc))


def _list() -> str:
    from hermes_cli.profiles import list_profiles

    bots = []
    for profile in list_profiles():
        if profile.is_default:
            continue
        display = (getattr(profile, "display_name", "") or "").strip() or profile.name
        bots.append({
            "name": profile.name,
            "display_name": display,
            "description": getattr(profile, "description", "") or "",
        })
    return _dumps({"ok": True, "bots": bots})


def _update(name: str, role: str, personality: str, description: str) -> str:
    from hermes_cli.profiles import (
        get_profile_dir,
        normalize_profile_name,
        update_named_profile_identity,
        validate_profile_name,
    )
    from hermes_constants import named_profile_is_deleted

    display = (name or "").strip()
    if not display:
        return _safe_error("Which bot should I update?")
    try:
        slug = normalize_profile_name(_slug_bot_name(display))
        validate_profile_name(slug)
    except ValueError:
        return _safe_error("Use a different bot name.")
    profile_dir = get_profile_dir(slug)
    if not profile_dir.is_dir() or named_profile_is_deleted(profile_dir):
        return _safe_error(f"I could not find a bot called {display}.")
    soul = (personality or "").strip() or None
    if soul is None and (role or "").strip() and not (personality or "").strip():
        soul = _compose_soul(display, role, "")
    desc = (description or "").strip()
    desc_arg = desc if description else None
    if desc_arg is None and (role or "").strip() and not description:
        desc_arg = (role or "").strip()
    try:
        update_named_profile_identity(
            slug,
            soul=soul,
            description=desc_arg,
            display_name=display if display else None,
        )
    except FileNotFoundError:
        return _safe_error(f"I could not find a bot called {display}.")
    except Exception:
        return _safe_error("Could not update that bot. Try again from the bots list.")
    from hermes_cli.profiles import read_profile_meta

    meta = read_profile_meta(profile_dir)
    shown = (meta.get("display_name") or "").strip() or display
    shown_desc = (meta.get("description") or "").strip()
    return _dumps(_public_view(bot=shown, description=shown_desc))


def manage_bot_tool(
    action: str = "",
    name: str = "",
    role: str = "",
    personality: str = "",
    description: str = "",
) -> str:
    action = (action or "").strip().lower()
    if action == "create":
        return _create(name, role, personality, description)
    if action == "list":
        return _list()
    if action == "update":
        return _update(name, role, personality, description)
    return tool_error("action must be create, list, or update.")


MANAGE_BOT_SCHEMA = {
    "name": "manage_bot",
    "description": (
        "Create, list, or update Nia bots (teammates). Use this instead of "
        "editing files or running CLI commands. create/update take a name, "
        "role, personality (the bot's voice), and a short description. "
        "When creating a bot, always supply role AND a full personality: "
        "write it in second person as the bot's own persona (expertise, how "
        "it thinks, tone, what it pushes back on, how it introduces itself) — "
        "never as Nia and never in Nia's voice. Results name the bot only — "
        "never files, models, or settings."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["create", "list", "update"],
                "description": "create a bot, list bots, or update an existing bot.",
            },
            "name": {
                "type": "string",
                "description": "Bot name (required for create and update).",
            },
            "role": {
                "type": "string",
                "description": "Job or role, e.g. 'CFO of OkVevo'. Always set on create.",
            },
            "personality": {
                "type": "string",
                "description": (
                    "The bot's own persona, 3-8 sentences, second person: "
                    "domain expertise, how it reasons, tone, and how it "
                    "introduces itself by name and role. Always set on create."
                ),
            },
            "description": {
                "type": "string",
                "description": "Optional one-line description.",
            },
        },
        "required": ["action"],
    },
}


registry.register(
    name="manage_bot",
    toolset="bots",
    schema=MANAGE_BOT_SCHEMA,
    handler=lambda args, **kw: manage_bot_tool(
        action=args.get("action", ""),
        name=args.get("name", ""),
        role=args.get("role", ""),
        personality=args.get("personality", ""),
        description=args.get("description", ""),
    ),
    emoji="🤖",
)
