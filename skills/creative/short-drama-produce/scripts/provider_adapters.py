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
import calendar
import hashlib
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


def _record_handle(
    job: Mapping[str, Any],
    provider_job_id: str,
    *,
    endpoint: str | None = None,
    fal_urls: Collection[str] = (),
    finished_at: float | None = None,
) -> None:
    """Write the provider task id where the caller can find it after a crash.

    A video task is billed at submission. Everything after that — polling,
    downloading — can be interrupted, and without this the caller is left with a
    live, already-paid task it has no id for. Written before the first poll, and
    deliberately best-effort: failing to record the handle must not fail a task
    that was submitted successfully. On success the endpoint and Fal output URLs
    are added so an audit can trace which Fal media a job produced.
    """

    destination = job.get("handle_path")
    if not isinstance(destination, str) or not destination:
        return
    record: dict[str, Any] = {"provider_job_id": provider_job_id}
    if endpoint:
        record["endpoint"] = endpoint
    if fal_urls:
        record["fal_urls"] = list(fal_urls)
    if finished_at is not None:
        record["finished_at"] = finished_at
    try:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(record, ensure_ascii=True), encoding="utf-8")
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


# OkVevo portal path (full parity). References reach Fal through the portal's
# measured-upload flow (POST /api/fal/uploads -> signed PUT -> complete), never
# inline: the portal sniffs the type and measures duration/pixels server-side
# and prices deterministically from those measurements. A prior upload or a
# prior Fal output still inside its retention window is reused via the media
# cache instead of uploading again.
SPEECH_MAX_CHARS = 5000
# MiniMax speech-02-hd. voice_id is a string (schema default Wise_Woman);
# custom_voice_id from fal-ai/minimax/voice-clone is accepted the same way.
# language_boost includes Hindi. $0.10 / 1k chars.
PORTAL_SPEECH_ENDPOINT = "fal-ai/minimax/speech-02-hd"
# $1.50 / clone + $0.30 / 1k preview chars. Preview is billed on the clone
# endpoint. Fal retains the voice only if it is used with a TTS endpoint
# within 7 days (llms.txt 2026-10-10). The clone preview is not that TTS use.
PORTAL_VOICE_CLONE_ENDPOINT = "fal-ai/minimax/voice-clone"
VOICE_CLONE_MIN_SECONDS = 10
VOICE_CLONE_RETAIN_DAYS = 7
VOICE_CLONE_WARN_DAYS = 6
VOICE_CLONE_PREVIEW = "This is a short preview of the cloned voice."
PORTAL_IMAGE_EDGE = 2048
PORTAL_UPLOAD_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
}
# Mirrors UPLOAD_CAPS in OkVevo-Web src/lib/fal/uploads.ts.
PORTAL_UPLOAD_CAPS = {
    "image": 30 * 1024 * 1024,
    "video": 200 * 1024 * 1024,
    "audio": 15 * 1024 * 1024,
}
# Cache reuse windows, mirrors of the portal: drama uploads live 7 days
# (lifecycle rule), Fal output URLs are reused only while the portal's media
# index still knows them (conservative 48 h).
PORTAL_UPLOAD_REUSE_S = 6 * 24 * 3600
PORTAL_FAL_REUSE_S = 48 * 3600
PORTAL_MEDIA_CACHE = "fal-media-cache.json"
PORTAL_GPT_EDIT_MAX_REFS = 16

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
        "reference": "bytedance/seedance-2.5/reference-to-video",
    },
    "seedance-2.0": {
        "text": "bytedance/seedance-2.0/text-to-video",
        "image": "bytedance/seedance-2.0/image-to-video",
        "reference": "bytedance/seedance-2.0/reference-to-video",
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
    "speech-02-hd": {"tts": PORTAL_SPEECH_ENDPOINT},
    "voice-clone": {"clone": PORTAL_VOICE_CLONE_ENDPOINT},
}

# Seedance extend/edit (task) exists only on the 2.5 reference endpoint.
PORTAL_TASK_ENDPOINT = "bytedance/seedance-2.5/reference-to-video"
_PORTAL_TASK = {
    "extend": "extension",
    "extension": "extension",
    "edit": "editing",
    "editing": "editing",
    "reference": "reference",
    "auto": "reference",
}
PORTAL_BINDING_ROLES = frozenset({
    "first_frame", "last_frame", "reference_image", "reference_video",
    "reference_audio",
})


def map_speech_voice(language: str, age: str, gender: str) -> tuple[str, str | None]:
    key = (language.lower()[:2], age.lower(), gender.lower())
    if key not in VOICE_TABLE:
        raise ValueError(f"no portal voice for language={language} age={age} gender={gender}")
    voice_id, boost = VOICE_TABLE[key]
    if voice_id not in VERIFIED_VOICE_IDS:
        raise ValueError("voice id is not in the verified speech-02-hd examples")
    return voice_id, boost


