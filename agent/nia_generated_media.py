"""Nia durable generated-media policy on top of ``provider_media``.

Industry-standard order: resolve target → validate → download/save under
``cache/generated/<kind>/`` → ``shutil.move`` into tier a/b when set.
Validation failures raise before any network I/O. Move failures keep the
generated copy and attach a warning (never delete the durable fallback).

Precedence (first match wins):
  a. explicit ``output_dir`` / skill ``--output-dir``
  b. ``HERMES_SESSION_PROJECT_PATH`` (attached Project ``primary_path``)
  c. ``$HERMES_HOME/cache/generated/{images,videos,audio,files}/``

Pet and other ``apply_tiers=False`` callers always use tier c.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from agent import provider_media

logger = logging.getLogger(__name__)

SESSION_PROJECT_PATH_ENV = "HERMES_SESSION_PROJECT_PATH"
SKILL_OUTPUT_DIR_ENV = "HERMES_GENERATED_OUTPUT_DIR"
VALID_KINDS = frozenset({"images", "videos", "audio", "files"})

_MEDIA_DIRECTIVE_RE = re.compile(r"MEDIA:", re.IGNORECASE)


class OutputValidationError(ValueError):
    """Target folder rejected before any Fal/download/credits spend."""


@dataclass(frozen=True)
class ResolvedTarget:
    """Validated save destination.

    ``folder`` is None for tier c (stay under ``cache/generated/<kind>/``).
    When set, bytes are saved under generated then moved into ``folder``.
    """

    kind: str
    folder: Optional[Path]  # absolute, or None for default generated/
    tier: str  # "a" | "b" | "c"


@dataclass(frozen=True)
class SaveResult:
    path: Path
    warning: Optional[str] = None


def generated_kind_path(kind: str) -> str:
    """``provider_media`` kind string: ``generated/<kind>``."""
    if kind not in VALID_KINDS:
        raise ValueError(f"unknown generated-media kind: {kind!r}")
    return f"{provider_media.GENERATED_SUBDIR}/{kind}"


def _session_project_path() -> str:
    try:
        from gateway.session_context import get_session_env

        return (get_session_env(SESSION_PROJECT_PATH_ENV, "") or "").strip()
    except Exception:
        return (os.environ.get(SESSION_PROJECT_PATH_ENV) or "").strip()


def _env_output_dir() -> str:
    return (os.environ.get(SKILL_OUTPUT_DIR_ENV) or "").strip()


def resolve_target_folder(
    kind: str,
    *,
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
) -> ResolvedTarget:
    """Resolve precedence a → b → c without validating yet."""
    if kind not in VALID_KINDS:
        raise OutputValidationError(f"unknown generated-media kind: {kind!r}")

    if not apply_tiers:
        return ResolvedTarget(kind=kind, folder=None, tier="c")

    explicit = (output_dir or "").strip() or _env_output_dir()
    if explicit:
        return ResolvedTarget(kind=kind, folder=Path(explicit).expanduser(), tier="a")

    project = _session_project_path()
    if project:
        return ResolvedTarget(kind=kind, folder=Path(project).expanduser(), tier="b")

    return ResolvedTarget(kind=kind, folder=None, tier="c")


def validate_target_folder(folder: Path) -> None:
    """Reject unsafe / protected paths (mirrors upstream TTS ``_resolve_output_base``)."""
    raw = str(folder)
    from tools.path_security import has_traversal_component, has_unsafe_path_chars

    if has_unsafe_path_chars(raw):
        raise OutputValidationError(
            "output folder contains control characters or line separators; "
            "use a plain filesystem path"
        )
    if _MEDIA_DIRECTIVE_RE.search(raw):
        raise OutputValidationError(
            "output folder must not contain a media directive (MEDIA:<path>)"
        )
    if has_traversal_component(raw):
        raise OutputValidationError(
            f"output folder contains '..' traversal component: {raw}. "
            "Use an absolute path or one relative to the current directory without '..'."
        )

    resolved = folder.expanduser()
    from agent.file_safety import is_write_approval_required, is_write_denied

    if is_write_denied(str(resolved)) or is_write_approval_required(str(resolved)):
        raise OutputValidationError(
            f"output folder targets a protected credential or system path: "
            f"{resolved}. Choose a normal output location."
        )


def resolve_and_validate(
    kind: str,
    *,
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
) -> ResolvedTarget:
    """Resolve precedence and validate tier a/b folders. Call before Fal/download."""
    target = resolve_target_folder(kind, output_dir=output_dir, apply_tiers=apply_tiers)
    if target.folder is not None:
        validate_target_folder(target.folder)
        # Normalize to absolute after validation (never store ``~``).
        abs_folder = target.folder.expanduser().resolve()
        return ResolvedTarget(kind=target.kind, folder=abs_folder, tier=target.tier)
    return target


def _move_into_target(src: Path, target_folder: Path) -> tuple[Path, Optional[str]]:
    """Move *src* into *target_folder* flat (no MIME subfolders). Absolute path out."""
    target_folder.mkdir(parents=True, exist_ok=True)
    dest = target_folder / src.name
    if dest.exists():
        # Avoid clobber: keep unique suffix from src stem if collision.
        dest = target_folder / f"{src.stem}_moved{src.suffix}"
    try:
        shutil.move(str(src), str(dest))
        return dest.resolve(), None
    except OSError as exc:
        warning = (
            f"Could not move generated file into {target_folder}: {exc}. "
            f"Kept durable copy at {src}."
        )
        logger.warning("%s", warning)
        return src.resolve(), warning


def save_generated_bytes(
    kind: str,
    raw: bytes,
    *,
    prefix: str,
    extension: str,
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
    resolved: Optional[ResolvedTarget] = None,
) -> SaveResult:
    target = resolved or resolve_and_validate(
        kind, output_dir=output_dir, apply_tiers=apply_tiers
    )
    path = provider_media.save_bytes(
        generated_kind_path(target.kind), raw, prefix=prefix, extension=extension
    )
    if target.folder is None:
        return SaveResult(path=path.resolve())
    final, warning = _move_into_target(path, target.folder)
    return SaveResult(path=final, warning=warning)


def save_generated_b64(
    kind: str,
    b64_data: str,
    *,
    prefix: str,
    extension: str,
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
    resolved: Optional[ResolvedTarget] = None,
) -> SaveResult:
    target = resolved or resolve_and_validate(
        kind, output_dir=output_dir, apply_tiers=apply_tiers
    )
    path = provider_media.save_b64(
        generated_kind_path(target.kind), b64_data, prefix=prefix, extension=extension
    )
    if target.folder is None:
        return SaveResult(path=path.resolve())
    final, warning = _move_into_target(path, target.folder)
    return SaveResult(path=final, warning=warning)


def save_generated_url(
    kind: str,
    url: str,
    *,
    prefix: str,
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
    resolved: Optional[ResolvedTarget] = None,
    **save_url_kwargs: Any,
) -> SaveResult:
    """Validate first (unless *resolved* already validated), then download + optional move."""
    target = resolved or resolve_and_validate(
        kind, output_dir=output_dir, apply_tiers=apply_tiers
    )
    path = provider_media.save_url(
        generated_kind_path(target.kind), url, prefix=prefix, **save_url_kwargs
    )
    if target.folder is None:
        return SaveResult(path=path.resolve())
    final, warning = _move_into_target(path, target.folder)
    return SaveResult(path=final, warning=warning)


def resolve_skill_root(*, output_dir: Optional[str] = None, default_kind: str = "files") -> Path:
    """Folder resolution for skill subprocesses (no Python import of this module required
    if they mirror env vars; this helper is for in-process callers).

    Default root: ``cache/generated/short-drama-produce`` when *default_kind* is
    overridden by callers; for generic skills use ``cache/generated/<kind>``.
    """
    target = resolve_and_validate(
        "files" if default_kind not in VALID_KINDS else default_kind,
        output_dir=output_dir,
        apply_tiers=True,
    )
    if target.folder is not None:
        target.folder.mkdir(parents=True, exist_ok=True)
        return target.folder
    # Skill-specific default tree under generated/
    from hermes_constants import get_hermes_home

    root = get_hermes_home() / "cache" / provider_media.GENERATED_SUBDIR / "short-drama-produce"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()
