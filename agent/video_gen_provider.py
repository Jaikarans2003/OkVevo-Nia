"""
Video Generation Provider ABC
=============================

Defines the pluggable-backend interface for video generation. Providers register
instances via ``PluginContext.register_video_gen_provider()``; the active one
(selected via ``video_gen.provider`` in ``config.yaml``) services every
``video_generate`` tool call.

Providers live in ``<repo>/plugins/video_gen/<name>/`` (built-in, auto-loaded
as ``kind: backend``) or ``~/.hermes/plugins/video_gen/<name>/`` (user, opt-in
via ``plugins.enabled``).

Mirrors the ``image_gen`` provider design (``agent/image_gen_provider.py``) so
the two surfaces stay learnable together.

Unified surface
---------------
One tool — ``video_generate`` — covers **text-to-video** and **image-to-video**.
The router is the presence of ``image_url``: if it's set, the provider routes
to its image-to-video endpoint; if it's omitted, the provider routes to
text-to-video. Users pick one **model family** (e.g. Pixverse v6, Veo 3.1,
Kling O3 Standard); the provider handles which underlying FAL/xAI endpoint
to hit.

Video edit and video extend are intentionally NOT exposed in this surface —
the inconsistency across backends is too large for one unified tool. If
those use cases warrant attention later they can ship as separate tools.

Response shape
--------------
All providers return a dict built by :func:`success_response` /
:func:`error_response`. Keys:

    success         bool
    video           str | None      URL or absolute file path
    model           str             provider-specific model identifier
    prompt          str             echoed prompt
    modality        str             "text" | "image" (which mode was used)
    aspect_ratio    str             provider-native (e.g. "16:9") or ""
    duration        int             seconds (0 if not applicable)
    provider        str             provider name (for diagnostics)
    error           str             only when success=False
    error_type      str             only when success=False
"""

from __future__ import annotations

import abc
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from agent.nia_generated_media import (
    save_generated_b64,
    save_generated_bytes,
    save_generated_url,
)

logger = logging.getLogger(__name__)


# Common aspect ratios across providers (Veo / Kling / xAI / Pixverse). The
# tool schema advertises this set as an enum hint, but providers may accept
# a narrower or wider set — they are responsible for clamping.
COMMON_ASPECT_RATIOS: Tuple[str, ...] = ("16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3")
DEFAULT_ASPECT_RATIO = "16:9"

COMMON_RESOLUTIONS: Tuple[str, ...] = ("480p", "540p", "720p", "1080p")
DEFAULT_RESOLUTION = "720p"


# ---------------------------------------------------------------------------
# ABC
# ---------------------------------------------------------------------------


