"""OkVevo media catalog — the shipped-model menu for image_generate / video_generate.

Data lives in ``okvevo/media-catalog.json`` (repo root). An identical-bytes
copy at ``OkVevo-Web/src/lib/fal/media-catalog.json`` is the gateway
allowlist's source of truth; both repos run a selfcheck over their own copy.
Karan edits the JSON by hand — keep Python free of per-model hardcoding.

Only ``shipped: true`` rows are selectable via the tools' ``model=`` param
(fail-closed: anything else is rejected with the valid-id list). Rows with
``shipped: false`` are catalog memory for models that still need plugin
and/or pricing work.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Hard cap on the rendered model= description so a future catalog dump cannot
# silently balloon every request's tool schema (selfcheck asserts headroom).
MODEL_DESC_MAX_BYTES = 2048

_CACHE: Dict[str, Any] = {"mtime": None, "data": None}
_LOCK = threading.Lock()


def _catalog_path() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "okvevo",
        "media-catalog.json",
    )


def load_catalog() -> Dict[str, Any]:
    """Return the parsed catalog, re-read when the file changes. Never raises:
    a missing/corrupt catalog logs and yields an empty one (fail-closed: with
    no shipped rows every explicit ``model=`` is rejected)."""
    path = _catalog_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError as exc:
        logger.warning("media catalog unreadable (%s): %s", path, exc)
        return {}
    with _LOCK:
        if _CACHE["data"] is not None and _CACHE["mtime"] == mtime:
            return _CACHE["data"]
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as exc:
            logger.warning("media catalog parse failed (%s): %s", path, exc)
            return {}
        _CACHE["mtime"] = mtime
        _CACHE["data"] = data if isinstance(data, dict) else {}
        return _CACHE["data"]


def catalog_version() -> int:
    try:
        return int(load_catalog().get("version") or 0)
    except Exception:
        return 0


def shipped_rows(kind: str) -> List[Dict[str, Any]]:
    """``kind`` is "photos" (image_generate) or "videos" (video_generate)."""
    rows = load_catalog().get(kind)
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict) and r.get("shipped") and r.get("id")]


def shipped_ids(kind: str) -> List[str]:
    return [str(r["id"]) for r in shipped_rows(kind)]


def find_shipped(kind: str, model: str) -> Optional[Dict[str, Any]]:
    """Match an explicit ``model=`` against shipped rows by exact id or alias."""
    needle = (model or "").strip()
    if not needle:
        return None
    for row in shipped_rows(kind):
        if needle == row["id"] or needle in (row.get("aliases") or []):
            return row
    return None


def resolve_image_model(row: Dict[str, Any]) -> Optional[str]:
    """Map a shipped photo row to its ``FAL_MODELS`` key.

    Edit rows resolve to their base model (edit routing is automatic when
    ``image_url`` is passed). Aliases win over the row id so drifted ids
    (``openai/gpt-image-2`` → ``fal-ai/gpt-image-2``) land on the real key.
    """
    from tools.image_generation_tool import FAL_MODELS

    for candidate in [row.get("id"), *(row.get("aliases") or [])]:
        if not isinstance(candidate, str):
            continue
        base = candidate[: -len("/edit")] if candidate.endswith("/edit") else candidate
        if base in FAL_MODELS:
            return base
    return None


def resolve_video_family(row: Dict[str, Any]) -> Optional[str]:
    """Map a shipped video row to its FAL plugin family id."""
    from plugins.video_gen.fal import _normalize_family_key

    for candidate in [row.get("id"), *(row.get("aliases") or [])]:
        if not isinstance(candidate, str):
            continue
        fid = _normalize_family_key(candidate)
        if fid:
            return fid
    return None


def model_param_description(kind: str) -> str:
    """Render the ``model=`` schema description from shipped rows (verbatim
    notes). Whole lines beyond ``MODEL_DESC_MAX_BYTES`` are dropped — the
    selfcheck asserts the full render fits, so truncation means the catalog
    grew past the cap and the selfcheck is failing somewhere."""
    rows = shipped_rows(kind)
    header = (
        "Optional model override; omit for the configured default. When the "
        "request (or a skill) clearly points at a model, pass its exact id "
        "from the shipped catalog below; if vibe/budget is genuinely "
        "ambiguous and no model was named, call clarify instead of guessing. "
        "Unknown or unshipped ids are rejected with the valid list."
    )
    if not rows:
        return header
    summary = load_catalog().get(f"{kind}_summary")
    lines = [header]
    if isinstance(summary, str) and summary.strip():
        lines.append(summary.strip())
    lines.append("Shipped models:")
    for row in rows:
        note = str(row.get("notes") or "").strip()
        line = f"- {row['id']} — {note}" if note else f"- {row['id']}"
        candidate = "\n".join([*lines, line])
        if len(candidate.encode("utf-8")) > MODEL_DESC_MAX_BYTES:
            logger.warning("media catalog %s: model= description hit byte cap", kind)
            break
        lines.append(line)
    return "\n".join(lines)