def _character_key(job: Mapping[str, Any]) -> str:
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    direction = params.get("voice_direction") if isinstance(params.get("voice_direction"), Mapping) else {}
    for candidate in (
        direction.get("character") if isinstance(direction, Mapping) else None,
        params.get("character"),
        job.get("character"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            slug = re.sub(r"[^A-Za-z0-9._-]+", "-", candidate.strip())[:80].strip("-")
            return slug or "default"
    return "default"


def _project_key(job: Mapping[str, Any]) -> str:
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    for candidate in (job.get("project"), params.get("project")):
        if isinstance(candidate, str) and candidate.strip():
            slug = re.sub(r"[^A-Za-z0-9._-]+", "-", candidate.strip())[:80].strip("-")
            return slug
    return ""


def _voice_store_path(job: Mapping[str, Any]) -> Path | None:
    character = _character_key(job)
    handle = job.get("handle_path")
    if isinstance(handle, str) and handle:
        return Path(handle).parent / "metadata" / "voices" / f"{character}.json"
    root = job.get("output_root") or job.get("project_root") or job.get("workdir")
    if isinstance(root, str) and root:
        return Path(root) / "metadata" / "voices" / f"{character}.json"
    return None


def _voice_store_read_local(job: Mapping[str, Any]) -> dict[str, Any] | None:
    path = _voice_store_path(job)
    if path is None:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _try_portal_voices(http: Any = None) -> list[Any]:
    """Fail-soft: missing sign-in or a dead portal returns []. Never clones."""
    try:
        client = http if http is not None else _default_portal_http()
        data = client.get_json("/api/fal/voices")
    except Exception:
        return []
    voices = data.get("voices") if isinstance(data, Mapping) else None
    return list(voices) if isinstance(voices, list) else []


def _voice_store_read(
    job: Mapping[str, Any], *, http: Any = None, fetch_portal: bool = True
) -> dict[str, Any] | None:
    """Local metadata/voices file is a cache. Missing file → portal list."""
    local = _voice_store_read_local(job)
    if local and isinstance(local.get("custom_voice_id"), str) and local["custom_voice_id"].strip():
        return local
    if not fetch_portal:
        return local
    character = _character_key(job)
    for row in _try_portal_voices(http):
        if not isinstance(row, Mapping):
            continue
        if str(row.get("character") or "") != character:
            continue
        voice_id = row.get("custom_voice_id")
        if not isinstance(voice_id, str) or not voice_id.strip():
            continue
        record = {
            "custom_voice_id": voice_id.strip(),
            "cloned_at": row.get("cloned_at") if isinstance(row.get("cloned_at"), str) else None,
            "used_in_tts_at": row.get("used_in_tts_at") if isinstance(row.get("used_in_tts_at"), str) else None,
            "character": character,
            "project": row.get("project") if isinstance(row.get("project"), str) else _project_key(job),
            "consent_at": row.get("consent_at") if isinstance(row.get("consent_at"), str) else None,
            "sample_sha256": row.get("sample_sha256") if isinstance(row.get("sample_sha256"), str) else None,
            "endpoint": PORTAL_VOICE_CLONE_ENDPOINT,
        }
        try:
            _voice_store_write(job, record)
        except ValueError:
            pass
        return record
    return local


def delete_cloned_voice(job: Mapping[str, Any], *, http: Any = None) -> dict[str, Any]:
    """Remove our portal record (and the local cache). Fal has no delete-voice API."""
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    voice_id = params.get("custom_voice_id")
    if not isinstance(voice_id, str) or not voice_id.strip():
        store = _voice_store_read(job, http=http)
        voice_id = store.get("custom_voice_id") if store else None
    if not isinstance(voice_id, str) or not voice_id.strip():
        raise ValueError("no cloned voice to delete for this character. Nothing was submitted.")
    voice_id = voice_id.strip()
    try:
        client = http if http is not None else _default_portal_http()
        result = client.delete_json(f"/api/fal/voices/{urllib.parse.quote(voice_id, safe='')}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError("voice not found on the portal. Nothing was submitted.") from exc
        raise AdapterFailure(
            "could not delete the cloned voice on the portal. Nothing was submitted.",
            category="provider_response",
            code="voice_delete_failed",
            http_status=exc.code,
            retryable=exc.code >= 500,
        ) from exc
    except AdapterFailure:
        raise
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise AdapterFailure(
            "could not delete the cloned voice on the portal. Nothing was submitted.",
            category="network",
            code="voice_delete_failed",
            retryable=True,
        ) from exc
    path = _voice_store_path(job)
    if path is not None:
        try:
            path.unlink()
        except OSError:
            pass
    if not isinstance(result, Mapping):
        result = {}
    return {
        "deleted": True,
        "provider_deleted": False,
        "custom_voice_id": voice_id,
        "note": result.get("note")
        if isinstance(result.get("note"), str)
        else "Fal/MiniMax has no delete-voice API. Unused provider clones auto-delete after 7 days.",
    }


def _voice_store_write(job: Mapping[str, Any], record: Mapping[str, Any]) -> None:
    path = _voice_store_path(job)
    if path is None:
        raise ValueError(
            "voice clone needs handle_path or output_root to store custom_voice_id. "
            "Nothing was submitted."
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(dict(record), ensure_ascii=True), encoding="utf-8")
    os.replace(temporary, path)


def _days_since_iso(iso: str) -> float | None:
    try:
        parsed = time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")
        return max(0.0, (time.time() - calendar.timegm(parsed)) / 86400.0)
    except (ValueError, OverflowError):
        return None


def _clone_retain_warning(store: Mapping[str, Any]) -> str | None:
    if store.get("used_in_tts_at"):
        return None
    cloned_at = store.get("cloned_at")
    if not isinstance(cloned_at, str):
        return None
    age = _days_since_iso(cloned_at)
    if age is None:
        return None
    left = VOICE_CLONE_RETAIN_DAYS - age
    if left <= 0:
        return (
            f"cloned voice for {_character_key({'parameters': {'character': store.get('character')}})} "
            "is past Fal's 7-day unused window and may already be deleted. "
            "Re-cloning costs $1.50 and needs confirm_reclone: true."
        )
    if age >= VOICE_CLONE_WARN_DAYS:
        return (
            f"cloned voice is unused in TTS and Fal may delete it in about {left:.1f} days. "
            "The first real speech-02-hd job marks it permanent. The clone preview does not."
        )
    return None


def _has_reference_audio(job: Mapping[str, Any]) -> bool:
    bindings = job.get("reference_bindings") or []
    return any(
        isinstance(b, Mapping) and b.get("role") in {"reference_audio", "voice_clone"}
        for b in bindings
    )


def _wants_voice_clone(job: Mapping[str, Any], *, http: Any = None) -> bool:
    """Clone only with explicit consent. Never re-clone when a stored id exists
    unless confirm_reclone is true."""
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    if params.get("voice_clone_consent") is not True:
        return False
    store = _voice_store_read(job, http=http)
    if store and store.get("custom_voice_id") and params.get("confirm_reclone") is not True:
        return False
    return True


def prepare_voice_clone(job: Mapping[str, Any], *, hold: Any = None, http: Any = None) -> dict[str, Any]:
    """Fail before hold. hold is unused and must stay uncalled."""
    del hold
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    if params.get("voice_clone_consent") is not True:
        raise ValueError(
            "voice clone needs explicit consent (parameters.voice_clone_consent: true) "
            "and a sample of at least 10 seconds. Endpoint fal-ai/minimax/voice-clone. "
            "Nothing was submitted."
        )
    if not _has_reference_audio(job):
        raise ValueError(
            "voice clone needs a reference_audio sample of at least "
            f"{VOICE_CLONE_MIN_SECONDS} seconds (server-measured). Nothing was submitted."
        )
    store = _voice_store_read(job, http=http)
    if store and store.get("custom_voice_id") and params.get("confirm_reclone") is not True:
        raise ValueError(
            "this character already has a custom_voice_id "
            f"(cloned_at={store.get('cloned_at')}). Reuse it in speech-02-hd. "
            "Re-cloning is a new $1.50 charge and needs confirm_reclone: true. "
            "Nothing was submitted."
        )
    if _voice_store_path(job) is None:
        raise ValueError(
            "voice clone needs handle_path or output_root to store custom_voice_id. "
            "Nothing was submitted."
        )
    model = str(params.get("model") or "speech-02-hd")
    return {
        "text": VOICE_CLONE_PREVIEW,
        "model": model,
        "endpoint": PORTAL_VOICE_CLONE_ENDPOINT,
        "preview_text": VOICE_CLONE_PREVIEW,
    }


def prepare_speech(job: Mapping[str, Any], *, hold: Any = None, http: Any = None) -> dict[str, Any]:
    """Fail before hold. hold is unused and must stay uncalled.

    A stored custom_voice_id is reused (local cache, else portal GET /api/fal/voices).
    reference_audio without a store is a clone request and must go through
    prepare_voice_clone (consent + $1.50). Never silently clone or substitute
    a preset for a stored custom id.
    """
    del hold
    if _wants_voice_clone(job, http=http):
        return prepare_voice_clone(job, http=http)
    text = str(job.get("prompt") or "")
    if len(text) > SPEECH_MAX_CHARS:
        raise ValueError(f"speech text exceeds {SPEECH_MAX_CHARS} characters. Nothing was submitted.")
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    store = _voice_store_read(job, http=http)
    warning = _clone_retain_warning(store) if store else None
    if store and isinstance(store.get("custom_voice_id"), str) and store["custom_voice_id"].strip():
        voice_id, boost = store["custom_voice_id"].strip(), None
        direction = params.get("voice_direction") if isinstance(params.get("voice_direction"), Mapping) else {}
        language = str(direction.get("language") or "")
        if language.lower().startswith("hi"):
            boost = "Hindi"
        elif language.lower().startswith("zh"):
            boost = "Chinese"
        out = {
            "text": text,
            "voice_id": voice_id,
            "language_boost": boost,
            "endpoint": PORTAL_SPEECH_ENDPOINT,
        }
        if warning:
            out["_retain_warning"] = warning
        return out
    if _has_reference_audio(job):
        raise ValueError(
            "clone the voice first: set parameters.voice_clone_consent true on a tts job "
            "with reference_audio (>=10s). Endpoint fal-ai/minimax/voice-clone ($1.50). "
            "Do not re-clone silently. Nothing was submitted."
        )
    direction = params.get("voice_direction") if isinstance(params.get("voice_direction"), Mapping) else None
    if isinstance(direction, Mapping):
        voice_id, boost = map_speech_voice(
            str(direction.get("language") or "en"),
            str(direction.get("age") or "adult"),
            str(direction.get("gender") or "female"),
        )
    else:
        voice_id, boost = "Wise_Woman", None
    return {
        "text": text,
        "voice_id": voice_id,
        "language_boost": boost,
        "endpoint": PORTAL_SPEECH_ENDPOINT,
    }


def _portal_speech_args(job: Mapping[str, Any]) -> dict[str, Any]:
    prepared = prepare_speech(job)
    return {
        k: v
        for k, v in prepared.items()
        if k not in {"endpoint", "_retain_warning", "preview_text"}
    }


def _extract_custom_voice_id(payload: Any) -> str | None:
    if not isinstance(payload, Mapping):
        return None
    for key in ("custom_voice_id", "voice_id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for nested_key in ("data", "output", "result"):
        nested = payload.get(nested_key)
        found = _extract_custom_voice_id(nested)
        if found:
            return found
    return None


def _mark_voice_used_in_tts(job: Mapping[str, Any]) -> None:
    store = _voice_store_read(job)
    if not store or not store.get("custom_voice_id") or store.get("used_in_tts_at"):
        return
    updated = dict(store)
    updated["used_in_tts_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        _voice_store_write(job, updated)
    except ValueError:
        pass


def _portal_task(job: Mapping[str, Any]) -> str | None:
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    raw = str(
        params.get("task") or params.get("omni_reference_task_type") or ""
    ).strip().lower()
    if not raw:
        return None
    task = _PORTAL_TASK.get(raw)
    if task is None:
        raise AdapterFailure(
            f"unsupported video task {raw!r}; expected extend, edit or reference. "
            "Nothing was submitted.",
            category="configuration",
            code="invalid_task",
            retryable=False,
        )
    return task


def _portal_family(job: Mapping[str, Any]) -> str:
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    model = str(params.get("model") or job.get("model") or "").lower()
    if "wan" in model:
        return "wan-3.0"
    if "h3" in model:
        return "h3-max"
    if "2.0" in model and "2.5" not in model:
        return "seedance-2.0"
    return "seedance-2.5"


def _portal_roles(job: Mapping[str, Any]) -> list[str]:
    """The provider role of each reference. reference_bindings win; without
    them roles are inferred from the file kind (first image = first_frame,
    later images = reference_image)."""
    refs = job.get("references") or []
    bindings = job.get("reference_bindings") or []
    if bindings:
        if len(bindings) != len(refs):
            raise AdapterFailure(
                "references need one reference_bindings entry each, carrying the "
                "provider role for that file. Nothing was submitted.",
                category="configuration",
                code="missing_reference_roles",
                retryable=False,
            )
        roles: list[str] = []
        for binding in bindings:
            role = binding.get("role") if isinstance(binding, Mapping) else None
            if role not in PORTAL_BINDING_ROLES:
                raise AdapterFailure(
                    "reference role must be one of "
                    + ", ".join(sorted(PORTAL_BINDING_ROLES))
                    + f"; got {role!r}. Nothing was submitted.",
                    category="configuration",
                    code="invalid_reference_role",
                    retryable=False,
                )
            roles.append(str(role))
        return roles
    inferred: list[str] = []
    image_seen = False
    for ref in refs:
        mime = PORTAL_UPLOAD_MIME.get(Path(str(ref)).suffix.casefold())
        if mime is None:
            raise AdapterFailure(
                f"portal references accept {', '.join(sorted(PORTAL_UPLOAD_MIME))} "
                f"files; got {Path(str(ref)).suffix or 'a suffixless file'}. "
                "Nothing was submitted.",
                category="configuration",
                code="invalid_reference_type",
                retryable=False,
            )
        kind = mime.split("/", 1)[0]
        if kind == "image":
            inferred.append("reference_image" if image_seen else "first_frame")
            image_seen = True
        elif kind == "video":
            inferred.append("reference_video")
        else:
            inferred.append("reference_audio")
    return inferred


def _portal_endpoint(job: Mapping[str, Any]) -> str:
    modality = str(job.get("modality") or "")
    if modality in {"tts", "speech"}:
        prepared = prepare_speech(job)
        return str(prepared["endpoint"])
    if modality == "music":
        return PORTAL_ENDPOINTS["music-3"]["music"]
    if modality == "image":
        refs = job.get("references") or []
        # Mirror of GPT_IMAGE_MAX_REFS in OkVevo-Web rateCard.ts (the Fal
        # schema maximum for gpt-image-2 edit).
        if len(refs) > PORTAL_GPT_EDIT_MAX_REFS:
            raise AdapterFailure(
                f"gpt-image-2 edit accepts at most {PORTAL_GPT_EDIT_MAX_REFS} "
                "reference images. Nothing was submitted.",
                code="too_many_refs",
                retryable=False,
            )
        return PORTAL_ENDPOINTS["gpt-image-2"]["edit" if refs else "text"]
    family = _portal_family(job)
    task = _portal_task(job)
    if task in {"extension", "editing"}:
        if "reference_video" not in _portal_roles(job):
            raise AdapterFailure(
                f"seedance-2.5 {task} needs the previous shot's real video bound "
                "as a reference_video. Nothing was submitted.",
                category="configuration",
                code="invalid_reference_role",
                retryable=False,
            )
        return PORTAL_TASK_ENDPOINT
    roles = _portal_roles(job)
    if not roles:
        return PORTAL_ENDPOINTS[family]["text"]
    frames_only = len(roles) <= 2 and set(roles) <= {"first_frame", "last_frame"}
    return PORTAL_ENDPOINTS[family]["image" if frames_only else "reference"]


def explicit_portal_args(job: Mapping[str, Any], endpoint: str) -> dict[str, Any]:
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    args = dict(params)
    args.pop("omni_reference_task_type", None)
    args.pop("voice_direction", None)
    if "video" in endpoint or endpoint.endswith("music-3"):
        args.setdefault("resolution", "720p")
        args.setdefault("duration", 5)
        args.setdefault("generate_audio", True)
    if "gpt-image-2" in endpoint:
        args.setdefault("quality", "high")
        args.setdefault("image_size", "1024x1024")
    if job.get("quality"):
        args["quality"] = job["quality"]
    task = _portal_task(job)
    if endpoint == PORTAL_TASK_ENDPOINT and task:
        args["task"] = task
        if task == "editing":
            # Fal forces duration=auto for edits and the portal prices the edit
            # on the server-measured input seconds; a sent duration is wrong.
            args.pop("duration", None)
    if endpoint == PORTAL_VOICE_CLONE_ENDPOINT:
        args.pop("duration", None)
        args.pop("resolution", None)
        args.pop("generate_audio", None)
        args.pop("confirm_reclone", None)
        args.pop("consent_rights", None)
        args.pop("voice_direction", None)
        args.setdefault("text", VOICE_CLONE_PREVIEW)
        args.setdefault("model", "speech-02-hd")
        # voice_clone_consent stays: portal records consent_at; pickSubmitArgs
        # strips it before Fal sees the body.
    args["character"] = _character_key(job)
    project = _project_key(job)
    if project:
        args["project"] = project
    return args


def _media_slot(endpoint: str, role: str) -> tuple[str, bool]:
    """(Fal arg key, is_array) for a reference role on this endpoint. Key names
    verified 2026-10-10 against the Fal OpenAPI schemas."""
    if endpoint == PORTAL_VOICE_CLONE_ENDPOINT:
        if role in {"reference_audio", "voice_clone"}:
            return "audio_url", False
    if endpoint.endswith("/edit"):  # openai/gpt-image-2/edit
        if role in {"first_frame", "last_frame", "reference_image"}:
            return "image_urls", True
    elif endpoint.endswith("/image-to-video"):
        if role == "first_frame":
            return ("start_image_url", False) if "wan-3.0" in endpoint else ("image_url", False)
        if role == "last_frame":
            return "end_image_url", False
    elif endpoint.endswith("/reference-to-video"):
        if "seedance" in endpoint:
            if role in {"first_frame", "last_frame", "reference_image"}:
                return "image_urls", True
            if role == "reference_video":
                return "video_urls", True
            return "audio_urls", True
        if "h3-max" in endpoint:
            if role == "first_frame":
                return "image_url", False
            if role == "last_frame":
                return "end_image_url", False
            if role == "reference_image":
                return "reference_image_urls", True
            if role == "reference_video":
                return "reference_video_urls", True
            return "reference_audio_urls", True
        # wan-3.0-prime
        if role in {"first_frame", "last_frame", "reference_image"}:
            return "reference_image_urls", True
        if role == "reference_video":
            return "reference_video_urls", True
        return "reference_audio_urls", True
    raise AdapterFailure(
        f"{role} references do not belong on {endpoint}. Nothing was submitted.",
        category="configuration",
        code="invalid_reference_role",
        retryable=False,
    )


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _media_cache_file(job: Mapping[str, Any]) -> Path | None:
    handle = job.get("handle_path")
    if isinstance(handle, str) and handle:
        return Path(handle).parent / PORTAL_MEDIA_CACHE
    return None


def _media_cache_load(job: Mapping[str, Any]) -> dict[str, Any]:
    path = _media_cache_file(job)
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _media_cache_store(job: Mapping[str, Any], cache: Mapping[str, Any]) -> None:
    """Best-effort, like _record_handle: a lost cache write costs one re-upload."""
    path = _media_cache_file(job)
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(cache), encoding="utf-8")
        temporary.replace(path)
    except OSError:
        return


def _cache_fresh_ref(cache: Mapping[str, Any], digest: str, now: float) -> str | None:
    entry = cache.get(digest)
    if not isinstance(entry, Mapping):
        return None
    ref, at = entry.get("ref"), entry.get("at")
    if not isinstance(ref, str) or not isinstance(at, (int, float)) or isinstance(at, bool):
        return None
    window = PORTAL_UPLOAD_REUSE_S if ref.startswith("drama-upload://") else PORTAL_FAL_REUSE_S
    return ref if 0 <= now - float(at) < window else None


def _has_alpha(pix_fmt: str) -> bool:
    # ponytail: exotic alpha layouts (e.g. ya16be) fall through to JPEG and are
    # flattened; the common PNG/WebP formats are covered. Upgrade: parse the
    # full pix_fmt list from ffprobe -pix_fmts.
    fmt = pix_fmt.strip().lower()
    return fmt.startswith(("rgba", "bgra", "argb", "abgr", "yuva")) or fmt in {"ya8", "ya16"}


def _jpeg_size(content: bytes) -> tuple[int, int] | None:
    if not content.startswith(b"\xff\xd8") or len(content) < 4:
        return None
    i = 2
    n = len(content)
    while i + 1 < n:
        if content[i] != 0xFF:
            return None
        marker = content[i + 1]
        i += 2
        if marker in {0xD8, 0xD9, 0x01} or 0xD0 <= marker <= 0xD7:
            continue
        if i + 1 >= n:
            return None
        length = int.from_bytes(content[i : i + 2], "big")
        if length < 2 or i + length > n:
            return None
        if 0xC0 <= marker <= 0xCF and marker not in {0xC4, 0xC8, 0xCC}:
            if length < 7:
                return None
            height = int.from_bytes(content[i + 3 : i + 5], "big")
            width = int.from_bytes(content[i + 5 : i + 7], "big")
            if width < 1 or height < 1:
                return None
            return width, height
        i += length
    return None


def _webp_size(content: bytes) -> tuple[int, int, str] | None:
    if len(content) < 30 or content[:4] != b"RIFF" or content[8:12] != b"WEBP":
        return None
    kind = content[12:16]
    if kind == b"VP8X":
        width = 1 + int.from_bytes(content[24:27], "little")
        height = 1 + int.from_bytes(content[27:30], "little")
        if width < 1 or height < 1:
            return None
        return width, height, "rgba" if content[20] & 0x10 else "rgb"
    if kind == b"VP8 " and content[23:26] == b"\x9d\x01\x2a":
        width = int.from_bytes(content[26:28], "little") & 0x3FFF
        height = int.from_bytes(content[28:30], "little") & 0x3FFF
        if width < 1 or height < 1:
            return None
        return width, height, "yuvj420p"
    if kind == b"VP8L" and len(content) >= 25 and content[20] == 0x2F:
        bits = int.from_bytes(content[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height, "rgba" if (bits >> 28) & 1 else "rgb"
    return None


def _image_header_size(content: bytes) -> tuple[int, int, str] | None:
    """PNG / JPEG / WebP size from the file header. None if the layout is unknown."""
    if (
        content.startswith(b"\x89PNG\r\n\x1a\n")
        and len(content) >= 26
        and content[12:16] == b"IHDR"
    ):
        width = int.from_bytes(content[16:20], "big")
        height = int.from_bytes(content[20:24], "big")
        if width < 1 or height < 1:
            return None
        return width, height, "rgba" if content[25] in (4, 6) else "rgb"
    jpeg = _jpeg_size(content)
    if jpeg is not None:
        return jpeg[0], jpeg[1], "yuvj420p"
    return _webp_size(content)


def _probe_image(path: Path, content: bytes | None = None) -> tuple[int, int, str]:
    data = content
    if data is None:
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise AdapterFailure(
                f"ffprobe could not read reference image {path.name}. Nothing was submitted.",
                category="configuration",
                code="invalid_reference_type",
                retryable=False,
            ) from exc
    parsed = _image_header_size(data)
    if parsed is not None:
        return parsed
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


def _portal_image_bytes(path: Path) -> tuple[bytes, str]:
    """Reference image bytes within the portal's normalization bound (<=2048px
    long edge, the size the rate card prices against). Downscale/re-encode via
    ffmpeg when the source is larger. Fail-closed."""
    mime = PORTAL_UPLOAD_MIME.get(path.suffix.casefold())
    if mime is None or not mime.startswith("image"):
        raise AdapterFailure(
            f"portal reference {path.name} is not a supported image. Nothing was submitted.",
            category="configuration",
            code="invalid_reference_type",
            retryable=False,
        )
    try:
        content = path.read_bytes()
    except OSError as exc:
        raise AdapterFailure(
            "portal could not read a project reference. Nothing was submitted.",
            category="configuration",
            code="unreadable_reference",
            retryable=False,
        ) from exc
    if not content:
        raise AdapterFailure(
            "portal project reference is empty. Nothing was submitted.",
            category="configuration",
            code="empty_reference",
            retryable=False,
        )
    _validate_media_content(path.name, content)
    width, height, pix_fmt = _probe_image(path, content)
    alpha = _has_alpha(pix_fmt)
    if len(content) <= PORTAL_UPLOAD_CAPS["image"] and max(width, height) <= PORTAL_IMAGE_EDGE:
        return content, mime
    out = _downscale_image(path, alpha=alpha)
    if len(out) > PORTAL_UPLOAD_CAPS["image"]:
        raise AdapterFailure(
            f"reference image stays above the {PORTAL_UPLOAD_CAPS['image'] // (1024 * 1024)}MB "
            "cap even after downscaling. Nothing was submitted.",
            category="configuration",
            code="reference_too_large",
            retryable=False,
        )
    return out, ("image/png" if alpha else "image/jpeg")


class _PortalHttp:
    """Portal transport. Tests inject a fake with the same methods."""

    def __init__(self, origin: str, token: str) -> None:
        self._origin = origin
        self._token = token

    def _request(self, path: str, method: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Authorization": f"Key {self._token}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self._origin}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
        parsed = json.loads(raw) if raw else {}
        return parsed if isinstance(parsed, dict) else {}

    def post_json(self, path: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(path, "POST", body)

    def get_json(self, path: str) -> dict[str, Any]:
        return self._request(path, "GET")

    def delete_json(self, path: str) -> dict[str, Any]:
        return self._request(path, "DELETE")

    def put_bytes(self, url: str, data: bytes, content_type: str) -> None:
        request = urllib.request.Request(
            url, data=data, method="PUT", headers={"Content-Type": content_type}
        )
        with urllib.request.urlopen(request, timeout=300) as response:
            response.read()


def _portal_upload(job: Mapping[str, Any], path: Path, http: Any) -> str:
    """One reference file through the portal's measured-upload flow. The
    creator's consent is required before any file leaves the machine."""
    params = job.get("parameters") if isinstance(job.get("parameters"), Mapping) else {}
    if params.get("consent_rights") is not True:
        raise AdapterFailure(
            "reference uploads need the creator's explicit consent for voices, "
            "faces and likenesses (parameters.consent_rights: true). "
            "Nothing was submitted.",
            category="configuration",
            code="consent_required",
            retryable=False,
        )
    mime = PORTAL_UPLOAD_MIME.get(path.suffix.casefold())
    if mime is None:
        raise AdapterFailure(
            f"portal references accept {', '.join(sorted(PORTAL_UPLOAD_MIME))} "
            f"files; got {path.suffix or 'a suffixless file'}. Nothing was submitted.",
            category="configuration",
            code="invalid_reference_type",
            retryable=False,
        )
    kind = mime.split("/", 1)[0]
    if kind == "image":
        data, mime = _portal_image_bytes(path)
    else:
        data = _read_reference(path)
        if len(data) > PORTAL_UPLOAD_CAPS[kind]:
            raise AdapterFailure(
                f"{kind} references are limited to "
                f"{PORTAL_UPLOAD_CAPS[kind] // (1024 * 1024)}MB. Nothing was submitted.",
                category="configuration",
                code="reference_too_large",
                retryable=False,
            )
    try:
        created = http.post_json(
            "/api/fal/uploads",
            {"contentType": mime, "bytes": len(data), "consentRights": True},
        )
        upload_path = created.get("path")
        upload_url = created.get("uploadUrl")
        if not isinstance(upload_path, str) or not isinstance(upload_url, str):
            raise AdapterFailure(
                "portal returned an unusable upload ticket. Nothing was submitted.",
                code="upload_failed",
                retryable=True,
            )
        http.put_bytes(upload_url, data, mime)
        done = http.post_json("/api/fal/uploads/complete", {"path": upload_path})
    except AdapterFailure:
        raise
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise AdapterFailure(
            "portal upload failed. Nothing was submitted.",
            category="network",
            code="upload_failed",
            retryable=True,
        ) from exc
    ref = done.get("ref") if isinstance(done, Mapping) else None
    if not isinstance(ref, str) or not ref.startswith("drama-upload://"):
        raise AdapterFailure(
            "portal did not finalize the upload. Nothing was submitted.",
            code="upload_failed",
            retryable=True,
        )
    return ref


def _portal_site_origin() -> str:
    origin = (os.environ.get("OKVEVO_WEB_ORIGIN") or "").strip().rstrip("/")
    if not origin:
        raise AdapterFailure(
            "OkVevo portal origin is not configured. Nothing was submitted.",
            category="configuration",
            code="quote_unavailable",
            retryable=False,
        )
    return origin


def _portal_url(path: str) -> str:
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{_portal_site_origin()}{path}"


def _default_portal_http() -> "_PortalHttp":
    read_token, resolve, _quote_keys = _gateway_helpers()
    gateway = resolve()
    token = read_token()
    if gateway is None or not token:
        raise AdapterFailure(
            "Sign in to OkVevo to upload references. Nothing was submitted.",
            category="authentication",
            code="signed_out",
            retryable=False,
        )
    return _PortalHttp(_portal_site_origin(), token)


def _portal_media_args(
    job: Mapping[str, Any],
    endpoint: str,
    *,
    http: Any = None,
    now: float | None = None,
) -> dict[str, Any]:
    """Map this job's references to the Fal media keys for endpoint. A cached
    ref (a prior upload, or a prior Fal output still inside retention — the
    extend chain reuses the previous shot's Fal URL this way) wins; anything
    else is uploaded through the measured-upload flow. Every failure is before
    any hold."""
    refs = job.get("references") or []
    if not refs:
        return {}
    roles = _portal_roles(job)
    paths = _reference_paths(job)
    now = time.time() if now is None else now
    cache = _media_cache_load(job)
    dirty = False
    args: dict[str, Any] = {}
    for path, role in zip(paths, roles):
        key, many = _media_slot(endpoint, role)
        digest = _sha256_path(path)
        ref = _cache_fresh_ref(cache, digest, now)
        if ref is None:
            if http is None:
                http = _default_portal_http()
            ref = _portal_upload(job, path, http)
            cache[digest] = {"ref": ref, "at": now}
            dirty = True
        if many:
            args.setdefault(key, []).append(ref)
        else:
            if key in args:
                raise AdapterFailure(
                    f"{endpoint} accepts one {role} reference. Nothing was submitted.",
                    category="configuration",
                    code="invalid_reference_role",
                    retryable=False,
                )
            args[key] = ref
    if dirty:
        _media_cache_store(job, cache)
    return args


def _payload_result_urls(payload: Any) -> list[str]:
    """Output media URLs in a Fal result payload: video.url, images[].url or
    audio.url, in that order."""
    rec = payload if isinstance(payload, Mapping) else {}
    urls: list[str] = []
    video = rec.get("video")
    if isinstance(video, Mapping) and isinstance(video.get("url"), str):
        urls.append(video["url"])
    images = rec.get("images")
    if isinstance(images, list):
        for image in images:
            if isinstance(image, Mapping) and isinstance(image.get("url"), str):
                urls.append(image["url"])
    audio = rec.get("audio")
    if isinstance(audio, Mapping) and isinstance(audio.get("url"), str):
        urls.append(audio["url"])
    return urls


def _gateway_helpers():
    root = Path(__file__).resolve().parents[4]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from agent.okvevo_gateway import (
        _quote_args,
        read_okvevo_id_token,
        resolve_okvevo_fal_gateway,
    )
    return read_okvevo_id_token, resolve_okvevo_fal_gateway, _quote_args


def _quote_portal(job: Mapping[str, Any]) -> dict[str, Any]:
    """Read-only credit estimate from POST /api/fal/quote. Fail-closed: any
    failure is an AdapterFailure so the skill cannot confirm an unpriced job.
    Never reserves, never debits, never submits. Reference media is uploaded
    first (consent required) so the estimate is the number the hold later
    reserves."""
    endpoint = _portal_endpoint(job)
    read_token, resolve, quote_args = _gateway_helpers()
    gateway = resolve()
    if gateway is None or not read_token():
        raise AdapterFailure(
            "Sign in to OkVevo to see the credit estimate. Nothing was submitted.",
            category="authentication",
            code="signed_out",
            retryable=False,
        )
    origin = _portal_site_origin()
    args = explicit_portal_args(job, endpoint)
    if job.get("modality") in {"tts", "speech"}:
        args.update(_portal_speech_args(job))
    args.update(_portal_media_args(job, endpoint))
    body = json.dumps(
        {"endpoint": endpoint, "args": quote_args(args)}
    ).encode("utf-8")
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
    out = {
        "estimate": True,
        "estimated_credits": credits,
        "snapshotId": quoted.get("snapshotId") if isinstance(quoted.get("snapshotId"), str) else None,
        "expiresAt": quoted.get("expiresAt") if isinstance(quoted.get("expiresAt"), str) else None,
    }
    if endpoint == PORTAL_VOICE_CLONE_ENDPOINT:
        out["preview_text"] = VOICE_CLONE_PREVIEW
    if job.get("modality") in {"tts", "speech"}:
        prepared = prepare_speech(job)
        warning = prepared.get("_retain_warning")
        if isinstance(warning, str):
            out["warning"] = warning
        preview = prepared.get("preview_text")
        if isinstance(preview, str):
            out["preview_text"] = preview
    return out


def _run_portal(job: Mapping[str, Any]) -> tuple[Path, str]:
    if job.get("modality") in {"tts", "speech"}:
        try:
            prepare_speech(job)
        except ValueError as exc:
            raise AdapterFailure(str(exc), code="invalid_job", retryable=False) from exc
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
    origin = _portal_site_origin()
    collecting = _collect_target(job)
    if collecting is not None:
        # collect: the job was submitted (and billed) earlier — poll the same
        # request, never resubmit.
        request_id = collecting
        status_url = f"{origin}/api/gateway/fal/queue/{endpoint}/requests/{request_id}/status"
        response_url = f"{origin}/api/gateway/fal/queue/{endpoint}/requests/{request_id}"
    else:
        # _portal_endpoint has already validated task/reference combinations.
        args = explicit_portal_args(job, endpoint)
        if job.get("modality") in {"tts", "speech"}:
            args.update(_portal_speech_args(job))
        if isinstance(job.get("run_id"), str):
            args["run_id"] = job["run_id"]
        if isinstance(job.get("approved_credits"), int):
            args["approved_credits"] = job["approved_credits"]
        args.update(_portal_media_args(job, endpoint))
        request = urllib.request.Request(
            f"{origin}/api/gateway/fal/queue/{endpoint}",
            data=json.dumps(args).encode("utf-8"),
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
        # Billed from here on. Record the id before the first poll.
        _record_handle(job, request_id, endpoint=endpoint)
        status_url = str(submitted.get("status_url") or "")
        response_url = str(submitted.get("response_url") or "")
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
            result_payload: Any = payload
            if response_url:
                fetch = urllib.request.Request(
                    response_url, headers={"Authorization": f"Key {token}"}
                )
                try:
                    with urllib.request.urlopen(fetch, timeout=30) as response:
                        result_payload = json.loads(response.read().decode("utf-8"))
                except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                    raise AdapterFailure(
                        "could not fetch the completed result payload",
                        code="result_fetch",
                        retryable=True,
                    ) from exc
            urls = _payload_result_urls(result_payload)
            if endpoint == PORTAL_VOICE_CLONE_ENDPOINT:
                voice_id = _extract_custom_voice_id(result_payload)
                if not voice_id:
                    raise AdapterFailure(
                        "clone completed without custom_voice_id",
                        code="missing_voice_id",
                        retryable=False,
                    )
                _voice_store_write(
                    job,
                    {
                        "custom_voice_id": voice_id,
                        "cloned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "preview_text": VOICE_CLONE_PREVIEW,
                        "used_in_tts_at": None,
                        "character": _character_key(job),
                        "endpoint": PORTAL_VOICE_CLONE_ENDPOINT,
                    },
                )
            elif endpoint == PORTAL_SPEECH_ENDPOINT:
                _mark_voice_used_in_tts(job)
            if not urls:
                if endpoint == PORTAL_VOICE_CLONE_ENDPOINT:
                    target = str((job.get("outputs") or ["voice.json"])[0])
                    suffix = Path(target).suffix.casefold() or ".json"
                    path = _output_root(job) / f"result{suffix}"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(
                        json.dumps({"custom_voice_id": voice_id}, ensure_ascii=True),
                        encoding="utf-8",
                    )
                    _record_handle(
                        job,
                        request_id,
                        endpoint=endpoint,
                        fal_urls=[],
                        finished_at=time.time(),
                    )
                    return path, request_id
                raise AdapterFailure("completed job has no download URL", retryable=False)
            target = str((job.get("outputs") or ["out.bin"])[0])
            path = _download(job, urls[0], target, provider="okvevo")
            # Feed the media cache: a later job that binds this output (the
            # extend chain's next shot) reuses the Fal URL instead of
            # re-uploading, while the portal still serves it.
            try:
                cache = _media_cache_load(job)
                cache[_sha256_path(path)] = {"ref": urls[0], "at": time.time()}
                _media_cache_store(job, cache)
            except OSError:
                pass
            _record_handle(
                job,
                request_id,
                endpoint=endpoint,
                fal_urls=urls,
                finished_at=time.time(),
            )
            return path, request_id
        if status in {"FAILED", "ERROR"}:
            raise AdapterFailure("generation failed", code="fal_failed", retryable=False)
        time.sleep(delay)
        delay = min(delay * 2, 8)
    raise AdapterFailure("timed out waiting for the result", code="poll_timeout", retryable=False)


def _selftest() -> None:
    # Endpoint routing: text / frames / reference / task per family.
    def video_job(**params):
        return {
            "modality": "video", "prompt": "p", "outputs": ["o.mp4"],
            "parameters": params, "references": [],
        }

    if _portal_endpoint(video_job()) != "bytedance/seedance-2.5/text-to-video":
        raise AssertionError("default family routing failed")
    if _portal_endpoint(video_job(model="wan-3.0")) != "alibaba/wan-3.0-prime/text-to-video":
        raise AssertionError("wan routing failed")
    if _portal_endpoint(video_job(model="minimax-h3")) != "minimax/h3-max/text-to-video":
        raise AssertionError("h3 routing failed")
    if _portal_endpoint(video_job(model="seedance-2.0")) != "bytedance/seedance-2.0/text-to-video":
        raise AssertionError("2.0 routing failed")
    if _portal_endpoint({**video_job(), "references": ["a.png"]}) != "bytedance/seedance-2.5/image-to-video":
        raise AssertionError("first frame must route to image-to-video")
    if _portal_endpoint({**video_job(), "references": ["a.png", "b.png"]}) != "bytedance/seedance-2.5/reference-to-video":
        raise AssertionError("two images route to reference (first frame + reference image)")
    if _portal_endpoint({
        **video_job(), "references": ["a.png", "b.png"],
        "reference_bindings": [{"role": "first_frame"}, {"role": "last_frame"}],
    }) != "bytedance/seedance-2.5/image-to-video":
        raise AssertionError("first+last frames route to image-to-video")
    if _portal_endpoint({**video_job(task="extend"), "references": ["shot1.mp4"]}) != PORTAL_TASK_ENDPOINT:
        raise AssertionError("extend must route to the 2.5 reference endpoint")
    if _portal_endpoint({**video_job(task="edit"), "references": ["shot1.mp4"]}) != PORTAL_TASK_ENDPOINT:
        raise AssertionError("edit must route to the 2.5 reference endpoint")
    if _portal_endpoint({
        **video_job(model="minimax-h3"), "references": ["clip.mp4"],
    }) != "minimax/h3-max/reference-to-video":
        raise AssertionError("h3 video reference routing failed")
    try:
        _portal_endpoint({**video_job(task="rewind"), "references": []})
    except AdapterFailure as exc:
        if exc.code != "invalid_task":
            raise AssertionError("bad task must fail with invalid_task") from exc
    else:
        raise AssertionError("an unknown task was accepted")
    # Media slot mapping (Fal schema key names).
    if _media_slot("alibaba/wan-3.0-prime/image-to-video", "first_frame") != ("start_image_url", False):
        raise AssertionError("wan first frame key failed")
    if _media_slot("bytedance/seedance-2.5/image-to-video", "last_frame") != ("end_image_url", False):
        raise AssertionError("seedance last frame key failed")
    if _media_slot(PORTAL_TASK_ENDPOINT, "reference_video") != ("video_urls", True):
        raise AssertionError("seedance reference video key failed")
    if _media_slot("minimax/h3-max/reference-to-video", "reference_video") != ("reference_video_urls", True):
        raise AssertionError("h3 reference video key failed")
    if _media_slot("openai/gpt-image-2/edit", "reference_image") != ("image_urls", True):
        raise AssertionError("gpt edit key failed")
    # gpt edit cap: 16 pass, 17 fail.
    many = {**video_job(), "modality": "image", "references": [f"r{i}.png" for i in range(16)]}
    if _portal_endpoint(many) != "openai/gpt-image-2/edit":
        raise AssertionError("16 gpt refs must route to edit")
    many["references"] = many["references"] + ["r16.png"]
    try:
        _portal_endpoint(many)
    except AdapterFailure as exc:
        if exc.code != "too_many_refs":
            raise AssertionError("17 gpt refs must fail too_many_refs") from exc
    else:
        raise AssertionError("17 gpt refs were accepted")
    # Speech: preset voices, length cap, voice cloning fails naming the pending endpoint.
    hindi = prepare_speech({
        "prompt": "Hello, world 2.",
        "parameters": {"voice_direction": {"language": "hi", "age": "adult", "gender": "female"}},
    })
    if hindi["voice_id"] != "Wise_Woman" or hindi["language_boost"] != "Hindi":
        raise AssertionError("Hindi voice map failed")
    try:
        prepare_speech({"prompt": "hello", "reference_bindings": [{"role": "reference_audio"}]})
    except ValueError as exc:
        if PORTAL_VOICE_CLONE_ENDPOINT not in str(exc):
            raise AssertionError("voice-clone refusal must name fal-ai/minimax/voice-clone") from exc
    else:
        raise AssertionError("reference audio was accepted for speech")
    try:
        prepare_voice_clone({"prompt": "x", "reference_bindings": [{"role": "reference_audio"}]})
    except ValueError as exc:
        if "consent" not in str(exc):
            raise AssertionError("clone without consent must fail") from exc
    else:
        raise AssertionError("clone without consent was accepted")
    clone_dir = tempfile.mkdtemp(prefix="nia-voice-selftest-")
    clone_job = {
        "prompt": "preview",
        "handle_path": str(Path(clone_dir) / "handle.json"),
        "reference_bindings": [{"role": "reference_audio"}],
        "parameters": {"voice_clone_consent": True, "character": "hero"},
    }
    cloned = prepare_voice_clone(clone_job)
    if cloned["endpoint"] != PORTAL_VOICE_CLONE_ENDPOINT or cloned["text"] != VOICE_CLONE_PREVIEW:
        raise AssertionError("consenting clone must route to fal-ai/minimax/voice-clone")
    _voice_store_write(
        clone_job,
        {
            "custom_voice_id": "cloned-hero-1",
            "cloned_at": "2026-10-10T00:00:00Z",
            "used_in_tts_at": None,
            "character": "hero",
        },
    )
    reused = prepare_speech({**clone_job, "prompt": "line", "parameters": {"character": "hero"}})
    if reused["voice_id"] != "cloned-hero-1" or reused["endpoint"] != PORTAL_SPEECH_ENDPOINT:
        raise AssertionError("stored custom_voice_id must be reused on speech-02-hd")
    try:
        prepare_voice_clone(clone_job)
    except ValueError as exc:
        if "confirm_reclone" not in str(exc):
            raise AssertionError("second clone must require confirm_reclone") from exc
    else:
        raise AssertionError("silent re-clone was accepted")
    try:
        prepare_speech({"prompt": "x" * (SPEECH_MAX_CHARS + 1)})
    except ValueError as exc:
        if str(SPEECH_MAX_CHARS) not in str(exc):
            raise AssertionError("speech max must be reported") from exc
    else:
        raise AssertionError("over-long speech was accepted")
    # Result payload shapes.
    if _payload_result_urls({"video": {"url": "https://v3b.fal.media/a.mp4"}}) != ["https://v3b.fal.media/a.mp4"]:
        raise AssertionError("video payload extraction failed")
    if _payload_result_urls({"images": [{"url": "https://v3b.fal.media/a.png"}]}) != ["https://v3b.fal.media/a.png"]:
        raise AssertionError("image payload extraction failed")
    if _payload_result_urls({"audio": {"url": "https://v3b.fal.media/a.mp3"}}) != ["https://v3b.fal.media/a.mp3"]:
        raise AssertionError("audio payload extraction failed")
    if _payload_result_urls({"logs": []}) != []:
        raise AssertionError("empty payload must yield no URLs")
    # Media cache freshness windows.
    fresh = {"d" * 64: {"ref": "drama-upload://x", "at": 1000.0}}
    if _cache_fresh_ref(fresh, "d" * 64, 1000.0 + PORTAL_UPLOAD_REUSE_S - 1) != "drama-upload://x":
        raise AssertionError("fresh upload ref must be reused")
    if _cache_fresh_ref(fresh, "d" * 64, 1000.0 + PORTAL_UPLOAD_REUSE_S + 1) is not None:
        raise AssertionError("stale upload ref must not be reused")
    fal = {"e" * 64: {"ref": "https://v3b.fal.media/a.mp4", "at": 1000.0}}
    if _cache_fresh_ref(fal, "e" * 64, 1000.0 + PORTAL_FAL_REUSE_S + 1) is not None:
        raise AssertionError("stale Fal URL must not be reused")
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "provider",
        nargs="?",
        choices=(
            "seedance", "gpt-image-2", "minimax-music", "minimax-h3",
            "minimax-speech", "portal", "quote", "delete-voice",
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
        if args.provider == "delete-voice":
            json.dump(delete_cloned_voice(job), sys.stdout, ensure_ascii=True)
            return 0
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