class VideoGenProvider(abc.ABC):
    """Abstract base class for a video generation backend.

    Subclasses must implement :meth:`generate`. Everything else has sane
    defaults — override only what your provider needs.
    """

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Stable short identifier used in ``video_gen.provider`` config.

        Lowercase, no spaces. Examples: ``xai``, ``fal``, ``google``.
        """

    @property
    def display_name(self) -> str:
        """Human-readable label shown in ``hermes tools``. Defaults to ``name.title()``."""
        return self.name.title()

    def is_available(self) -> bool:
        """Return True when this provider can service calls.

        Typically checks for a required API key and optional-dependency
        import. Default: True.
        """
        return True

    def list_models(self) -> List[Dict[str, Any]]:
        """Return catalog entries for ``hermes tools`` model picker.

        Each entry represents a **model family** that supports text-to-video
        and/or image-to-video routing internally::

            {
                "id": "veo-3.1",                       # required
                "display": "Veo 3.1",                  # optional; defaults to id
                "speed": "~60s",                       # optional
                "strengths": "...",                    # optional
                "price": "$0.20/s",                    # optional
                "modalities": ["text", "image"],       # optional, advisory
            }

        Default: empty list (provider has no user-selectable models).
        """
        return []

    def get_setup_schema(self) -> Dict[str, Any]:
        """Return provider metadata for the ``hermes tools`` picker."""
        return {
            "name": self.display_name,
            "badge": "",
            "tag": "",
            "env_vars": [],
        }

    def default_model(self) -> Optional[str]:
        """Return the default model id, or None if not applicable."""
        models = self.list_models()
        if models:
            return models[0].get("id")
        return None

    def capabilities(self) -> Dict[str, Any]:
        """Return what this provider supports.

        Returned dict (all keys optional)::

            {
                "modalities": ["text", "image"],      # which inputs the backend accepts
                "aspect_ratios": ["16:9", "9:16", ...],
                "resolutions": ["720p", "1080p"],
                "max_duration": 15,                   # seconds
                "min_duration": 1,
                "supports_audio": True,
                "supports_negative_prompt": True,
                "supports_seed": True,
                "supports_upscale": True,
                "max_reference_images": 7,
            }

        Used by the tool layer for soft validation, for capability-gated
        param rendering in the dynamic ``video_generate`` schema (args a
        backend can't honor are not advertised), and by ``hermes tools``
        for the picker. Default fails closed: text-only, no optional
        features — a provider that doesn't declare a capability doesn't
        advertise it.
        """
        return {
            "modalities": ["text"],
            "aspect_ratios": list(COMMON_ASPECT_RATIOS),
            "resolutions": list(COMMON_RESOLUTIONS),
            "max_duration": 10,
            "min_duration": 1,
            "supports_audio": False,
            "supports_negative_prompt": False,
            "supports_seed": False,
            "supports_upscale": False,
            "max_reference_images": 0,
        }

    @abc.abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        duration: Optional[int] = None,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        resolution: str = DEFAULT_RESOLUTION,
        negative_prompt: Optional[str] = None,
        audio: Optional[bool] = None,
        seed: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Generate a video from a prompt (text-to-video) or animate an image
        (image-to-video).

        Routing: if ``image_url`` is provided, the provider should route to
        its image-to-video endpoint; otherwise text-to-video. The plugin
        is responsible for picking the right underlying endpoint within
        the user's chosen model family.

        Implementations should return the dict from :func:`success_response`
        or :func:`error_response`. ``kwargs`` may contain forward-compat
        parameters future versions of the schema will expose —
        implementations MUST ignore unknown keys (no TypeError).

        Known optional kwarg: ``upscale`` (bool) — when true, the caller
        requests a post-generation high-resolution pass through the
        backend's video upscaler. Providers without an upscaler simply
        ignore it; providers that honor it should report ``upscaled: True``
        in the response ``extra``.
        """


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_URL_VIDEO_CONTENT_TYPES = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
}


def save_b64_video(
    b64_data: str,
    *,
    prefix: str = "video",
    extension: str = "mp4",
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
) -> Path:
    """Decode base64 video data into durable storage; return the absolute path."""
    return save_generated_b64(
        "videos",
        b64_data,
        prefix=prefix,
        extension=extension,
        output_dir=output_dir,
        apply_tiers=apply_tiers,
    ).path


def save_bytes_video(
    raw: bytes,
    *,
    prefix: str = "video",
    extension: str = "mp4",
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
) -> Path:
    """Write raw video bytes into durable storage."""
    return save_generated_bytes(
        "videos",
        raw,
        prefix=prefix,
        extension=extension,
        output_dir=output_dir,
        apply_tiers=apply_tiers,
    ).path


def save_url_video(
    url: str,
    *,
    prefix: str = "video",
    timeout: float = 180.0,
    max_bytes: int = 200 * 1024 * 1024,
    headers: Optional[Dict[str, str]] = None,
    require_video_content_type: bool = False,
    trusted_origin: bool = False,
    output_dir: Optional[str] = None,
    apply_tiers: bool = True,
) -> Path:
    """Download an (often ephemeral) video URL into durable storage.

    ``trusted_origin`` is only for URLs built from the operator's configured
    provider ``base_url`` (see ``provider_media.save_url``).
    """
    return save_generated_url(
        "videos",
        url,
        prefix=prefix,
        output_dir=output_dir,
        apply_tiers=apply_tiers,
        timeout=timeout,
        max_bytes=max_bytes,
        chunk_size=256 * 1024,
        content_types=_URL_VIDEO_CONTENT_TYPES,
        url_extensions=("mp4", "webm", "mov", "mkv"),
        default_extension="mp4",
        label="Video",
        empty_error="Video at {url} was empty (0 bytes).",
        headers=headers,
        require_known_content_type=require_video_content_type,
        trusted_origin=trusted_origin,
    ).path


