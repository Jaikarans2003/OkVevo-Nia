"""User-facing Nia brand rewrites. Prompt/paint only — never disk or tool paths."""

from __future__ import annotations

import re

# ponytail: naive phrase/path rewrite; upgrade later if code-fence exemptions are needed.
_PHRASE_REWRITES = (
    (re.compile(r"\bHermes desktop app\b"), "Nia desktop app"),
    (re.compile(r"\bHermes Agent\b"), "Nia"),
    (re.compile(r"\bhey hermes\b", re.I), "ok nia"),
    (re.compile(r"\bhey nia\b", re.I), "ok nia"),
    (re.compile(r"@hermes\b(?!/)"), "@nia"),
)


def sanitize_user_facing_brand(text: str) -> str:
    out = (text or "").replace("hermes-agent", "nia-agent").replace(".hermes", ".nia")
    for pattern, repl in _PHRASE_REWRITES:
        out = pattern.sub(repl, out)
    return out
