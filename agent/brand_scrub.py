"""User-facing brand/internals scrub (Python SoT for the L3 output rail).

Port of ``apps/desktop/src/lib/display-path.ts`` ``sanitizeUserFacingBrand``,
plus the confirmed-gap table (case-insensitive openrouter, settings filenames,
API keys, Bedrock, model ids, credential pool, ``hermes -p``, HERMES_HOME,
bot-context "profile" → "bot"). Keep the TS copy in lockstep via
``tests/fixtures/brand_scrub_golden.json``.
"""

from __future__ import annotations

import re

INTERNAL_FENCE_PLACEHOLDER = "[internal details omitted]"

# No MULTILINE: `$` must mean end-of-string (JS `/g` without `m`), not EOL.
_FENCED_CODE_RE = re.compile(r"```[\s\S]*?(?:```|$)")
_HERMES_CLI_SPAN_RE = re.compile(r"`hermes [^`]*`")
_HERMES_DASH_P_RE = re.compile(r"\bhermes\s+-p(?:\s+[A-Za-z0-9_-]+){0,2}", re.IGNORECASE)
_HERMES_DESKTOP_APP_RE = re.compile(r"\bHermes desktop app\b")
_HERMES_AGENT_RE = re.compile(r"\bHermes Agent\b")
_HERMES_WORD_RE = re.compile(r"\bhermes\b", re.IGNORECASE)
_NOUS_RESEARCH_RE = re.compile(r"\bNous Research\b")
_NOUS_WORD_RE = re.compile(r"\bNous\b")
_OPENROUTER_WORD_RE = re.compile(r"\bopenrouter\b", re.IGNORECASE)
_FAL_WORD_RE = re.compile(r"\bfal\.ai\b", re.IGNORECASE)
_HEY_HERMES_RE = re.compile(r"\bhey hermes\b", re.IGNORECASE)
_HEY_NIA_RE = re.compile(r"\bhey nia\b", re.IGNORECASE)
_HERMES_PROFILE_AT_RE = re.compile(r"@hermes\b(?!/)")
_THE_GATEWAY_RE = re.compile(r"\bthe gateway\b", re.IGNORECASE)
_BACKEND_PROCESS_RE = re.compile(r"\bbackend process\b", re.IGNORECASE)
_GATEWAY_WORD_RE = re.compile(r"\bgateway\b", re.IGNORECASE)
_BACKEND_WORD_RE = re.compile(r"\bbackend\b", re.IGNORECASE)
_ROSTER_WORD_RE = re.compile(r"\broster\b", re.IGNORECASE)
_HOME_DOTFILE_PATH_RE = re.compile(
    r"(?:~|/Users/[^/\s]+|/home/[^/\s]+|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+)[\\/]\.[^\s`'\"]+"
)
_HOME_DOTFILE_PATH_TEST_RE = re.compile(
    r"(?:~|/Users/[^/\s]+|/home/[^/\s]+|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+)[\\/]\.[^\s`'\"]+"
)
_DOTENV_RE = re.compile(r"(?<![\w])\.env\b")
_CONFIG_YAML_RE = re.compile(r"\bconfig\.yaml\b", re.IGNORECASE)
_PROFILE_YAML_RE = re.compile(r"\bprofile\.yaml\b", re.IGNORECASE)
_AUTH_JSON_RE = re.compile(r"\bauth\.json\b", re.IGNORECASE)
_API_KEY_RE = re.compile(r"\bAPI keys?\b", re.IGNORECASE)
_BEDROCK_RE = re.compile(r"\bBedrock\b", re.IGNORECASE)
_CREDENTIAL_POOL_RE = re.compile(r"\bcredential pools?\b", re.IGNORECASE)
_HERMES_HOME_RE = re.compile(r"\bHERMES_HOME\b")
# Vendor/model ids like minimax/minimax-m3, anthropic/claude-sonnet-4.6 — not apps/desktop.
_MODEL_ID_RE = re.compile(
    r"\b[a-z][a-z0-9.-]{1,32}/[a-z0-9][a-z0-9._-]*[-:][a-z0-9][a-z0-9._-]*\b",
    re.IGNORECASE,
)
_NIA_PROFILE_RE = re.compile(r"\bNia profile\b")
_PROFILE_ACTION_RE = re.compile(
    r"\b(create|created|creating|make|made|making|set up|setup)\s+(a\s+)?(new\s+)?profile\b",
    re.IGNORECASE,
)
_PROFILE_NAMED_RE = re.compile(r"\bprofile (named|called)\b", re.IGNORECASE)

_PROTO_TOKEN = "\x00HERMESPROTO\x00"
_SDK_TOKEN = "\x00HERMESSDK\x00"
_TRAILING_PUNCT_RE = re.compile(r"[.,;:!?]+$")


def display_install_path(raw: str) -> str:
    return raw.replace("hermes-agent", "nia-agent").replace(".hermes", ".nia")


