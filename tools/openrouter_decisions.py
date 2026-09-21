"""OpenRouter Decisions API helper (Jev). Not chat completions. Not OkVevo-metered."""

from __future__ import annotations

import os
from typing import Any, Mapping, Optional

import httpx

DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
JEV_MODEL = "typesafe/jev-1.13"
DEFAULT_TIMEOUT_S = 2.0
ASSISTANT_STATE_MAX_CHARS = 8000

# Literal criteria: Jev 1.13 answers the words you wrote.
LEAK_DETECT_QUESTIONS: dict[str, Any] = {
    "is_leak": {
        "type": "choice",
        "instructions": (
            "Does the assistant text leak product internals to the user? "
            "Answer leak or clean."
        ),
        "criteria": {
            "leak": (
                "The assistant text names Hermes the product, Nous Research, OpenRouter, "
                "the hermes CLI, agent-home paths such as ~/.hermes, settings filenames "
                ".env config.yaml profile.yaml auth.json, SOUL.md, how bots are stored "
                "in a profiles folder, or tool names write_file terminal skill_view. "
                "Do not treat hermes:// URLs or @hermes/plugin-sdk as a leak."
            ),
            "clean": (
                "User-facing product help. It does not name Hermes the product, Nous, "
                "OpenRouter, the hermes CLI, agent-home paths, those settings filenames, "
                "SOUL.md, internal bot storage, or those tool names. hermes:// links, "
                "@hermes/plugin-sdk, ~/Documents deliverable paths, and GTM plans with "
                "no tools count as clean."
            ),
        },
    },
    "hermes_brand": {
        "type": "noul",
        "instructions": "Does the assistant text name Hermes, Nous Research, or OpenRouter?",
        "criteria": {
            "true": "The text contains Hermes, Nous, or OpenRouter as a product or vendor name.",
            "false": "The text does not name Hermes, Nous, or OpenRouter as a product or vendor.",
        },
    },
    "internal_mechanism": {
        "type": "noul",
        "instructions": (
            "Does the assistant text describe internal agent files, the profiles folder, "
            "SOUL.md, or how bots are stored?"
        ),
        "criteria": {
            "true": (
                "The text describes a profiles folder, SOUL.md, .env, config.yaml, "
                "or how the agent stores bots internally."
            ),
            "false": "The text does not describe those internal files or storage.",
        },
    },
    "tooling_or_paths": {
        "type": "noul",
        "instructions": (
            "Does the assistant text name tools or paste file paths or code the user would run?"
        ),
        "criteria": {
            "true": (
                "The text names write_file, terminal, skill_view, or manage_bot, or pastes "
                "a filesystem path or a fenced code block that writes files."
            ),
            "false": "The text has no tool names, no filesystem paths, and no file-writing code.",
        },
    },
}


def _openrouter_api_key() -> Optional[str]:
    try:
        from agent.secret_scope import UnscopedSecretError, get_secret

        try:
            value = get_secret("OPENROUTER_API_KEY")
            if value:
                return str(value)
        except UnscopedSecretError:
            pass
    except Exception:
        pass
    value = os.getenv("OPENROUTER_API_KEY")
    return value if value else None


def _request_headers(api_key: str) -> dict[str, str]:
    try:
        from agent.auxiliary_client import build_or_headers

        headers = dict(build_or_headers())
    except Exception:
        headers = {}
    headers["Authorization"] = f"Bearer {api_key}"
    headers["Content-Type"] = "application/json"
    return headers


def post_decisions(
    state: Any,
    questions: Mapping[str, Any],
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> Optional[dict[str, Any]]:
    """POST /api/alpha/decisions. Hard timeout, no retries. None on any failure."""
    api_key = _openrouter_api_key()
    if not api_key:
        return None
    payload = {
        "model": JEV_MODEL,
        "state": state,
        "questions": dict(questions),
    }
    try:
        response = httpx.post(
            DECISIONS_URL,
            json=payload,
            headers=_request_headers(api_key),
            timeout=timeout_s,
        )
    except Exception:
        return None
    if response.status_code >= 400:
        return None
    try:
        data = response.json()
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    answers = data.get("answers")
    if not isinstance(answers, dict):
        return None
    return data


def classify_leak(
    assistant_text: str,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> Optional[dict[str, Any]]:
    text = assistant_text or ""
    if len(text) > ASSISTANT_STATE_MAX_CHARS:
        text = text[:ASSISTANT_STATE_MAX_CHARS]
    return post_decisions(
        {"assistant": text},
        LEAK_DETECT_QUESTIONS,
        timeout_s=timeout_s,
    )