def success_response(
    *,
    video: str,
    model: str,
    prompt: str,
    modality: str = "text",
    aspect_ratio: str = "",
    duration: int = 0,
    provider: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a uniform success response dict.

    ``video`` may be an HTTP URL or an absolute filesystem path.
    ``modality`` is ``"text"`` (text-to-video) or ``"image"`` (image-to-video) —
    indicates which endpoint was actually hit, useful for diagnostics.
    """
    payload: Dict[str, Any] = {
        "success": True,
        "video": video,
        "model": model,
        "prompt": prompt,
        "modality": modality,
        "aspect_ratio": aspect_ratio,
        "duration": int(duration) if duration else 0,
        "provider": provider,
    }
    if extra:
        for k, v in extra.items():
            payload.setdefault(k, v)
    return payload


def error_response(
    *,
    error: str,
    error_type: str = "provider_error",
    provider: str = "",
    model: str = "",
    prompt: str = "",
    aspect_ratio: str = "",
) -> Dict[str, Any]:
    """Build a uniform error response dict."""
    from agent.user_facing_errors import map_public_error

    return {
        "success": False,
        "video": None,
        "error": map_public_error(error, error_type=error_type) or error,
        "error_type": error_type,
        "model": model,
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "provider": provider,
    }


# ---------------------------------------------------------------------------
# Reusable OpenAI-compatible backend
# ---------------------------------------------------------------------------


class OpenAICompatibleVideoGenProvider(VideoGenProvider):
    """Generic text/image-to-video over the OpenAI ``client.videos`` API.

    DeepInfra, OpenAI/Sora, and OpenRouter all expose the same
    ``POST /videos`` async-job shape (``create`` → poll → ``download_content``),
    so the SDK call lives here once. A concrete backend only needs to declare
    its identity and credentials::

        class FooVideoGenProvider(OpenAICompatibleVideoGenProvider):
            name = "foo"
            _env_key = "FOO_API_KEY"
            _default_base_url = "https://api.foo.com/v1/openai"
            def list_models(self):
                return [...]   # entries with an "id" key; default_model() uses [0]

    ``image_url`` routes to image-to-video; its absence routes to text-to-video.
    Provider-specific fields (``image_url``/``negative_prompt``/``seed``) ride
    in ``extra_body`` so they pass through the SDK unchanged.
    """

    _env_key: str = "OPENAI_API_KEY"
    _default_base_url: str = "https://api.openai.com/v1"

    # Polling cadence for the async video job. The OpenAI SDK's
    # ``create_and_poll`` defaults to ~1 poll/second and loops forever on a
    # non-terminal status, so a multi-minute job issues hundreds of sequential
    # requests and a stuck job pins its tool-executor worker thread with no way
    # out. We hand-roll a bounded poll instead: a coarse interval plus a hard
    # wall-clock deadline that surfaces a timeout error.
    _poll_interval_s: float = 5.0
    _poll_deadline_s: float = 900.0

    def _api_key(self) -> str:
        import os

        return os.environ.get(self._env_key, "").strip()

    def is_available(self) -> bool:
        return bool(self._api_key())

    def _create_and_poll(self, client: Any, call_kwargs: Dict[str, Any]) -> Any:
        """Create the video job and poll to completion with a hard deadline.

        Replaces ``client.videos.create_and_poll`` (unbounded 1/s loop) with a
        coarse interval and a wall-clock cap. Returns the terminal video object
        (any status); raises :class:`TimeoutError` if the deadline passes
        first.
        """
        import time

        video = client.videos.create(**call_kwargs)
        terminal = {"completed", "succeeded", "failed", "error", "cancelled", "canceled"}
        deadline = time.monotonic() + self._poll_deadline_s
        while getattr(video, "status", None) not in terminal:
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"video job {getattr(video, 'id', '?')} did not reach a terminal "
                    f"status within {int(self._poll_deadline_s)}s "
                    f"(last status={getattr(video, 'status', None)!r})"
                )
            time.sleep(self._poll_interval_s)
            video = client.videos.retrieve(video.id)
        return video

    def _base_url(self) -> str:
        import os

        override = os.environ.get(f"{self.name.upper()}_BASE_URL", "").strip()
        return override or self._default_base_url

    def generate(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        duration: Optional[int] = None,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        resolution: str = DEFAULT_RESOLUTION,
        negative_prompt: Optional[str] = None,
        audio: Optional[bool] = None,
        seed: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        if not prompt or not prompt.strip():
            return error_response(
                error="prompt is required", error_type="invalid_request", provider=self.name
            )
        if not self._api_key():
            return error_response(
                error=f"{self._env_key} is not set",
                error_type="missing_credentials",
                provider=self.name,
            )
        try:
            import openai
        except ImportError:
            return error_response(
                error="openai Python package not installed (pip install openai)",
                error_type="missing_dependency",
                provider=self.name,
            )

        model_id = model or self.default_model()
        if not model_id:
            return error_response(
                error=f"no {self.name} video model available (live catalog empty?)",
                error_type="no_model",
                provider=self.name,
            )

        # Provider-specific fields the OpenAI ``videos.create`` signature does
        # not name natively — pass them through ``extra_body``.
        extra_body = {
            k: v
            for k, v in {
                "negative_prompt": negative_prompt,
                "aspect_ratio": aspect_ratio,
                "image_url": image_url,  # presence ⇒ image-to-video
                "seed": seed,
            }.items()
            if v is not None
        }
        call_kwargs: Dict[str, Any] = {"model": model_id, "prompt": prompt}
        if duration:
            call_kwargs["seconds"] = str(duration)
        if resolution:
            call_kwargs["size"] = resolution
        if extra_body:
            call_kwargs["extra_body"] = extra_body

        client = openai.OpenAI(api_key=self._api_key(), base_url=self._base_url())
        try:
            try:
                video = self._create_and_poll(client, call_kwargs)
            except Exception as exc:  # noqa: BLE001 - surface any SDK/API/timeout failure uniformly
                logger.debug("%s video generation failed", self.name, exc_info=True)
                return error_response(
                    error=f"{self.name} video generation failed: {exc}",
                    error_type="api_error",
                    provider=self.name,
                    model=model_id,
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                )

            # Terminal success status differs across backends: DeepInfra reports
            # "succeeded", OpenAI/Sora reports "completed". Accept both.
            status = getattr(video, "status", None)
            if status not in ("completed", "succeeded"):
                # ``video.error`` is a structured SDK object (pydantic
                # VideoCreateError), not a string — str() it so the response
                # dict stays JSON-serializable for the tool layer.
                job_error = getattr(video, "error", None)
                return error_response(
                    error=str(job_error) if job_error else f"video job ended with status={status!r}",
                    error_type="job_failed",
                    provider=self.name,
                    model=model_id,
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                )

            # Resolve the output. Providers expose it either as a delivery URL in
            # the job's ``data`` list (DeepInfra, FAL-style) or only via the SDK
            # download endpoint (OpenAI/Sora). Download the bytes and save locally
            # so the caller gets a durable file — DeepInfra's delivery URLs in
            # particular are short-lived. Matches plugins/image_gen/deepinfra.
            url = None
            for item in getattr(video, "data", None) or []:
                candidate = item.get("url") if isinstance(item, dict) else getattr(item, "url", None)
                if candidate:
                    url = candidate
                    break

            save_dir = kwargs.get("output_dir")
            if not isinstance(save_dir, str) or not save_dir.strip():
                save_dir = None
            else:
                save_dir = save_dir.strip()
            try:
                if url:
                    # Materialise the (often short-lived) delivery URL locally.
                    video_ref = str(save_url_video(url, prefix=self.name, output_dir=save_dir))
                else:
                    # OpenAI/Sora style: no public URL — pull bytes via the SDK.
                    raw = client.videos.download_content(video.id).read()
                    video_ref = str(save_bytes_video(raw, prefix=self.name, output_dir=save_dir))
            except Exception as exc:  # noqa: BLE001
                if url:
                    # Best-effort: hand back the URL rather than fail outright.
                    logger.debug("%s: saving video locally failed (%s); returning URL", self.name, exc)
                    video_ref = url
                else:
                    return error_response(
                        error=f"{self.name} video job succeeded but no output could be retrieved: {exc}",
                        error_type="empty_response",
                        provider=self.name,
                        model=model_id,
                        prompt=prompt,
                        aspect_ratio=aspect_ratio,
                    )

            return success_response(
                video=video_ref,
                model=model_id,
                prompt=prompt,
                modality="image" if image_url else "text",
                aspect_ratio=aspect_ratio,
                duration=duration or 0,
                provider=self.name,
            )
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()