def _fence_contains_internal(block: str) -> bool:
    stripped = re.sub(r"hermes://", "", block, flags=re.IGNORECASE).replace("@hermes/", "")
    return bool(
        re.search(r"\bhermes\b", stripped, re.IGNORECASE)
        or re.search(r"\bnous\b", stripped, re.IGNORECASE)
        or re.search(r"\bopenrouter\b", stripped, re.IGNORECASE)
        or re.search(r"\bfal\.ai\b", stripped, re.IGNORECASE)
        or re.search(r"\bgateway\b", stripped, re.IGNORECASE)
        or re.search(r"\bbackend\b", stripped, re.IGNORECASE)
        or re.search(r"\broster\b", stripped, re.IGNORECASE)
        or ".hermes" in stripped
        or _HOME_DOTFILE_PATH_TEST_RE.search(stripped)
        or _DOTENV_RE.search(stripped)
        or _CONFIG_YAML_RE.search(stripped)
        or _PROFILE_YAML_RE.search(stripped)
        or _AUTH_JSON_RE.search(stripped)
        or _API_KEY_RE.search(stripped)
        or _BEDROCK_RE.search(stripped)
        or _CREDENTIAL_POOL_RE.search(stripped)
        or _HERMES_HOME_RE.search(stripped)
        or _MODEL_ID_RE.search(stripped)
    )


def _replace_home_dotfile(match: re.Match[str]) -> str:
    raw = match.group(0)
    punct_match = _TRAILING_PUNCT_RE.search(raw)
    punct = punct_match.group(0) if punct_match else ""
    return f"your Nia data folder{punct}"


def _replace_profile_action(match: re.Match[str]) -> str:
    text = match.group(0)
    return re.sub(r"profile\b", "bot", text, count=1, flags=re.IGNORECASE)


def _replace_profile_named(match: re.Match[str]) -> str:
    verb = match.group(1)
    return f"bot {verb}"


def sanitize_user_facing_prose(raw: str) -> str:
    protected = re.sub(r"hermes://", _PROTO_TOKEN, raw, flags=re.IGNORECASE).replace(
        "@hermes/", _SDK_TOKEN
    )
    text = display_install_path(protected)
    text = _HERMES_CLI_SPAN_RE.sub("a Nia command", text)
    text = _HERMES_DASH_P_RE.sub("a Nia command", text)
    text = _HERMES_DESKTOP_APP_RE.sub("Nia desktop app", text)
    text = _HERMES_AGENT_RE.sub("Nia", text)
    # Specific phrases before the generic `\bhermes\b` rewrite.
    text = _HEY_HERMES_RE.sub("ok nia", text)
    text = _HEY_NIA_RE.sub("ok nia", text)
    text = _HERMES_PROFILE_AT_RE.sub("@nia", text)
    text = _HERMES_WORD_RE.sub("Nia", text)
    text = _NOUS_RESEARCH_RE.sub("OkVevo", text)
    text = _NOUS_WORD_RE.sub("OkVevo", text)
    text = _OPENROUTER_WORD_RE.sub("OkVevo", text)
    text = _FAL_WORD_RE.sub("OkVevo", text)
    text = _THE_GATEWAY_RE.sub("the app", text)
    text = _BACKEND_PROCESS_RE.sub("app", text)
    text = _GATEWAY_WORD_RE.sub("app", text)
    text = _BACKEND_WORD_RE.sub("app", text)
    text = _ROSTER_WORD_RE.sub("bots list", text)
    text = _HOME_DOTFILE_PATH_RE.sub(_replace_home_dotfile, text)
    text = _DOTENV_RE.sub("settings file", text)
    text = _CONFIG_YAML_RE.sub("settings", text)
    text = _PROFILE_YAML_RE.sub("settings", text)
    text = _AUTH_JSON_RE.sub("settings", text)
    text = _API_KEY_RE.sub("credentials", text)
    text = _BEDROCK_RE.sub("the cloud", text)
    text = _CREDENTIAL_POOL_RE.sub("credentials", text)
    text = _HERMES_HOME_RE.sub("your Nia data folder", text)
    text = _MODEL_ID_RE.sub("the model", text)
    text = _NIA_PROFILE_RE.sub("Nia bot", text)
    text = _PROFILE_ACTION_RE.sub(_replace_profile_action, text)
    text = _PROFILE_NAMED_RE.sub(_replace_profile_named, text)
    return text.replace(_PROTO_TOKEN, "hermes://").replace(_SDK_TOKEN, "@hermes/")


def sanitize_user_facing_brand(raw: str) -> str:
    """Rewrite leftover product copy, mechanism terms, and internals for output."""
    if not raw:
        return raw
    # ponytail: ordered regex table; upgrade if a real tokenizer is needed for mixed markdown.
    with_fences = _FENCED_CODE_RE.sub(
        lambda m: INTERNAL_FENCE_PLACEHOLDER if _fence_contains_internal(m.group(0)) else m.group(0),
        raw,
    )
    return sanitize_user_facing_prose(with_fences)
