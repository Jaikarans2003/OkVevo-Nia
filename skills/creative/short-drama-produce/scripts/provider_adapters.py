#!/usr/bin/env python3
"""Stdlib-only production adapters for supported media providers.

The public ``compile_*`` functions are deterministic and perform no I/O.  The
CLI reads the confirmed production job from stdin and writes only the adapter
contract JSON to stdout after a provider result has been saved to a temporary
regular file.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import mimetypes
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Collection, Mapping, Sequence
from pathlib import Path
from typing import Any

OPENAI_MODEL = "gpt-image-2"
MINIMAX_MUSIC_MODEL = "music-3.0"
OPENAI_BASE_URL = "https://api.openai.com/v1"
SEEDANCE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
MINIMAX_BASE_URL = "https://api.minimax.io/v1"
MINIMAX_VIDEO_BASE_URL = "https://api.minimax.io/v2"
MAX_JSON_RESPONSE = 128 * 1024 * 1024
MAX_OUTPUT_BYTES = 512 * 1024 * 1024
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
MAX_MULTIPART_BYTES = 200 * 1024 * 1024
MAX_ERROR_BODY_BYTES = 64 * 1024
TERMINAL_FAILURES = {"failed", "cancelled", "canceled", "timeout", "expired"}
SEEDANCE_RATIOS = {"adaptive", "1:1", "3:4", "4:3", "9:16", "16:9", "21:9"}
SEEDANCE_REFERENCE_ROLES = {
    "first_frame": "image_url",
    "last_frame": "image_url",
    "reference_image": "image_url",
    "reference_video": "video_url",
    "reference_audio": "audio_url",
}
# One opening frame and one closing frame, because each names a single position
# in the take. Note what is deliberately absent: the sibling adapter forbids
# mixing frame conditioning with reference conditioning, and that rule belongs
# to that provider's reference, not to this one. Do not carry it across.
SEEDANCE_SINGULAR_ROLES = {"first_frame", "last_frame"}
MINIMAX_VIDEO_RATIOS = {"adaptive", "1:1", "3:4", "4:3", "9:16", "16:9", "21:9"}
MINIMAX_VIDEO_RESOLUTIONS = {"480P", "768P", "2K"}
MINIMAX_VIDEO_PROMPT_LIMIT = 7000
MINIMAX_SPEECH_TEXT_LIMIT = 5000
MINIMAX_VIDEO_ROLES = {
    "first_frame": "image_url",
    "last_frame": "image_url",
    "reference_image": "image_url",
    "reference_video": "video_url",
    "reference_audio": "audio_url",
}
# Both providers document a `data:<mime>;base64,<...>` URI as an accepted media
# input alongside a public URL, so a local project reference needs no upload
# service to reach them. The caps are MiniMax's published per-modality limits;
# Seedance publishes no numbers, so the same conservative guard is applied there
# and can be raised per deployment. Base64 inflates bytes by about a third, so
# the request cap is checked against the encoded size.
INLINE_REFERENCE_LIMITS = {
    "image_url": 30 * 1024 * 1024,
    "video_url": 50 * 1024 * 1024,
    "audio_url": 15 * 1024 * 1024,
}
INLINE_REFERENCE_BODY_LIMIT = 64 * 1024 * 1024
# App Hosting runs on Cloud Run, which rejects request bodies above 32MB
# before the app sees them; stay under with margin for JSON + auth overhead.
PORTAL_INLINE_BODY_LIMIT = 24 * 1024 * 1024
PORTAL_IMAGE_EDGE = 2048
PORTAL_PASSTHROUGH_BYTES = 1536 * 1024
INLINE_REFERENCE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
}
GPT_IMAGE_MIN_PIXELS = 655_360
GPT_IMAGE_MAX_PIXELS = 8_294_400
MINIMUM_PYTHON = (3, 9)
if sys.version_info < MINIMUM_PYTHON:
    raise SystemExit("provider_adapters.py requires Python 3.9 or newer")


class AdapterFailure(RuntimeError):
    """A safe-to-report adapter failure without provider response contents."""

    def __init__(
        self,
        message: str,
        *,
        category: str = "provider_response",
        code: str = "adapter_failure",
        http_status: int | None = None,
        request_id: str | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.code = _safe_token(code) or "adapter_failure"
        self.http_status = http_status
        self.request_id = _safe_token(request_id)
        self.retryable = retryable

    def public(self, provider: str) -> dict[str, Any]:
        result: dict[str, Any] = {
            "provider": provider,
            "category": self.category,
            "code": self.code,
            "retryable": self.retryable,
        }
        if self.http_status is not None:
            result["http_status"] = self.http_status
        if self.request_id is not None:
            result["request_id"] = self.request_id
        result["message"] = str(self)
        return result


def _safe_token(value: object) -> str | None:
    if isinstance(value, str) and re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", value
    ):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return None


def _request_id(headers: Mapping[str, Any]) -> str | None:
    folded = {str(key).casefold(): value for key, value in headers.items()}
    for name in ("x-request-id", "x-tt-logid", "x-trace-id", "trace-id"):
        value = _safe_token(folded.get(name))
        if value is not None:
            return value
    return None


def _provider_code(document: object) -> str | None:
    if not isinstance(document, Mapping):
        return None
    error = document.get("error")
    if isinstance(error, Mapping):
        value = _safe_token(error.get("code"))
        if value is not None:
            return value
    base_resp = document.get("base_resp")
    if isinstance(base_resp, Mapping):
        value = _safe_token(base_resp.get("status_code"))
        if value not in {None, "0"}:
            return value
    return _safe_token(document.get("code"))


def _http_failure(provider: str, error: urllib.error.HTTPError) -> AdapterFailure:
    status = error.code
    try:
        raw = error.read(MAX_ERROR_BODY_BYTES + 1)
        document = json.loads(raw) if len(raw) <= MAX_ERROR_BODY_BYTES else None
    except (OSError, UnicodeError, json.JSONDecodeError):
        document = None
    if status == 401:
        category = "authentication"
    elif status == 403:
        category = "permission"
    elif status == 429:
        category = "rate_limit"
    elif 500 <= status <= 599:
        category = "server"
    elif 400 <= status <= 499:
        category = "invalid_request"
    else:
        category = "provider_response"
    return AdapterFailure(
        f"{provider} HTTP request failed",
        category=category,
        code=_provider_code(document) or f"http_{status}",
        http_status=status,
        request_id=_request_id(
            dict(error.headers.items()) if error.headers is not None else {}
        ),
        retryable=status == 429 or 500 <= status <= 599,
    )


def _require_job(job: Mapping[str, Any], modality: str) -> tuple[str, dict[str, Any]]:
    if not isinstance(job, Mapping) or job.get("modality") != modality:
        raise ValueError(f"adapter requires a {modality} job")
    prompt = job.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("job prompt must be non-empty")
    parameters = job.get("parameters", {})
    if not isinstance(parameters, Mapping):
        raise ValueError("job parameters must be an object")
    outputs = job.get("outputs")
    if not isinstance(outputs, list) or len(outputs) != 1 or not isinstance(outputs[0], str):
        raise ValueError("provider adapter requires exactly one output")
    return prompt, dict(parameters)


def _prompt_with_reference_contract(
    prompt: str,
    job: Mapping[str, Any],
    *,
    prompt_language: str | None = None,
    reference_tokens: Sequence[str] = (),
    zh_reference_prefix: str = "参考",
    zh_heading: str = "参考约束：",
) -> str:
    bindings = job.get("reference_bindings", [])
    references = job.get("references", [])
    if not bindings:
        return prompt
    if (
        not isinstance(bindings, list)
        or not isinstance(references, list)
        or len(bindings) != len(references)
    ):
        raise ValueError("reference bindings must match job references")
    if reference_tokens and len(reference_tokens) != len(references):
        raise ValueError("reference tokens must match job references")
    language = (prompt_language or "en").casefold()
    instructions: list[str] = []
    for index, binding in enumerate(bindings, 1):
        if not isinstance(binding, Mapping) or binding.get("order") != index:
            raise ValueError("reference binding order is invalid")
        if binding.get("path") != references[index - 1]:
            raise ValueError("reference binding path does not match job references")
        label = binding.get("label")
        role = binding.get("role")
        may_control = binding.get("may_control")
        must_not_control = binding.get("must_not_control")
        if (
            not isinstance(label, str)
            or not label.strip()
            or not isinstance(role, str)
            or not role.strip()
            or not isinstance(may_control, list)
            or not may_control
            or not all(isinstance(item, str) and item.strip() for item in may_control)
            or not isinstance(must_not_control, list)
            or not must_not_control
            or not all(isinstance(item, str) and item.strip() for item in must_not_control)
        ):
            raise ValueError("reference binding semantics are invalid")
        character = binding.get("character")
        if character is not None:
            if role != "reference_audio" or not isinstance(character, str) or not character.strip():
                raise ValueError("reference audio character is invalid")
            # The source's explicit speaker wins over the free-form asset label.
            label = f"{character.strip()}音色参考"
        values = {
            "order": index,
            "reference": reference_tokens[index - 1] if reference_tokens else str(index),
            "label": label.strip(),
            "role": role.strip(),
            "may": ", ".join(item.strip() for item in may_control),
            "must": ", ".join(item.strip() for item in must_not_control),
        }
        if language.startswith("zh"):
            instructions.append(
                f"{zh_reference_prefix} "
                + (
                    "{reference}（{label}），用途 {role}。允许控制：{may}。"
                    "不得控制：{must}。".format(**values)
                )
            )
        elif language.startswith("en"):
            instructions.append(
                "Reference {reference} ({label}), role {role}. May control: {may}. "
                "Must not control: {must}.".format(**values)
            )
        else:
            instructions.append(
                "[REF {order} | {label} | {role}] [+] {may} [-] {must}".format(
                    **values
                )
            )
    if language.startswith("zh"):
        heading = zh_heading
    elif language.startswith("en"):
        heading = "Reference contract:"
    else:
        heading = "<REF_CONTRACT>"
    return f"{prompt}\n\n{heading}\n" + "\n".join(instructions)


def _pop_prompt_language(parameters: dict[str, Any]) -> str | None:
    value = parameters.pop("prompt_language", None)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 64:
        raise ValueError("prompt_language must be a non-empty bounded language tag")
    return value.strip()


def _take(parameters: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
    unknown = set(parameters) - allowed
    if unknown:
        raise ValueError("unsupported provider parameters: " + ", ".join(sorted(unknown)))
    return parameters


def compile_seedance_payload(
    job: Mapping[str, Any],
    *,
    model: str,
    reference_urls: Sequence[str] = (),
    reference_roles: Sequence[str] = (),
    allowed_ratios: Collection[str] | None = None,
    duration_range: tuple[int, int] | None = None,
) -> dict[str, Any]:
    """Compile a video production job into the official Seedance task body.

    ``model`` is deliberately mandatory: callers must obtain it from explicit
    runtime configuration rather than assuming any Seedance release.
    """
    prompt, parameters = _require_job(job, "video")
    if not isinstance(model, str) or not model.strip():
        raise ValueError("Seedance model must be explicitly configured")
    references = job.get("references", [])
    if not isinstance(references, list) or len(reference_urls) != len(references):
        raise ValueError("Seedance reference URLs must match job references")
    if len(reference_roles) != len(reference_urls):
        raise ValueError("Seedance reference roles must match job references")
    if Path(job["outputs"][0]).suffix.casefold() != ".mp4":
        raise ValueError("Seedance adapter requires an MP4 target")
    parameters = _take(
        parameters,
        {
            "duration",
            "ratio",
            "generate_audio",
            "omni_reference_task_type",
            "prompt_language",
        },
    )
    prompt_language = _pop_prompt_language(parameters)
    duration = parameters.get("duration")
    if duration is not None and (
        not isinstance(duration, int)
        or isinstance(duration, bool)
        or (duration != -1 and not 1 <= duration <= 30)
    ):
        raise ValueError("Seedance duration must be -1 or an integer from 1 to 30")
    if duration is not None and duration != -1:
        if duration_range is None:
            raise ValueError("Seedance duration needs an explicit model profile")
        minimum, maximum = duration_range
        if not 1 <= minimum <= maximum <= 30 or not minimum <= duration <= maximum:
            raise ValueError("Seedance duration is outside the configured model profile")
    ratio = parameters.get("ratio")
    if ratio is not None and (
        not isinstance(ratio, str) or ratio.strip() not in SEEDANCE_RATIOS
    ):
        raise ValueError("Seedance ratio is outside the supported profile")
    if ratio is not None:
        configured_ratios = set(allowed_ratios or ())
        if not configured_ratios:
            raise ValueError("Seedance ratio needs an explicit model profile")
        if not configured_ratios <= SEEDANCE_RATIOS or ratio.strip() not in configured_ratios:
            raise ValueError("Seedance ratio is outside the configured model profile")
        ratio = ratio.strip()
    generate_audio = parameters.get("generate_audio")
    if generate_audio is not None and not isinstance(generate_audio, bool):
        raise ValueError("Seedance generate_audio must be a boolean")
    task_type = parameters.get("omni_reference_task_type")
    if task_type is not None and task_type not in {"auto", "reference", "edit", "extend"}:
        raise ValueError("Seedance omni reference task type is invalid")
    counters = {"image_url": 0, "video_url": 0, "audio_url": 0}
    labels = {"image_url": "图片", "video_url": "视频", "audio_url": "音频"}
    reference_tokens: list[str] = []
    singular_seen: set[str] = set()
    for role in reference_roles:
        field = SEEDANCE_REFERENCE_ROLES.get(role)
        if field is None:
            raise ValueError(f"unsupported Seedance reference role: {role}")
        if role in SEEDANCE_SINGULAR_ROLES:
            if role in singular_seen:
                raise ValueError(f"Seedance accepts one {role} reference")
            singular_seen.add(role)
        # A frame role still occupies a picture slot, so it keeps counting: the
        # tokens are positional, and skipping one would point every later
        # `@图片N` in the prose at the wrong picture.
        counters[field] += 1
        reference_tokens.append(f"@{labels[field]}{counters[field]}")
    if task_type in {"edit", "extend"} and "reference_video" not in reference_roles:
        raise ValueError(f"Seedance {task_type} requires a reference video")
    if task_type == "edit" and (ratio != "adaptive" or duration != -1):
        raise ValueError("Seedance edit requires adaptive ratio and duration -1")
    if task_type == "extend" and ratio != "adaptive":
        raise ValueError("Seedance extend requires an adaptive ratio")
    text = _prompt_with_reference_contract(
        prompt,
        job,
        prompt_language=prompt_language,
        reference_tokens=reference_tokens,
        zh_reference_prefix=(
            "输入素材" if task_type in {"edit", "extend"} else "参考"
        ),
        zh_heading=(
            "输入素材约束：" if task_type in {"edit", "extend"} else "参考约束："
        ),
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    for index, url in enumerate(reference_urls):
        if not isinstance(url, str) or not url:
            raise ValueError("Seedance reference URL must be non-empty")
        role = reference_roles[index]
        field = SEEDANCE_REFERENCE_ROLES[role]
        suffix = Path(str(references[index])).suffix.casefold()
        expected = {
            "image_url": {".png", ".jpg", ".jpeg", ".webp"},
            "video_url": {".mp4", ".mov", ".webm"},
            "audio_url": {".wav", ".mp3", ".m4a", ".aac", ".flac"},
        }[field]
        if suffix not in expected:
            raise ValueError(f"Seedance {role} does not match the reference file type")
        parsed = urllib.parse.urlparse(url)
        if not (
            (parsed.scheme == "https" and parsed.netloc)
            or (
                parsed.scheme == "asset"
                and parsed.netloc.startswith("asset-")
                and not parsed.path
            )
            or _is_inline_reference(url)
        ):
            raise ValueError(
                "Seedance reference URL must be HTTPS, asset:// or a base64 data URI"
            )
        content.append({"type": field, field: {"url": url}, "role": role})
    body: dict[str, Any] = {"model": model.strip(), "content": content}
    if ratio is not None:
        body["ratio"] = ratio
    if duration is not None:
        body["duration"] = duration
    if generate_audio is not None:
        body["generate_audio"] = generate_audio
    if task_type is not None:
        body["omni_reference_task_type"] = task_type
    return body


def _seedance_runtime_profile(
) -> tuple[frozenset[str] | None, tuple[int, int] | None]:
    raw_ratios = os.environ.get("SEEDANCE_ALLOWED_RATIOS")
    allowed_ratios = (
        frozenset(item.strip() for item in raw_ratios.split(",") if item.strip())
        if raw_ratios is not None
        else None
    )
    minimum_raw = os.environ.get("SEEDANCE_MIN_DURATION")
    maximum_raw = os.environ.get("SEEDANCE_MAX_DURATION")
    if (minimum_raw is None) != (maximum_raw is None):
        raise AdapterFailure(
            "Seedance duration profile is incomplete",
            category="configuration",
            code="invalid_model_profile",
        )
    try:
        duration_range = (
            (int(minimum_raw), int(maximum_raw))
            if minimum_raw is not None and maximum_raw is not None
            else None
        )
    except ValueError as exc:
        raise AdapterFailure(
            "Seedance duration profile is invalid",
            category="configuration",
            code="invalid_model_profile",
        ) from exc
    if allowed_ratios is not None and (
        not allowed_ratios or not allowed_ratios <= SEEDANCE_RATIOS
    ):
        raise AdapterFailure(
            "Seedance ratio profile is invalid",
            category="configuration",
            code="invalid_model_profile",
        )
    if duration_range is not None and not (
        1 <= duration_range[0] <= duration_range[1] <= 30
    ):
        raise AdapterFailure(
            "Seedance duration profile is invalid",
            category="configuration",
            code="invalid_model_profile",
        )
    return allowed_ratios, duration_range


def compile_minimax_h3_payload(
    job: Mapping[str, Any],
    *,
    model: str,
    reference_urls: Sequence[str] = (),
    reference_roles: Sequence[str] = (),
    allowed_ratios: Collection[str] | None = None,
    allowed_resolutions: Collection[str] | None = None,
    duration_range: tuple[int, int] | None = None,
) -> dict[str, Any]:
    """Compile a video job into the official MiniMax video-generation task body.

    ``model`` is mandatory for the same reason it is for Seedance: which release
    is enabled, and what it accepts, is deployment configuration, never an
    assumption made here.
    """
    prompt, parameters = _require_job(job, "video")
    if not isinstance(model, str) or not model.strip():
        raise ValueError("MiniMax video model must be explicitly configured")
    references = job.get("references", [])
    if not isinstance(references, list) or len(reference_urls) != len(references):
        raise ValueError("MiniMax reference URLs must match job references")
    if len(reference_roles) != len(reference_urls):
        raise ValueError("MiniMax reference roles must match job references")
    if Path(job["outputs"][0]).suffix.casefold() != ".mp4":
        raise ValueError("MiniMax video adapter requires an MP4 target")
    parameters = _take(
        parameters, {"duration", "ratio", "resolution", "prompt_language"}
    )
    prompt_language = _pop_prompt_language(parameters)

    duration = parameters.get("duration")
    if not isinstance(duration, int) or isinstance(duration, bool):
        raise ValueError("MiniMax video duration must be an integer number of seconds")
    if duration_range is None:
        raise ValueError("MiniMax video duration needs an explicit model profile")
    minimum, maximum = duration_range
    if not 1 <= minimum <= maximum or not minimum <= duration <= maximum:
        raise ValueError("MiniMax video duration is outside the configured model profile")

    resolution = parameters.get("resolution")
    if not isinstance(resolution, str) or resolution.strip() not in MINIMAX_VIDEO_RESOLUTIONS:
        raise ValueError("MiniMax video resolution is outside the supported profile")
    configured_resolutions = set(allowed_resolutions or ())
    if not configured_resolutions:
        raise ValueError("MiniMax video resolution needs an explicit model profile")
    if (
        not configured_resolutions <= MINIMAX_VIDEO_RESOLUTIONS
        or resolution.strip() not in configured_resolutions
    ):
        raise ValueError("MiniMax video resolution is outside the configured model profile")

    ratio = parameters.get("ratio")
    if ratio is not None:
        if not isinstance(ratio, str) or ratio.strip() not in MINIMAX_VIDEO_RATIOS:
            raise ValueError("MiniMax video ratio is outside the supported profile")
        configured_ratios = set(allowed_ratios or ())
        if not configured_ratios:
            raise ValueError("MiniMax video ratio needs an explicit model profile")
        if (
            not configured_ratios <= MINIMAX_VIDEO_RATIOS
            or ratio.strip() not in configured_ratios
        ):
            raise ValueError("MiniMax video ratio is outside the configured model profile")

    counters = {"image_url": 0, "video_url": 0, "audio_url": 0}
    labels = {"image_url": "Picture", "video_url": "Video", "audio_url": "Audio"}
    reference_tokens: list[str] = []
    for role in reference_roles:
        field = MINIMAX_VIDEO_ROLES.get(role)
        if field is None:
            raise ValueError(f"unsupported MiniMax reference role: {role}")
        counters[field] += 1
        reference_tokens.append(f"<{labels[field]} {counters[field]}>")
    text = _prompt_with_reference_contract(
        prompt,
        job,
        prompt_language=prompt_language,
        reference_tokens=reference_tokens,
    )
    if len(text) > MINIMAX_VIDEO_PROMPT_LIMIT:
        raise ValueError("MiniMax video prompt exceeds the provider limit")
    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    seen_roles: list[str] = []
    for index, url in enumerate(reference_urls):
        role = reference_roles[index]
        if role not in MINIMAX_VIDEO_ROLES:
            raise ValueError(f"unsupported MiniMax reference role: {role}")
        if role in {"first_frame", "last_frame"} and role in seen_roles:
            raise ValueError(f"MiniMax accepts one {role} reference")
        seen_roles.append(role)
        if not isinstance(url, str) or not url:
            raise ValueError("MiniMax reference URL must be non-empty")
        parsed = urllib.parse.urlparse(url)
        if not (
            (parsed.scheme == "https" and parsed.netloc)
            or (parsed.scheme == "mm_file" and parsed.netloc and not parsed.path)
            or _is_inline_reference(url)
        ):
            raise ValueError(
                "MiniMax reference URL must be HTTPS, mm_file:// or a base64 data URI"
            )
        field = MINIMAX_VIDEO_ROLES[role]
        content.append({"type": field, field: {"url": url}, "role": role})
    frame_roles = {"first_frame", "last_frame"}
    reference_roles_present = {"reference_image", "reference_video", "reference_audio"}
    if frame_roles.intersection(seen_roles) and reference_roles_present.intersection(
        seen_roles
    ):
        raise ValueError(
            "MiniMax frame conditioning cannot be mixed with reference conditioning"
        )
    if ratio is None and len(content) == 1:
        raise ValueError("MiniMax text-to-video requires an explicit ratio")
    body: dict[str, Any] = {
        "model": model.strip(),
        "content": content,
        "duration": duration,
        "resolution": resolution.strip(),
    }
    if ratio is not None:
        if ratio.strip() == "adaptive" and len(content) == 1:
            raise ValueError("MiniMax text-to-video cannot use an adaptive ratio")
        body["ratio"] = ratio.strip()
    return body


def _minimax_video_runtime_profile() -> tuple[
    frozenset[str] | None, frozenset[str] | None, tuple[int, int] | None
]:
    def _set(name: str, supported: Collection[str]) -> frozenset[str] | None:
        raw = os.environ.get(name)
        if raw is None:
            return None
        values = frozenset(item.strip() for item in raw.split(",") if item.strip())
        if not values or not values <= set(supported):
            raise AdapterFailure(
                f"MiniMax video profile is invalid: {name}",
                category="configuration",
                code="invalid_model_profile",
            )
        return values

    allowed_ratios = _set("MINIMAX_VIDEO_RATIOS", MINIMAX_VIDEO_RATIOS)
    allowed_resolutions = _set("MINIMAX_VIDEO_RESOLUTIONS", MINIMAX_VIDEO_RESOLUTIONS)
    minimum_raw = os.environ.get("MINIMAX_VIDEO_MIN_DURATION")
    maximum_raw = os.environ.get("MINIMAX_VIDEO_MAX_DURATION")
    if (minimum_raw is None) != (maximum_raw is None):
        raise AdapterFailure(
            "MiniMax video duration profile is incomplete",
            category="configuration",
            code="invalid_model_profile",
        )
    try:
        duration_range = (
            (int(minimum_raw), int(maximum_raw))
            if minimum_raw is not None and maximum_raw is not None
            else None
        )
    except ValueError as exc:
        raise AdapterFailure(
            "MiniMax video duration profile is invalid",
            category="configuration",
            code="invalid_model_profile",
        ) from exc
    if duration_range is not None and not 1 <= duration_range[0] <= duration_range[1]:
        raise AdapterFailure(
            "MiniMax video duration profile is invalid",
            category="configuration",
            code="invalid_model_profile",
        )
    return allowed_ratios, allowed_resolutions, duration_range


def compile_gpt_image_2_payload(job: Mapping[str, Any]) -> dict[str, Any]:
    """Compile an image job into GPT Image 2 generation/edit fields."""
    prompt, parameters = _require_job(job, "image")
    parameters = _take(
        parameters,
        {
            "width",
            "height",
            "size",
            "quality",
            "background",
            "moderation",
            "prompt_language",
        },
    )
    prompt_language = _pop_prompt_language(parameters)
    prompt = _prompt_with_reference_contract(
        prompt, job, prompt_language=prompt_language
    )
    if len(prompt) > 32000:
        raise ValueError("GPT Image prompt exceeds the provider limit")
    width = parameters.pop("width", None)
    height = parameters.pop("height", None)
    if (width is None) != (height is None) or (width is not None and "size" in parameters):
        raise ValueError("use either both width/height or size")
    if width is not None:
        if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
            raise ValueError("image dimensions must be positive integers")
        if width % 16 or height % 16 or not (1 / 3 <= width / height <= 3):
            raise ValueError("GPT Image dimensions must be divisible by 16 with ratio between 1:3 and 3:1")
        parameters["size"] = f"{width}x{height}"
    size = parameters.get("size")
    if size != "auto" and size is not None:
        if not isinstance(size, str) or "x" not in size:
            raise ValueError("GPT Image size is invalid")
        try:
            parsed_width, parsed_height = (int(part) for part in size.split("x", 1))
        except ValueError as exc:
            raise ValueError("GPT Image size is invalid") from exc
        if (
            parsed_width <= 0
            or parsed_height <= 0
            or parsed_width % 16
            or parsed_height % 16
            or not (1 / 3 <= parsed_width / parsed_height <= 3)
            or parsed_width > 3840
            or parsed_height > 3840
            or not (
                GPT_IMAGE_MIN_PIXELS
                <= parsed_width * parsed_height
                <= GPT_IMAGE_MAX_PIXELS
            )
        ):
            raise ValueError("GPT Image size violates official dimension constraints")
    if parameters.get("background") == "transparent":
        raise ValueError("GPT Image 2 transparent background is unsupported")
    if "background" in parameters and parameters["background"] not in {"auto", "opaque"}:
        raise ValueError("GPT Image background is invalid")
    if "quality" in parameters and parameters["quality"] not in {"auto", "low", "medium", "high"}:
        raise ValueError("GPT Image quality is invalid")
    if "moderation" in parameters and parameters["moderation"] not in {"auto", "low"}:
        raise ValueError("GPT Image moderation is invalid")
    suffix = Path(job["outputs"][0]).suffix.casefold()
    formats = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp"}
    if suffix not in formats:
        raise ValueError("unsupported GPT Image output extension")
    references = job.get("references", [])
    if not isinstance(references, list) or len(references) > 16:
        raise ValueError("GPT Image accepts at most sixteen references")
    if any(
        not isinstance(reference, str)
        or Path(reference).suffix.casefold() not in {".png", ".jpg", ".jpeg", ".webp"}
        for reference in references
    ):
        raise ValueError("GPT Image references must be supported image files")
    return {
        "model": OPENAI_MODEL,
        "prompt": prompt,
        "n": 1,
        "output_format": formats[suffix],
        **parameters,
    }


MINIMAX_SPEECH_EMOTIONS = {
    "happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral",
}


def compile_minimax_speech_payload(job: Mapping[str, Any]) -> dict[str, Any]:
    """Compile a tts job into the official MiniMax speech JSON body.

    The voice catalogue is deliberately not enumerated here. Which preset voices
    an account can reach depends on the model and the account, no published list
    is authoritative for both, and a list frozen into this file would either
    refuse a voice that works or vouch for one that does not. The document owns
    the value and a reviewer reads it; the adapter only checks its shape.
    """

    text, parameters = _require_job(job, "tts")
    parameters = _take(
        parameters,
        {"model", "voice_id", "speed", "vol", "pitch", "emotion",
         "sample_rate", "bitrate", "format"},
    )
    model = parameters.pop("model", "")
    if not isinstance(model, str) or not model.strip():
        raise ValueError("MiniMax speech model must be explicitly configured")
    voice_id = parameters.pop("voice_id", "")
    if not isinstance(voice_id, str) or not voice_id.strip() or voice_id != voice_id.strip():
        raise ValueError("MiniMax speech requires a confirmed voice_id")
    if len(text) > MINIMAX_SPEECH_TEXT_LIMIT:
        raise ValueError("MiniMax speech text exceeds the provider limit")

    target_format = Path(job["outputs"][0]).suffix.casefold().lstrip(".")
    requested_format = parameters.pop("format", target_format)
    if requested_format != target_format or requested_format not in {"mp3", "wav"}:
        raise ValueError("MiniMax output format must match a supported target extension")
    sample_rate = parameters.pop("sample_rate", 32000)
    bitrate = parameters.pop("bitrate", 128000)
    if sample_rate not in {16000, 24000, 32000, 44100}:
        raise ValueError("unsupported MiniMax sample rate")
    if bitrate not in {32000, 64000, 128000, 256000}:
        raise ValueError("unsupported MiniMax bitrate")

    voice_setting: dict[str, Any] = {"voice_id": voice_id}
    emotion = parameters.pop("emotion", None)
    if emotion is not None:
        if emotion not in MINIMAX_SPEECH_EMOTIONS:
            raise ValueError("unsupported MiniMax speech emotion")
        voice_setting["emotion"] = emotion
    for name, low, high in (("speed", 0.5, 2.0), ("vol", 0.1, 10.0)):
        value = parameters.pop(name, None)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"MiniMax speech {name} must be a number")
        if not low <= float(value) <= high:
            raise ValueError(f"MiniMax speech {name} is outside the supported range")
        voice_setting[name] = float(value)
    pitch = parameters.pop("pitch", None)
    if pitch is not None:
        if isinstance(pitch, bool) or not isinstance(pitch, int) or not -12 <= pitch <= 12:
            raise ValueError("MiniMax speech pitch is outside the supported range")
        voice_setting["pitch"] = pitch

    return {
        "model": model.strip(),
        "text": text,
        "stream": False,
        "output_format": "hex",
        "voice_setting": voice_setting,
        "audio_setting": {
            "sample_rate": sample_rate,
            "bitrate": bitrate,
            "format": requested_format,
        },
    }


def compile_minimax_music_payload(job: Mapping[str, Any]) -> dict[str, Any]:
    """Compile an audio job into the official MiniMax Music 3.0 JSON body."""
    prompt, parameters = _require_job(job, "music")
    parameters = _take(
        parameters,
        {"lyrics", "sample_rate", "bitrate", "format", "lyrics_optimizer", "is_instrumental"},
    )
    target_format = Path(job["outputs"][0]).suffix.casefold().lstrip(".")
    requested_format = parameters.pop("format", target_format)
    if requested_format != target_format or requested_format not in {"mp3", "wav"}:
        raise ValueError("MiniMax output format must match a supported target extension")
    lyrics = parameters.pop("lyrics", None)
    instrumental = parameters.pop("is_instrumental", False)
    optimizer = parameters.pop("lyrics_optimizer", False)
    if not isinstance(instrumental, bool) or not isinstance(optimizer, bool):
        raise ValueError("MiniMax boolean parameters must be booleans")
    if optimizer:
        raise ValueError("MiniMax lyrics_optimizer is forbidden for confirmed production")
    if instrumental and lyrics not in {None, ""}:
        raise ValueError("MiniMax instrumental music must not carry lyrics")
    if not instrumental and (not isinstance(lyrics, str) or not lyrics.strip()):
        raise ValueError("MiniMax vocal music requires confirmed lyrics")
    if len(prompt) > 2000 or (isinstance(lyrics, str) and len(lyrics) > 3500):
        raise ValueError("MiniMax prompt or lyrics exceeds the provider limit")
    sample_rate = parameters.pop("sample_rate", 44100)
    bitrate = parameters.pop("bitrate", 256000)
    if sample_rate not in {16000, 24000, 32000, 44100}:
        raise ValueError("unsupported MiniMax sample rate")
    if bitrate not in {32000, 64000, 128000, 256000}:
        raise ValueError("unsupported MiniMax bitrate")
    body: dict[str, Any] = {
        "model": MINIMAX_MUSIC_MODEL,
        "prompt": prompt,
        "stream": False,
        "output_format": "hex",
        "audio_setting": {
            "sample_rate": sample_rate,
            "bitrate": bitrate,
            "format": requested_format,
        },
        "lyrics_optimizer": False,
        "is_instrumental": instrumental,
    }
    if lyrics is not None:
        if not isinstance(lyrics, str):
            raise ValueError("MiniMax lyrics must be a string")
        body["lyrics"] = lyrics
    return body


def _base_url(env_name: str, default: str) -> str:
    value = os.environ.get(env_name, default).rstrip("/")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise AdapterFailure(
            "provider base URL is invalid",
            category="configuration",
            code="invalid_base_url",
        )
    return value


def _credential(name: str) -> str:
    raise AdapterFailure(
        f"{name} is not used. Sign in to OkVevo. Nothing was submitted.",
        category="configuration",
        code="vendor_key_removed",
        retryable=False,
    )


def _request_json(
    url: str,
    *,
    provider: str,
    method: str = "POST",
    body: Mapping[str, Any] | None = None,
    token: str,
) -> tuple[dict[str, Any], Mapping[str, str]]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read(MAX_JSON_RESPONSE + 1)
            headers = dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        raise _http_failure(provider, exc) from exc
    except TimeoutError as exc:
        raise AdapterFailure(
            f"{provider} HTTP request timed out",
            category="timeout",
            code="request_timeout",
            retryable=True,
        ) from exc
    except (urllib.error.URLError, OSError) as exc:
        raise AdapterFailure(
            f"{provider} HTTP request failed",
            category="network",
            code="network_error",
            retryable=True,
        ) from exc
    if len(raw) > MAX_JSON_RESPONSE:
        raise AdapterFailure(
            f"{provider} response is too large", code="response_too_large"
        )
    try:
        document = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AdapterFailure(
            f"{provider} returned invalid JSON", code="invalid_json"
        ) from exc
    if not isinstance(document, dict):
        raise AdapterFailure(
            f"{provider} returned an invalid response", code="invalid_response"
        )
    return document, headers


def _read_reference(path: Path) -> bytes:
    before = path.lstat()
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        raise ValueError("reference is not a regular file")
    if before.st_size > MAX_REFERENCE_BYTES:
        raise ValueError("reference exceeds the provider input size limit")
    # Windows opens files in text mode unless told otherwise, which stops the
    # read at the first 0x1A byte -- the seventh byte of every PNG signature.
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
        ):
            raise ValueError("reference changed while opening")
        chunks: list[bytes] = []
        size = 0
        while chunk := os.read(descriptor, 1024 * 1024):
            size += len(chunk)
            if size > MAX_REFERENCE_BYTES:
                raise ValueError("reference exceeds the provider input size limit")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _multipart(fields: Mapping[str, Any], paths: Sequence[Path]) -> tuple[bytes, str]:
    boundary = "short-drama-" + secrets.token_hex(16)
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                str(value).lower().encode() if isinstance(value, bool) else str(value).encode("utf-8"),
                b"\r\n",
            ]
        )
    for path in paths:
        content = _read_reference(path)
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="image[]"; filename="{path.name}"\r\n'.encode(),
                f"Content-Type: {media_type}\r\n\r\n".encode(),
                content,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode())
    encoded = b"".join(chunks)
    if len(encoded) > MAX_MULTIPART_BYTES:
        raise ValueError("multipart provider input exceeds the total size limit")
    return encoded, f"multipart/form-data; boundary={boundary}"


def _reference_paths(job: Mapping[str, Any]) -> list[Path]:
    raw_root = job.get("project_root")
    if not isinstance(raw_root, str) or not Path(raw_root).is_absolute():
        raise ValueError("project_root is invalid")
    root = Path(raw_root).resolve()
    if not root.is_dir():
        raise ValueError("project_root is invalid")
    result: list[Path] = []
    for reference in job.get("references", []):
        if not isinstance(reference, str):
            raise ValueError("reference path is invalid")
        path = (root / reference).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("reference escapes project root") from exc
        if not path.is_file() or path.is_symlink():
            raise ValueError("reference is not a regular file")
        result.append(path)
    return result


def _binding_roles(
    job: Mapping[str, Any], *, allowed: Mapping[str, str], provider: str
) -> list[str]:
    """The provider role of each reference, taken from the confirmed job.

    `role` is the production-side translation of the creator document's 用途, so
    it is the job -- not this adapter -- that decides what a picture is for.
    """
    bindings = job.get("reference_bindings", [])
    references = job.get("references", [])
    if not isinstance(bindings, list) or len(bindings) != len(references):
        raise AdapterFailure(
            f"{provider} references need one reference_bindings entry each, "
            "carrying the provider role for that file",
            category="configuration",
            code="missing_reference_roles",
        )
    roles: list[str] = []
    for binding in bindings:
        role = binding.get("role") if isinstance(binding, Mapping) else None
        if not isinstance(role, str) or role not in allowed:
            raise AdapterFailure(
                f"{provider} reference role must be one of "
                + ", ".join(sorted(allowed))
                + f"; got {role!r}",
                category="configuration",
                code="invalid_reference_role",
            )
        roles.append(role)
    return roles


def _inline_reference_urls(
    paths: Sequence[Path], roles: Sequence[str], *, allowed: Mapping[str, str], provider: str
) -> list[str]:
    """Encode local project references as `data:` URIs the provider accepts."""
    urls: list[str] = []
    total = 0
    for path, role in zip(paths, roles):
        field = allowed[role]
        suffix = path.suffix.casefold()
        mime = INLINE_REFERENCE_MIME.get(suffix)
        expected = field.split("_", 1)[0]
        if mime is None or not mime.startswith(expected):
            raise AdapterFailure(
                f"{provider} {role} does not accept a {suffix or 'suffixless'} file",
                category="configuration",
                code="invalid_reference_type",
            )
        try:
            content = path.read_bytes()
        except OSError as exc:
            raise AdapterFailure(
                f"{provider} could not read a project reference",
                category="configuration",
                code="unreadable_reference",
            ) from exc
        if not content:
            raise AdapterFailure(
                f"{provider} project reference is empty",
                category="configuration",
                code="empty_reference",
            )
        # The bytes have to be the media type the extension claims, or the
        # provider rejects a request this adapter said was well formed.
        _validate_media_content(path.name, content)
        limit = INLINE_REFERENCE_LIMITS[field]
        if len(content) > limit:
            raise AdapterFailure(
                f"{provider} reference exceeds the {limit // (1024 * 1024)}MB inline "
                "limit; host it and bind an HTTPS URL instead",
                category="configuration",
                code="reference_too_large",
            )
        encoded = base64.b64encode(content).decode("ascii")
        total += len(encoded)
        if total > INLINE_REFERENCE_BODY_LIMIT:
            raise AdapterFailure(
                f"{provider} inline references exceed the request body limit; "
                "host the largest ones and bind HTTPS URLs instead",
                category="configuration",
                code="reference_body_too_large",
            )
        urls.append(f"data:{mime};base64,{encoded}")
    return urls


def _is_inline_reference(url: str) -> bool:
    return bool(re.fullmatch(r"data:[\w.+-]+/[\w.+-]+;base64,[A-Za-z0-9+/]+=*", url))


def _validate_media_content(target: str, content: bytes) -> None:
    suffix = Path(target).suffix.casefold()
    signatures = {
        ".png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        ".jpg": content.startswith(b"\xff\xd8\xff"),
        ".jpeg": content.startswith(b"\xff\xd8\xff"),
        ".webp": len(content) >= 12
        and content.startswith(b"RIFF")
        and content[8:12] == b"WEBP",
        ".mp3": content.startswith(b"ID3")
        or (
            len(content) >= 2
            and content[0] == 0xFF
            and content[1] & 0xE0 == 0xE0
        ),
        ".wav": len(content) >= 12
        and content.startswith(b"RIFF")
        and content[8:12] == b"WAVE",
        ".mp4": len(content) >= 12 and content[4:8] == b"ftyp",
    }
    if not signatures.get(suffix, False):
        raise AdapterFailure("provider output does not match the target media type")


def _output_root(job: Mapping[str, Any]) -> Path:
    raw = job.get("output_root")
    if not isinstance(raw, str):
        raise ValueError("output_root is invalid")
    root = Path(raw)
    if not root.is_absolute():
        raise ValueError("output_root is invalid")
    try:
        details = root.lstat()
    except OSError as exc:
        raise ValueError("output_root is missing") from exc
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode):
        raise ValueError("output_root is unsafe")
    return root


def _temporary_output(
    job: Mapping[str, Any], target: str, content: bytes
) -> Path:
    if not content or len(content) > MAX_OUTPUT_BYTES:
        raise AdapterFailure("provider output is too large")
    _validate_media_content(target, content)
    path = _output_root(job) / ("result" + Path(target).suffix.casefold())
    with path.open("xb") as handle:
        handle.write(content)
    return path


def _download(
    job: Mapping[str, Any],
    url: str,
    target: str,
    *,
    provider: str = "seedance",
) -> Path:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise AdapterFailure("provider output URL is invalid")
    if provider == "okvevo":
        host = (parsed.hostname or "").lower()
        if host != "fal.media" and not host.endswith(".fal.media"):
            raise AdapterFailure(
                "output URL is not on the Fal media allowlist",
                category="provider_response",
                code="output_host",
                retryable=False,
            )
    path = _output_root(job) / ("result" + Path(target).suffix.casefold())
    size = 0
    try:
        with urllib.request.urlopen(url, timeout=180) as response, path.open("xb") as handle:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_OUTPUT_BYTES:
                    raise AdapterFailure("provider output is too large")
                handle.write(chunk)
    except AdapterFailure:
        path.unlink(missing_ok=True)
        raise
    except urllib.error.HTTPError as exc:
        path.unlink(missing_ok=True)
        raise _http_failure(provider, exc) from exc
    except TimeoutError as exc:
        path.unlink(missing_ok=True)
        raise AdapterFailure(
            "provider output download timed out",
            category="timeout",
            code="download_timeout",
            retryable=True,
        ) from exc
    except (urllib.error.URLError, OSError) as exc:
        path.unlink(missing_ok=True)
        raise AdapterFailure(
            "provider output download failed",
            category="network",
            code="download_failed",
            retryable=True,
        ) from exc
    if size == 0:
        raise AdapterFailure("provider output is empty")
    with path.open("rb") as handle:
        _validate_media_content(target, handle.read(16))
    return path


def _record_handle(job: Mapping[str, Any], provider_job_id: str) -> None:
    """Write the provider task id where the caller can find it after a crash.

    A video task is billed at submission. Everything after that — polling,
    downloading — can be interrupted, and without this the caller is left with a
    live, already-paid task it has no id for. Written before the first poll, and
    deliberately best-effort: failing to record the handle must not fail a task
    that was submitted successfully.
    """

    destination = job.get("handle_path")
    if not isinstance(destination, str) or not destination:
        return
    try:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_text(
            json.dumps({"provider_job_id": provider_job_id}, ensure_ascii=True),
            encoding="utf-8",
        )
        temporary.replace(path)
    except OSError:
        return


def _collect_target(job: Mapping[str, Any]) -> str | None:
    value = job.get("collect_provider_job_id")
    if isinstance(value, str) and value:
        return value
    return None


def _run_seedance(job: Mapping[str, Any]) -> tuple[Path, str]:
    token = _credential("ARK_API_KEY")
    base = _base_url("SEEDANCE_BASE_URL", SEEDANCE_BASE_URL)
    collecting = _collect_target(job)
    if collecting is not None:
        return _poll_seedance(job, base=base, token=token, task_id=collecting)
    model = os.environ.get("SEEDANCE_MODEL", "")
    references = _reference_paths(job)
    reference_roles = (
        _binding_roles(job, allowed=SEEDANCE_REFERENCE_ROLES, provider="Seedance")
        if references
        else []
    )
    reference_urls = _inline_reference_urls(
        references, reference_roles, allowed=SEEDANCE_REFERENCE_ROLES, provider="Seedance"
    )
    allowed_ratios, duration_range = _seedance_runtime_profile()
    body = compile_seedance_payload(
        job,
        model=model,
        reference_urls=reference_urls,
        reference_roles=reference_roles,
        allowed_ratios=allowed_ratios,
        duration_range=duration_range,
    )
    created, _ = _request_json(
        f"{base}/contents/generations/tasks",
        provider="seedance",
        body=body,
        token=token,
    )
    task_id = created.get("id")
    if not isinstance(task_id, str) or not task_id:
        raise AdapterFailure(
            "Seedance did not return a task id", code="missing_task_id"
        )
    # Billed from here on. Record the id before the first poll.
    _record_handle(job, task_id)
    return _poll_seedance(job, base=base, token=token, task_id=task_id)


def _poll_seedance(
    job: Mapping[str, Any], *, base: str, token: str, task_id: str
) -> tuple[Path, str]:
    try:
        interval = float(os.environ.get("SEEDANCE_POLL_INTERVAL", "5"))
        deadline = time.monotonic() + float(os.environ.get("SEEDANCE_TIMEOUT_SECONDS", "1800"))
    except ValueError as exc:
        raise AdapterFailure("Seedance polling configuration is invalid") from exc
    if interval <= 0 or deadline <= time.monotonic():
        raise AdapterFailure("Seedance polling configuration is invalid")
    while time.monotonic() < deadline:
        status_doc, _ = _request_json(
            f"{base}/contents/generations/tasks/{urllib.parse.quote(task_id, safe='')}",
            provider="seedance",
            method="GET",
            token=token,
        )
        status = status_doc.get("status")
        if status == "succeeded":
            content = status_doc.get("content")
            url = content.get("video_url") if isinstance(content, Mapping) else None
            if not isinstance(url, str):
                raise AdapterFailure(
                    "Seedance succeeded without a video URL",
                    code="missing_video_url",
                    request_id=task_id,
                )
            return _download(
                job,
                url,
                job["outputs"][0],
                provider="seedance",
            ), task_id
        if isinstance(status, str) and status.casefold() in TERMINAL_FAILURES:
            raise AdapterFailure(
                "Seedance task failed",
                code="task_" + status.casefold(),
                request_id=task_id,
            )
        if status not in {"queued", "in_progress", "running", "processing", "pending"}:
            raise AdapterFailure(
                "Seedance returned an unknown task status",
                code="unknown_task_status",
                request_id=task_id,
            )
        time.sleep(interval)
    raise AdapterFailure(
        "Seedance task polling timed out",
        category="timeout",
        code="task_poll_timeout",
        request_id=task_id,
        retryable=True,
    )


def _run_openai(job: Mapping[str, Any]) -> tuple[Path, str | None]:
    token = _credential("OPENAI_API_KEY")
    body = compile_gpt_image_2_payload(job)
    base = _base_url("OPENAI_BASE_URL", OPENAI_BASE_URL)
    references = _reference_paths(job)
    if references:
        encoded, content_type = _multipart(body, references)
        request = urllib.request.Request(f"{base}/images/edits", data=encoded, method="POST")
        request.add_header("Authorization", f"Bearer {token}")
        request.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                raw = response.read(MAX_JSON_RESPONSE + 1)
                request_id = response.headers.get("x-request-id")
        except urllib.error.HTTPError as exc:
            raise _http_failure("gpt-image-2", exc) from exc
        except TimeoutError as exc:
            raise AdapterFailure(
                "OpenAI HTTP request timed out",
                category="timeout",
                code="request_timeout",
                retryable=True,
            ) from exc
        except (urllib.error.URLError, OSError) as exc:
            raise AdapterFailure(
                "OpenAI HTTP request failed",
                category="network",
                code="network_error",
                retryable=True,
            ) from exc
        if len(raw) > MAX_JSON_RESPONSE:
            raise AdapterFailure(
                "OpenAI response is too large",
                code="response_too_large",
                request_id=request_id,
            )
        try:
            result = json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AdapterFailure(
                "OpenAI returned invalid JSON",
                code="invalid_json",
                request_id=request_id,
            ) from exc
    else:
        result, headers = _request_json(
            f"{base}/images/generations",
            provider="gpt-image-2",
            body=body,
            token=token,
        )
        request_id = headers.get("x-request-id")
    data = result.get("data") if isinstance(result, Mapping) else None
    image = data[0].get("b64_json") if isinstance(data, list) and len(data) == 1 and isinstance(data[0], Mapping) else None
    if not isinstance(image, str):
        raise AdapterFailure(
            "OpenAI did not return exactly one image",
            code="missing_image",
            request_id=request_id,
        )
    try:
        content = base64.b64decode(image, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise AdapterFailure(
            "OpenAI returned invalid image data",
            code="invalid_image_data",
            request_id=request_id,
        ) from exc
    return _temporary_output(job, job["outputs"][0], content), request_id


def _run_minimax(job: Mapping[str, Any]) -> tuple[Path, str | None]:
    token = _credential("MINIMAX_API_KEY")
    body = compile_minimax_music_payload(job)
    base = _base_url("MINIMAX_BASE_URL", MINIMAX_BASE_URL)
    result, _ = _request_json(
        f"{base}/music_generation",
        provider="minimax-music",
        body=body,
        token=token,
    )
    base_resp = result.get("base_resp")
    if not isinstance(base_resp, Mapping) or base_resp.get("status_code") != 0:
        raise AdapterFailure(
            "MiniMax music generation failed",
            code=_provider_code(result) or "generation_failed",
            request_id=_safe_token(result.get("trace_id")),
        )
    data = result.get("data")
    audio = data.get("audio") if isinstance(data, Mapping) else None
    if not isinstance(data, Mapping) or data.get("status") != 2 or not isinstance(audio, str):
        raise AdapterFailure(
            "MiniMax did not return audio data",
            code="missing_audio",
            request_id=_safe_token(result.get("trace_id")),
        )
    try:
        content = bytes.fromhex(audio)
    except ValueError as exc:
        raise AdapterFailure("MiniMax returned invalid audio data") from exc
    if not content:
        raise AdapterFailure("MiniMax returned empty audio data")
    trace_id = result.get("trace_id")
    return (
        _temporary_output(job, job["outputs"][0], content),
        trace_id if isinstance(trace_id, str) else None,
    )


def _run_minimax_speech(job: Mapping[str, Any]) -> tuple[Path, str | None]:
    token = _credential("MINIMAX_API_KEY")
    body = compile_minimax_speech_payload(job)
    base = _base_url("MINIMAX_BASE_URL", MINIMAX_BASE_URL)
    result, _ = _request_json(
        f"{base}/t2a_v2",
        provider="minimax-speech",
        body=body,
        token=token,
    )
    base_resp = result.get("base_resp")
    if not isinstance(base_resp, Mapping) or base_resp.get("status_code") != 0:
        raise AdapterFailure(
            "MiniMax speech synthesis failed",
            code=_provider_code(result) or "generation_failed",
            request_id=_safe_token(result.get("trace_id")),
        )
    data = result.get("data")
    audio = data.get("audio") if isinstance(data, Mapping) else None
    if not isinstance(audio, str) or not audio:
        raise AdapterFailure(
            "MiniMax did not return audio data",
            code="missing_audio",
            request_id=_safe_token(result.get("trace_id")),
        )
    try:
        content = bytes.fromhex(audio)
    except ValueError as exc:
        raise AdapterFailure("MiniMax returned invalid audio data") from exc
    if not content:
        raise AdapterFailure("MiniMax returned empty audio data")
    trace_id = result.get("trace_id")
    return (
        _temporary_output(job, job["outputs"][0], content),
        trace_id if isinstance(trace_id, str) else None,
    )


def _run_minimax_video(job: Mapping[str, Any]) -> tuple[Path, str]:
    token = _credential("MINIMAX_API_KEY")
    base = _base_url("MINIMAX_VIDEO_BASE_URL", MINIMAX_VIDEO_BASE_URL)
    collecting = _collect_target(job)
    if collecting is not None:
        return _poll_minimax_video(job, base=base, token=token, task_id=collecting)
    model = os.environ.get("MINIMAX_VIDEO_MODEL", "")
    references = _reference_paths(job)
    reference_roles = (
        _binding_roles(job, allowed=MINIMAX_VIDEO_ROLES, provider="MiniMax")
        if references
        else []
    )
    reference_urls = _inline_reference_urls(
        references, reference_roles, allowed=MINIMAX_VIDEO_ROLES, provider="MiniMax"
    )
    ratios, resolutions, duration_range = _minimax_video_runtime_profile()
    body = compile_minimax_h3_payload(
        job,
        model=model,
        reference_urls=reference_urls,
        reference_roles=reference_roles,
        allowed_ratios=ratios,
        allowed_resolutions=resolutions,
        duration_range=duration_range,
    )
    created, _ = _request_json(
        f"{base}/video_generation",
        provider="minimax-h3",
        body=body,
        token=token,
    )
    task_id = created.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise AdapterFailure(
            "MiniMax did not return a task id",
            code=_provider_code(created) or "missing_task_id",
        )
    # Billed from here on. Record the id before the first poll.
    _record_handle(job, task_id)
    return _poll_minimax_video(job, base=base, token=token, task_id=task_id)


def _poll_minimax_video(
    job: Mapping[str, Any], *, base: str, token: str, task_id: str
) -> tuple[Path, str]:
    try:
        interval = float(os.environ.get("MINIMAX_VIDEO_POLL_INTERVAL", "5"))
        deadline = time.monotonic() + float(
            os.environ.get("MINIMAX_VIDEO_TIMEOUT_SECONDS", "1800")
        )
    except ValueError as exc:
        raise AdapterFailure("MiniMax polling configuration is invalid") from exc
    if interval <= 0 or deadline <= time.monotonic():
        raise AdapterFailure("MiniMax polling configuration is invalid")
    while time.monotonic() < deadline:
        document, _ = _request_json(
            f"{base}/query/video_generation/"
            + urllib.parse.quote(task_id, safe=""),
            provider="minimax-h3",
            method="GET",
            token=token,
        )
        task = document.get("task")
        status = task.get("status") if isinstance(task, Mapping) else None
        if status == "succeeded":
            content = task.get("content") if isinstance(task, Mapping) else None
            url = content.get("url") if isinstance(content, Mapping) else None
            if not isinstance(url, str):
                raise AdapterFailure(
                    "MiniMax succeeded without a video URL",
                    code="missing_video_url",
                    request_id=task_id,
                )
            return _download(
                job, url, job["outputs"][0], provider="minimax-h3"
            ), task_id
        if isinstance(status, str) and status.casefold() in TERMINAL_FAILURES:
            raise AdapterFailure(
                "MiniMax video task failed",
                code="task_" + status.casefold(),
                request_id=task_id,
            )
        if status not in {"queued", "running", "processing", "pending", "in_progress"}:
            raise AdapterFailure(
                "MiniMax returned an unknown task status",
                code="unknown_task_status",
                request_id=task_id,
            )
        time.sleep(interval)
    raise AdapterFailure(
        "MiniMax video task polling timed out",
        category="timeout",
        code="task_poll_timeout",
        request_id=task_id,
        retryable=True,
    )


# Phase 1 portal path. Extend (video input) stays in the map for Phase 2.
PHASE = 1
SPEECH_MAX_CHARS = 5000

# Verified 2026-10-10 from fal-ai/minimax/speech-02-hd OpenAPI.
# voice_id is a string, default Wise_Woman. These ids are the schema examples,
# not a closed enum. language_boost includes Hindi. No Hindi-specific voice id
# is in the examples, so Hindi uses a verified voice plus language_boost Hindi.
VERIFIED_VOICE_IDS = frozenset({
    "Wise_Woman", "Friendly_Person", "Inspirational_girl", "Deep_Voice_Man",
    "Calm_Woman", "Casual_Guy", "Lively_Girl", "Patient_Man", "Young_Knight",
    "Determined_Man", "Lovely_Girl", "Decent_Boy", "Imposing_Manner",
    "Elegant_Man", "Abbess", "Sweet_Girl_2", "Exuberant_Girl",
})
VOICE_TABLE = {
    ("en", "adult", "female"): ("Wise_Woman", None),
    ("en", "adult", "male"): ("Deep_Voice_Man", None),
    ("en", "young", "female"): ("Lively_Girl", None),
    ("en", "young", "male"): ("Young_Knight", None),
    ("zh", "adult", "female"): ("Calm_Woman", "Chinese"),
    ("zh", "adult", "male"): ("Patient_Man", "Chinese"),
    ("hi", "adult", "female"): ("Wise_Woman", "Hindi"),
    ("hi", "adult", "male"): ("Deep_Voice_Man", "Hindi"),
}

PORTAL_ENDPOINTS = {
    "seedance-2.5": {
        "text": "bytedance/seedance-2.5/text-to-video",
        "image": "bytedance/seedance-2.5/image-to-video",
        "extend": "bytedance/seedance-2.5/reference-to-video",
    },
    "seedance-2.0": {
        "text": "bytedance/seedance-2.0/text-to-video",
        "image": "bytedance/seedance-2.0/image-to-video",
        "extend": "bytedance/seedance-2.0/reference-to-video",
    },
    "h3-max": {
        "text": "minimax/h3-max/text-to-video",
        "image": "minimax/h3-max/image-to-video",
        "reference": "minimax/h3-max/reference-to-video",
    },
    "wan-3.0": {
        "text": "alibaba/wan-3.0-prime/text-to-video",
        "image": "alibaba/wan-3.0-prime/image-to-video",
        "reference": "alibaba/wan-3.0-prime/reference-to-video",
    },
    "gpt-image-2": {
        "text": "openai/gpt-image-2",
        "edit": "openai/gpt-image-2/edit",
    },
    "music-3": {"music": "minimax/music-3"},
    "speech-02-hd": {"tts": "fal-ai/minimax/speech-02-hd"},
}


def map_speech_voice(language: str, age: str, gender: str) -> tuple[str, str | None]:
    key = (language.lower()[:2], age.lower(), gender.lower())
    if key not in VOICE_TABLE:
        raise ValueError(f"no Phase 1 voice for language={language} age={age} gender={gender}")
    voice_id, boost = VOICE_TABLE[key]
    if voice_id not in VERIFIED_VOICE_IDS:
        raise ValueError("voice id is not in the verified speech-02-hd examples")
    return voice_id, boost


def prepare_speech(job: Mapping[str, Any], *, hold: Any = None) -> dict[str, Any]:
    """Fail before hold. hold is unused and must stay uncalled."""
    bindings = job.get("reference_bindings") or []
    if any(b.get("role") in {"reference_audio", "voice_clone"} for b in bindings if isinstance(b, Mapping)):
        raise ValueError("Phase 1 speech does not accept reference audio for voice cloning. Nothing was submitted.")
    text = str(job.get("prompt") or "")
    if len(text) > SPEECH_MAX_CHARS:
        raise ValueError(f"speech text exceeds {SPEECH_MAX_CHARS} characters. Nothing was submitted.")
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    direction = params.get("voice_direction") if isinstance(params, Mapping) else None
    if isinstance(direction, Mapping):
        voice_id, boost = map_speech_voice(
            str(direction.get("language") or "en"),
            str(direction.get("age") or "adult"),
            str(direction.get("gender") or "female"),
        )
    else:
        voice_id, boost = "Wise_Woman", None
    return {"text": text, "voice_id": voice_id, "language_boost": boost, "endpoint": PORTAL_ENDPOINTS["speech-02-hd"]["tts"]}


def phase1_scene(shots: Sequence[Mapping[str, Any]], *, ffmpeg_available: bool, hold: Any = None) -> list[dict[str, Any]]:
    """Adjacent shots in one scene. Phase 1 uses the previous last frame as an image, not extend."""
    compiled: list[dict[str, Any]] = []
    for index, shot in enumerate(shots):
        task = str(shot.get("task") or "text")
        continuous = bool(shot.get("continuous")) and index > 0
        if continuous and shot.get("needs_frame_extract") and not ffmpeg_available:
            raise ValueError(
                "ffmpeg is not available, so the previous shot's last frame cannot be extracted. "
                "Nothing was submitted."
            )
        if continuous and (task == "extend" or shot.get("video_input")):
            if PHASE < 2:
                frame = shot.get("start_frame") or shots[index - 1].get("last_frame")
                if not frame:
                    raise ValueError(
                        "Phase 1 continuous shot needs the previous shot's real last frame. Nothing was submitted."
                    )
                compiled.append({
                    "task": "image",
                    "endpoint": PORTAL_ENDPOINTS["seedance-2.5"]["image"],
                    "image_url": frame,
                })
                continue
            compiled.append({"task": "extend", "endpoint": PORTAL_ENDPOINTS["seedance-2.5"]["extend"]})
            continue
        mode = "image" if task == "image" else "text"
        compiled.append({"task": mode, "endpoint": PORTAL_ENDPOINTS["seedance-2.5"][mode]})
    if hold is not None:
        raise AssertionError("phase1_scene must not hold")
    return compiled


def explicit_portal_args(job: Mapping[str, Any], endpoint: str) -> dict[str, Any]:
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    args = dict(params)
    if "video" in endpoint or endpoint.endswith("music-3"):
        args.setdefault("resolution", "720p")
        args.setdefault("duration", 5)
        args.setdefault("generate_audio", True)
    if "gpt-image-2" in endpoint:
        args.setdefault("quality", "high")
        args.setdefault("image_size", "1024x1024")
    if endpoint.endswith("/edit"):
        # The gateway meters edit references by count, not by bytes; without
        # this the job would meter as zero references.
        args["reference_image_count"] = len(job.get("references") or [])
    if job.get("quality"):
        args["quality"] = job["quality"]
    elif "quality" not in args and "gpt-image-2" in endpoint:
        args["quality"] = "high"
    return args


def _portal_image_data_url(path: Path) -> str:
    """One reference image as a data URL, downscaled/re-encoded via ffmpeg when
    the raw bytes or dimensions would blow the portal body cap. Fail-closed:
    every problem raises AdapterFailure before anything is submitted."""
    suffix = path.suffix.casefold()
    mime = INLINE_REFERENCE_MIME.get(suffix)
    if mime is None or not mime.startswith("image"):
        raise AdapterFailure(
            f"portal reference {path.name} is not a supported image",
            category="configuration",
            code="invalid_reference_type",
            retryable=False,
        )
    try:
        content = path.read_bytes()
    except OSError as exc:
        raise AdapterFailure(
            "portal could not read a project reference",
            category="configuration",
            code="unreadable_reference",
            retryable=False,
        ) from exc
    if not content:
        raise AdapterFailure(
            "portal project reference is empty",
            category="configuration",
            code="empty_reference",
            retryable=False,
        )
    _validate_media_content(path.name, content)
    width, height, pix_fmt = _probe_image(path)
    alpha = _has_alpha(pix_fmt)
    if len(content) <= PORTAL_PASSTHROUGH_BYTES and max(width, height) <= PORTAL_IMAGE_EDGE:
        out_mime, out = mime, content
    else:
        out_mime = "image/png" if alpha else "image/jpeg"
        out = _downscale_image(path, alpha=alpha)
    encoded = base64.b64encode(out).decode("ascii")
    return f"data:{out_mime};base64,{encoded}"


def _has_alpha(pix_fmt: str) -> bool:
    # ponytail: exotic alpha layouts (e.g. ya16be) fall through to JPEG and are
    # flattened; the common PNG/WebP formats are covered. Upgrade: parse the
    # full pix_fmt list from ffprobe -pix_fmts.
    fmt = pix_fmt.strip().lower()
    return fmt.startswith(("rgba", "bgra", "argb", "abgr", "yuva")) or fmt in {"ya8", "ya16"}


def _probe_image(path: Path) -> tuple[int, int, str]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise AdapterFailure(
            "ffprobe is required to prepare reference images. Nothing was submitted.",
            code="missing_ffprobe",
            retryable=False,
        )
    result = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,pix_fmt", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=30,
    )
    parts = result.stdout.strip().split(",")
    if result.returncode != 0 or len(parts) < 2:
        raise AdapterFailure(
            f"ffprobe could not read reference image {path.name}. Nothing was submitted.",
            category="configuration",
            code="invalid_reference_type",
            retryable=False,
        )
    try:
        return int(parts[0]), int(parts[1]), parts[2] if len(parts) > 2 else ""
    except ValueError as exc:
        raise AdapterFailure(
            f"ffprobe could not read reference image {path.name}. Nothing was submitted.",
            category="configuration",
            code="invalid_reference_type",
            retryable=False,
        ) from exc


def _downscale_image(path: Path, *, alpha: bool) -> bytes:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AdapterFailure(
            "ffmpeg is required to downscale reference images. Nothing was submitted.",
            code="missing_ffmpeg",
            retryable=False,
        )
    fd, out_path = tempfile.mkstemp(suffix=".png" if alpha else ".jpg")
    os.close(fd)
    try:
        command = [
            ffmpeg, "-y", "-v", "error", "-i", str(path),
            "-vf", f"scale='min({PORTAL_IMAGE_EDGE},iw)':'min({PORTAL_IMAGE_EDGE},ih)':force_original_aspect_ratio=decrease",
            "-frames:v", "1",
        ]
        if not alpha:
            command += ["-q:v", "4"]  # ~JPEG q90: reference fidelity, sane bytes
        command.append(out_path)
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise AdapterFailure(
                f"ffmpeg could not downscale reference image {path.name}. Nothing was submitted.",
                code="downscale_failed",
                retryable=False,
            )
        return Path(out_path).read_bytes()
    finally:
        Path(out_path).unlink(missing_ok=True)


def _portal_media_args(job: Mapping[str, Any], endpoint: str) -> dict[str, Any]:
    """Inline the reference images Fal expects. The portal forwards the full
    body to Fal, so these keys pass straight through; metering never sees them
    (it reads SUBMIT_KEYS only). Any failure here is before any hold."""
    refs = [Path(p) for p in (job.get("references") or [])]
    if endpoint.endswith("/image-to-video"):
        if not refs:
            raise AdapterFailure(
                "portal image-to-video needs a first-frame reference. Nothing was submitted.",
                category="configuration",
                code="invalid_reference_type",
                retryable=False,
            )
        if len(refs) > 1:
            raise AdapterFailure(
                "portal video accepts one first-frame reference per job; multi-image "
                "reference sets are not supported yet. Nothing was submitted.",
                code="too_many_refs",
                retryable=False,
            )
        return {"image_url": _portal_image_data_url(refs[0])}
    if endpoint.endswith("/edit"):
        if not refs:
            raise AdapterFailure(
                "portal image edit needs at least one reference. Nothing was submitted.",
                category="configuration",
                code="invalid_reference_type",
                retryable=False,
            )
        return {"image_urls": [_portal_image_data_url(path) for path in refs]}
    return {}


def _selftest() -> None:
    scene = phase1_scene(
        [
            {"task": "text", "continuous": True, "last_frame": "shot-1-last.png"},
            {"task": "extend", "continuous": True, "start_frame": "shot-1-last.png"},
        ],
        ffmpeg_available=True,
    )
    if not scene[1]["endpoint"].endswith("image-to-video"):
        raise AssertionError("phase 1 continuous shot 2 must be image-to-video")
    if scene[1]["task"] == "extend":
        raise AssertionError("phase 1 must not emit an extend job")
    try:
        phase1_scene(
            [
                {"task": "text", "last_frame": "a.png"},
                {"task": "extend", "continuous": True, "needs_frame_extract": True},
            ],
            ffmpeg_available=False,
        )
    except ValueError as exc:
        if "ffmpeg" not in str(exc):
            raise AssertionError("missing ffmpeg must be reported") from exc
    else:
        raise AssertionError("missing ffmpeg was accepted")
    speech = prepare_speech({
        "prompt": "Hello, world 2.",
        "parameters": {"voice_direction": {"language": "hi", "age": "adult", "gender": "female"}},
    })
    if speech["voice_id"] != "Wise_Woman" or speech["language_boost"] != "Hindi":
        raise AssertionError("Hindi voice map failed")
    try:
        prepare_speech({"prompt": "x" * (SPEECH_MAX_CHARS + 1)})
    except ValueError as exc:
        if str(SPEECH_MAX_CHARS) not in str(exc):
            raise AssertionError("speech max must be reported") from exc
    else:
        raise AssertionError("over-long speech was accepted")
    image = {
        "modality": "image", "prompt": "portrait", "references": [],
        "outputs": ["制作成果/a.png"], "parameters": {"width": 1024, "height": 1536},
    }
    video = {
        "modality": "video", "prompt": "slow push in", "references": [],
        "outputs": ["制作成果/a.mp4"], "parameters": {"duration": 5, "ratio": "9:16"},
    }
    music = {
        "modality": "music", "prompt": "cinematic", "references": [],
        "outputs": ["制作成果/a.mp3"], "parameters": {"lyrics": "[Verse]\nHello"},
    }
    speech = {
        "modality": "tts", "prompt": "你们做了多久？", "references": [],
        "outputs": ["制作成果/a.mp3"],
        "parameters": {"model": "configured-speech-model", "voice_id": "a-preset"},
    }
    if compile_gpt_image_2_payload(image)["model"] != OPENAI_MODEL:
        raise RuntimeError("GPT Image 2 self-test failed")
    if compile_minimax_speech_payload(speech)["voice_setting"]["voice_id"] != "a-preset":
        raise RuntimeError("MiniMax speech self-test failed")
    seedance = compile_seedance_payload(
        video,
        model="configured-model",
        allowed_ratios={"9:16"},
        duration_range=(5, 10),
    )
    if seedance["model"] != "configured-model":
        raise RuntimeError("Seedance model self-test failed")
    if seedance.get("ratio") != "9:16" or seedance.get("duration") != 5:
        raise RuntimeError("Seedance parameter self-test failed")
    minimax_video = compile_minimax_h3_payload(
        {**video, "parameters": {"duration": 6, "ratio": "9:16", "resolution": "768P"}},
        model="configured-video-model",
        allowed_ratios={"9:16"},
        allowed_resolutions={"768P"},
        duration_range=(4, 15),
    )
    if minimax_video["model"] != "configured-video-model":
        raise RuntimeError("MiniMax video model self-test failed")
    if minimax_video["duration"] != 6 or minimax_video["resolution"] != "768P":
        raise RuntimeError("MiniMax video parameter self-test failed")
    try:
        compile_minimax_h3_payload(
            {**video, "parameters": {"duration": 6, "resolution": "768P"}},
            model="configured-video-model",
            allowed_resolutions={"768P"},
            duration_range=(4, 15),
        )
    except ValueError:
        pass
    else:
        raise AssertionError("MiniMax text-to-video without a ratio was accepted")
    compiled_music = compile_minimax_music_payload(music)
    if compiled_music["model"] != MINIMAX_MUSIC_MODEL:
        raise RuntimeError("MiniMax model self-test failed")
    if compiled_music["output_format"] != "hex":
        raise RuntimeError("MiniMax output self-test failed")
    for invalid_image in (
        {**image, "parameters": {"background": "transparent"}},
        {**image, "parameters": {"input_fidelity": "high"}},
        {**image, "parameters": {"size": "1023x1024"}},
    ):
        try:
            compile_gpt_image_2_payload(invalid_image)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid GPT Image payload was accepted")
    invalid_reference = {**video, "references": ["clip.mp4"]}
    try:
        compile_seedance_payload(
            invalid_reference,
            model="configured-model",
            reference_urls=["asset://asset-example-clip"],
            reference_roles=["reference_image"],
        )
    except ValueError:
        pass
    else:
        raise AssertionError("mismatched Seedance reference role was accepted")


def _gateway_helpers():
    root = Path(__file__).resolve().parents[4]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from agent.okvevo_gateway import (
        _QUOTE_ARG_KEYS,
        read_okvevo_id_token,
        resolve_okvevo_fal_gateway,
    )
    return read_okvevo_id_token, resolve_okvevo_fal_gateway, _QUOTE_ARG_KEYS


def _portal_endpoint(job: Mapping[str, Any]) -> str:
    modality = str(job.get("modality") or "")
    if modality in {"tts", "speech"}:
        return prepare_speech(job)["endpoint"]
    if modality == "music":
        return PORTAL_ENDPOINTS["music-3"]["music"]
    if modality == "image":
        refs = job.get("references") or []
        mode = "edit" if refs else "text"
        # Mirror of GPT_IMAGE_MAX_REFS in OkVevo-Web rateCard.ts. Capped at 4
        # until the billing-events smoke prices edit input tokens (1 vs 4 refs).
        if mode == "edit" and len(refs) > 4:
            raise AdapterFailure(
                "gpt-image-2 edit accepts at most 4 reference images. Nothing was submitted.",
                code="too_many_refs",
                retryable=False,
            )
        return PORTAL_ENDPOINTS["gpt-image-2"][mode]
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    model = str(params.get("model") or job.get("model") or "").lower()
    family = "seedance-2.5"
    if "wan" in model:
        family = "wan-3.0"
    elif "h3" in model:
        family = "h3-max"
    elif "2.0" in model and "2.5" not in model:
        family = "seedance-2.0"
    task = str(params.get("task") or params.get("omni_reference_task_type") or "").lower()
    if task in {"extend", "edit"} or params.get("video_url") or params.get("audio_url"):
        try:
            scene = phase1_scene(
                [{"task": "text", "last_frame": params.get("start_frame") or params.get("image_url")},
                 {"task": "extend", "continuous": True,
                  "start_frame": params.get("start_frame") or params.get("image_url"),
                  "needs_frame_extract": bool(params.get("needs_frame_extract")),
                  "video_input": True}],
                ffmpeg_available=shutil.which("ffmpeg") is not None,
            )
        except ValueError as exc:
            raise AdapterFailure(str(exc), code="phase1", retryable=False) from exc
        return scene[1]["endpoint"]
    refs = job.get("references") or []
    mode = "image" if refs else "text"
    return PORTAL_ENDPOINTS[family][mode]


def _quote_portal(job: Mapping[str, Any]) -> dict[str, Any]:
    """Read-only credit estimate from POST /api/fal/quote. Fail-closed: any
    failure is an AdapterFailure so the skill cannot confirm an unpriced job.
    Never reserves, never debits, never submits."""
    endpoint = _portal_endpoint(job)
    read_token, resolve, quote_keys = _gateway_helpers()
    gateway = resolve()
    if gateway is None or not read_token():
        raise AdapterFailure(
            "Sign in to OkVevo to see the credit estimate. Nothing was submitted.",
            category="authentication",
            code="signed_out",
            retryable=False,
        )
    origin = (os.environ.get("OKVEVO_WEB_ORIGIN") or "").strip().rstrip("/")
    if not origin:
        raise AdapterFailure(
            "OkVevo portal origin is not configured. Nothing was submitted.",
            category="configuration",
            code="quote_unavailable",
            retryable=False,
        )
    args = {
        key: value
        for key, value in explicit_portal_args(job, endpoint).items()
        if key in quote_keys
    }
    body = json.dumps({"endpoint": endpoint, "args": args}).encode("utf-8")
    request = urllib.request.Request(
        f"{origin}/api/fal/quote",
        data=body,
        method="POST",
        headers={"Authorization": f"Key {read_token()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            quoted = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise AdapterFailure(
                "Sign in to OkVevo to see the credit estimate. Nothing was submitted.",
                category="authentication",
                code="signed_out",
                http_status=exc.code,
                retryable=False,
            ) from exc
        raise AdapterFailure(
            "OkVevo could not quote this job. Nothing was submitted.",
            category="provider_response",
            code="quote_unavailable",
            http_status=exc.code,
            retryable=exc.code >= 500,
        ) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise AdapterFailure(
            "OkVevo could not quote this job. Nothing was submitted.",
            category="timeout",
            code="quote_unavailable",
            retryable=True,
        ) from exc
    credits = quoted.get("credits") if isinstance(quoted, Mapping) else None
    if not isinstance(credits, int) or isinstance(credits, bool) or credits < 0:
        raise AdapterFailure(
            "OkVevo returned an unusable quote. Nothing was submitted.",
            category="provider_response",
            code="quote_unavailable",
            retryable=True,
        )
    return {
        "estimate": True,
        "estimated_credits": credits,
        "snapshotId": quoted.get("snapshotId") if isinstance(quoted.get("snapshotId"), str) else None,
        "expiresAt": quoted.get("expiresAt") if isinstance(quoted.get("expiresAt"), str) else None,
    }


def _run_portal(job: Mapping[str, Any]) -> tuple[Path, str]:
    if job.get("modality") in {"tts", "speech"}:
        try:
            prepare_speech(job)
        except ValueError as exc:
            raise AdapterFailure(str(exc), code="phase1", retryable=False) from exc
    endpoint = _portal_endpoint(job)
    read_token, resolve, _quote_keys = _gateway_helpers()
    gateway = resolve()
    if gateway is None or not read_token():
        raise AdapterFailure(
            "Sign in to OkVevo to generate. Nothing was submitted.",
            category="authentication",
            code="signed_out",
            retryable=False,
        )
    token = read_token()
    args = explicit_portal_args(job, endpoint)
    if isinstance(job.get("run_id"), str):
        args["run_id"] = job["run_id"]
    if isinstance(job.get("approved_credits"), int):
        args["approved_credits"] = job["approved_credits"]
    args.update(_portal_media_args(job, endpoint))
    origin = str(gateway.gateway_origin).rstrip("/")
    url = f"{origin}/{endpoint}"
    body = json.dumps(args).encode("utf-8")
    if len(body) > PORTAL_INLINE_BODY_LIMIT:
        raise AdapterFailure(
            "references are too large for the portal even after downscaling; "
            "use fewer or smaller reference images. Nothing was submitted.",
            category="configuration",
            code="reference_body_too_large",
            retryable=False,
        )
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Authorization": f"Key {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            submitted = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise AdapterFailure(
            "OkVevo did not accept the job. Nothing further was submitted.",
            category="provider_response",
            code="submit_rejected",
            http_status=exc.code,
            retryable=False,
        ) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise AdapterFailure(
            "OkVevo submit outcome is unknown. The hold is kept. Do not submit again.",
            category="timeout",
            code="submit_unknown",
            retryable=False,
        ) from exc
    request_id = str(submitted.get("request_id") or "")
    if not request_id:
        raise AdapterFailure(
            "OkVevo submit outcome is unknown. The hold is kept. Do not submit again.",
            code="submit_unknown",
            retryable=False,
        )
    _record_handle(job, request_id)
    status_url = str(submitted.get("status_url") or "")
    deadline = time.time() + 3600
    delay = 1.0
    retried_auth = False
    while time.time() < deadline:
        token = read_token()
        poll = urllib.request.Request(status_url, headers={"Authorization": f"Key {token}"})
        try:
            with urllib.request.urlopen(poll, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and not retried_auth:
                retried_auth = True
                continue
            raise AdapterFailure("status poll failed", http_status=exc.code, retryable=False) from exc
        status = str(payload.get("status") or "").upper()
        if status == "COMPLETED":
            result_url = ""
            video = payload.get("video") if isinstance(payload.get("video"), Mapping) else None
            if isinstance(video, Mapping) and isinstance(video.get("url"), str):
                result_url = video["url"]
            elif isinstance(payload.get("url"), str):
                result_url = payload["url"]
            if not result_url:
                raise AdapterFailure("completed job has no download URL", retryable=False)
            target = str((job.get("outputs") or ["out.bin"])[0])
            return _download(job, result_url, target, provider="okvevo"), request_id
        if status in {"FAILED", "ERROR"}:
            raise AdapterFailure("generation failed", code="fal_failed", retryable=False)
        time.sleep(delay)
        delay = min(delay * 2, 8)
    raise AdapterFailure("timed out waiting for the result", code="poll_timeout", retryable=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "provider",
        nargs="?",
        choices=(
            "seedance", "gpt-image-2", "minimax-music", "minimax-h3",
            "minimax-speech", "portal", "quote",
        ),
    )
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        _selftest()
        return 0
    if args.provider is None:
        parser.error("provider is required unless --selftest is used")
    try:
        job = json.load(sys.stdin.buffer)
        if not isinstance(job, Mapping):
            raise ValueError("adapter input must be an object")
        if args.provider == "quote" or (
            args.provider == "portal" and job.get("quote_only") is True
        ):
            json.dump(_quote_portal(job), sys.stdout, ensure_ascii=True)
            return 0
        path, provider_job_id = _run_portal(job)
        response: dict[str, Any] = {
            "outputs": [{"target": job["outputs"][0], "source": str(path)}]
        }
        if provider_job_id:
            response["provider_job_id"] = provider_job_id
        json.dump(response, sys.stdout, ensure_ascii=True)
        return 0
    except AdapterFailure as exc:
        # Provider bodies and credentials are intentionally never reflected.
        # The runner validates error.provider against the job's adapter profile
        # name, so emit that, not the argv word.
        profile = str(job.get("adapter") or args.provider)
        json.dump({"error": exc.public(profile)}, sys.stdout, ensure_ascii=True)
        print("provider adapter failed safely", file=sys.stderr)
        return 1
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        json.dump(
            {
                "error": {
                    "provider": args.provider,
                    "category": "invalid_request",
                    "code": "invalid_job",
                    "retryable": False,
                }
            },
            sys.stdout,
            ensure_ascii=True,
        )
        print("provider adapter failed safely", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
