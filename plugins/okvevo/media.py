"""OkVevo image + video generation — Fal proxied through the OkVevo portal gateway.

The portal's ``/api/gateway/fal/queue`` speaks the fal-queue protocol, so both
providers reuse upstream's catalog, payload builders, and queue plumbing and
swap only the submit path: OkVevo client (Firebase ID token), a quote +
human-approval spend gate, and the portal's mandatory per-call ``run_id``.

Selection: config ``image_gen.provider: okvevo`` / ``video_gen.provider:
okvevo`` (written by the desktop app on sign-in). Signed out → unavailable.

ponytail: generate() mirrors the upstream fal providers' orchestration instead
of calling them (their module-level submit path cannot be retargeted without
editing upstream files). tests/test_upstream_seams.py pins every upstream
helper imported here so an upstream sync that renames one fails loudly.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, Optional

from agent.image_gen_provider import (
    DEFAULT_ASPECT_RATIO as IMG_DEFAULT_ASPECT,
    resolve_aspect_ratio,
)
from agent.image_gen_provider import error_response as img_error
from agent.image_gen_provider import success_response as img_success
from agent.video_gen_provider import error_response as vid_error
from agent.video_gen_provider import success_response as vid_success

from plugins.okvevo.errors import public_error_message
from plugins.okvevo.gateway import (
    OkvevoGatewayConfigError,
    ensure_okvevo_fal_run_id,
    ensure_okvevo_id_token,
    okvevo_fal_available,
    okvevo_gateway_base_url,
    okvevo_fal_spend_gate,
)

logger = logging.getLogger(__name__)

_SIGN_IN_MSG = "Sign in to OkVevo to generate images and videos — they're included with your plan."

_client_lock = threading.Lock()
_client = None
_client_config: tuple[str, str] | None = None


def _okvevo_fal_client():
    """Cached ``_ManagedFalSyncClient`` against the portal's fal-queue proxy.

    Rebuilt whenever the origin or the (hourly-rotating) ID token changes, so
    its internal httpx.Client is not leaked per call.
    """
    global _client, _client_config
    from plugins.video_gen.fal import _load_fal_client
    from tools.fal_common import _ManagedFalSyncClient

    token = ensure_okvevo_id_token()
    if not token:
        raise OkvevoGatewayConfigError(_SIGN_IN_MSG)
    origin = f"{okvevo_gateway_base_url()}/fal/queue"
    config = (origin, token)
    with _client_lock:
        if _client is None or _client_config != config:
            _client = _ManagedFalSyncClient(_load_fal_client(), key=token, queue_run_origin=origin)
            _client_config = config
        return _client


def _submit_okvevo_fal(endpoint: str, arguments: Dict[str, Any], *, what: str):
    """Submit to the portal fal-queue with run_id attached; 4xx → friendly copy."""
    from tools.fal_common import _extract_http_status, submit_managed_fal_with_rate_limit_retry

    args = ensure_okvevo_fal_run_id(arguments)
    client = _okvevo_fal_client()
    try:
        return submit_managed_fal_with_rate_limit_retry(
            lambda headers: client.submit(endpoint, arguments=args, headers=headers),
            what=what, name=endpoint,
        )
    except Exception as exc:
        status = _extract_http_status(exc)
        if status is not None and 400 <= status < 500:
            # Public builds map to the OkVevo copy deck (402 → credits,
            # 401/403 → session); internal keeps the raw detail.
            raise ValueError(public_error_message(str(exc), status=status)) from exc
        raise


# ---------------------------------------------------------------------------
# Video
# ---------------------------------------------------------------------------

def _video_failure(exc: Exception) -> str:
    return public_error_message(str(exc)) if not isinstance(exc, ValueError) else str(exc)


def _build_video_provider():
    """Subclass upstream's FAL provider at registration time (its module import
    must not happen before plugin discovery sets up synthetic packages)."""
    import plugins.video_gen.fal as fal_video
    from tools.fal_common import wait_fal_queue_result

    class _OkvevoVideoGenProvider(fal_video.FALVideoGenProvider):
        """OkVevo-metered Fal video. Catalog/capabilities inherit from upstream."""

        name = "okvevo"
        display_name = "OkVevo"

        def is_available(self) -> bool:
            return okvevo_fal_available()

        def get_setup_schema(self) -> dict[str, Any]:
            return {"name": "OkVevo", "badge": "included",
                    "tag": "Video generation included with your OkVevo plan.", "env_vars": []}

        def generate(
            self, prompt: str, *, model: Optional[str] = None, image_url: Optional[str] = None,
            reference_image_urls: Optional[list[str]] = None, duration: Optional[int] = None,
            aspect_ratio: str = "16:9", resolution: str = "720p",
            negative_prompt: Optional[str] = None, audio: Optional[bool] = None,
            seed: Optional[int] = None, upscale: Optional[bool] = None, **kwargs: Any,
        ) -> dict[str, Any]:
            def fail(error: str, error_type: str, model_id: str = "") -> dict[str, Any]:
                return vid_error(error=error, error_type=error_type, provider="okvevo",
                                 model=model_id, prompt=prompt, aspect_ratio=aspect_ratio)

            if not okvevo_fal_available():
                return fail(_SIGN_IN_MSG, "auth_required")
            try:
                fal_video._load_fal_client()
            except ImportError:
                return fail(public_error_message("fal_client Python package not installed"),
                            "missing_dependency")
            prompt = (prompt or "").strip()
            family_id, family = fal_video._resolve_family(model)
            image_url_norm = (image_url or "").strip() or None
            modality_used = "image" if image_url_norm else "text"
            endpoint = family[f"{modality_used}_endpoint"]
            if not endpoint:
                return fail(fal_video._MODALITY_MISSING_MSG[modality_used].format(fid=family_id),
                            "modality_unsupported", family_id)
            if not prompt:
                return fail("prompt is required.", "missing_prompt", family_id)
            payload = fal_video._build_payload(
                family, prompt=prompt, image_url=image_url_norm, duration=duration,
                aspect_ratio=aspect_ratio, resolution=resolution,
                negative_prompt=negative_prompt, audio=audio, seed=seed)

            # Spend gate: quote + human approval before the gateway submit.
            # Denial returns before any reserve exists (the hold is created
            # inside the portal's submit handler). The upscale pass below is
            # metered separately and is not gated again (one prompt per call).
            denial = okvevo_fal_spend_gate(
                "video_generate", endpoint, payload,
                extra_note=(" The upscale pass is metered separately and is not in "
                            "this estimate." if upscale else ""))
            if denial:
                return fail(denial, "approval_denied", family_id)

            try:
                handle = _submit_okvevo_fal(endpoint, payload, what="video endpoint")
                source_request_id = getattr(handle, "request_id", None)
                video, url = fal_video._video_url_from_result(wait_fal_queue_result(handle))
            except Exception as exc:
                logger.warning("OkVevo video gen failed (family=%s, endpoint=%s): %s",
                               family_id, endpoint, exc, exc_info=True)
                return fail(_video_failure(exc), "api_error", family_id)
            if not url:
                return fail(public_error_message("FAL returned no video URL in response"),
                            "empty_response", family_id)
            upscaled_url = self._upscale(url, source_request_id) if upscale else None
            upscaled = bool(upscaled_url)
            if upscale and not upscaled:
                logger.warning("Video upscale pass failed — returning native-resolution video")
            url = upscaled_url or url
            extra: dict[str, Any] = {"endpoint": endpoint, "upscaled": upscaled,
                                     **({"upscale_factor": fal_video.UPSCALER_FACTOR} if upscaled else {})}
            if isinstance(video, dict):
                extra.update({k: video[k] for k in (("content_type",) if upscaled
                                                    else ("file_size", "content_type")) if video.get(k)})
            return vid_success(
                video=url, model=family_id, prompt=prompt, modality=modality_used,
                provider="okvevo", extra=extra,
                aspect_ratio=aspect_ratio if "aspect_ratio" in payload else "",
                duration=int("".join(c for c in str(payload["duration"]) if c.isdigit()) or "0")
                if "duration" in payload else 0,
            )

        def _upscale(self, video_url: str, source_request_id: Optional[str]) -> Optional[str]:
            """Best-effort SeedVR2 pass via the gateway; None on failure (never raises)."""
            try:
                if not source_request_id:
                    raise RuntimeError("OkVevo SeedVR upscale requires the source FAL request id")
                arguments: dict[str, Any] = {
                    "video_url": video_url, "upscale_mode": "factor",
                    "upscale_factor": fal_video.UPSCALER_FACTOR,
                    "source_request_id": source_request_id,
                }
                result = wait_fal_queue_result(
                    _submit_okvevo_fal(fal_video.UPSCALER_ENDPOINT, arguments, what="video endpoint"))
            except Exception as exc:
                logger.warning("Video upscale failed: %s", exc)
                return None
            _video, url = fal_video._video_url_from_result(result)
            if not url:
                logger.warning("Video upscaler returned no URL")
            return url

    return _OkvevoVideoGenProvider()


# ---------------------------------------------------------------------------
# Image
# ---------------------------------------------------------------------------

def _build_image_provider():
    import tools.image_generation_tool as img_tool
    from plugins.image_gen._common import StaticImageGenProvider, catalog_rows
    from tools.image_generation_catalog import (
        DEFAULT_MODEL,
        FAL_MODELS,
        UPSCALER_CREATIVITY,
        UPSCALER_DEFAULT_PROMPT,
        UPSCALER_FACTOR,
        UPSCALER_GUIDANCE_SCALE,
        UPSCALER_MODEL,
        UPSCALER_NEGATIVE_PROMPT,
        UPSCALER_NUM_INFERENCE_STEPS,
        UPSCALER_RESEMBLANCE,
        UPSCALER_SAFETY_CHECKER,
        VALID_ASPECT_RATIOS,
    )

    def _upscale_image(image_url: str, original_prompt: str) -> Optional[dict[str, Any]]:
        """Clarity Upscaler via the gateway; None on failure (caller keeps the original)."""
        try:
            handler = _submit_okvevo_fal(UPSCALER_MODEL, {
                "image_url": image_url,
                "prompt": f"{UPSCALER_DEFAULT_PROMPT}, {original_prompt}",
                "upscale_factor": UPSCALER_FACTOR,
                "negative_prompt": UPSCALER_NEGATIVE_PROMPT,
                "creativity": UPSCALER_CREATIVITY, "resemblance": UPSCALER_RESEMBLANCE,
                "guidance_scale": UPSCALER_GUIDANCE_SCALE,
                "num_inference_steps": UPSCALER_NUM_INFERENCE_STEPS,
                "enable_safety_checker": UPSCALER_SAFETY_CHECKER,
            }, what="image model")
            result = img_tool._wait_fal_result(handler)
            if result and "image" in result:
                up = result["image"]
                return {"url": up["url"], "width": up.get("width", 0), "height": up.get("height", 0),
                        "upscaled": True, "upscale_factor": UPSCALER_FACTOR}
            logger.error("Upscaler returned invalid response")
            return None
        except img_tool.ImageGenerationInterrupted:
            raise
        except Exception as exc:  # noqa: BLE001 — best-effort pass
            logger.error("Error upscaling image: %s", exc, exc_info=True)
            return None

    class _OkvevoImageGenProvider(StaticImageGenProvider):
        """OkVevo-metered Fal images. Catalog mirrors the upstream FAL plugin."""

        provider_id = "okvevo"
        label = "OkVevo"

        def get_setup_schema(self) -> dict[str, Any]:
            return {"name": "OkVevo", "badge": "included",
                    "tag": "Image generation included with your OkVevo plan.", "env_vars": []}

        def is_available(self) -> bool:
            return okvevo_fal_available()

        def list_models(self) -> list[dict[str, Any]]:
            return catalog_rows(FAL_MODELS)

        def default_model(self) -> Optional[str]:
            return DEFAULT_MODEL

        def capabilities(self) -> dict[str, Any]:
            try:
                _model_id, meta = img_tool._resolve_fal_model()
            except Exception:
                return {"modalities": ["text"], "max_reference_images": 0}
            if meta.get("edit_endpoint"):
                return {"modalities": ["text", "image"],
                        "max_reference_images": int(meta.get("max_reference_images") or 1),
                        "supports_upscale": True}
            return {"modalities": ["text"], "max_reference_images": 0, "supports_upscale": True}

        def generate(
            self, prompt: str, aspect_ratio: str = IMG_DEFAULT_ASPECT, *,
            image_url: Optional[str] = None, reference_image_urls: Optional[list[str]] = None,
            **kwargs: Any,
        ) -> dict[str, Any]:
            aspect = resolve_aspect_ratio(aspect_ratio)

            def fail(error: str, error_type: str, model_id: str = "") -> dict[str, Any]:
                return img_error(error=error, error_type=error_type, provider="okvevo",
                                 model=model_id, prompt=prompt, aspect_ratio=aspect)

            if not okvevo_fal_available():
                return fail(_SIGN_IN_MSG, "auth_required")
            if not isinstance(prompt, str) or not prompt.strip():
                return fail("Prompt is required and must be a non-empty string", "missing_prompt")
            model_id, meta = img_tool._resolve_fal_model()
            refs = reference_image_urls if isinstance(reference_image_urls, (list, tuple)) else []
            source_images = [c.strip() for c in (image_url, *refs) if isinstance(c, str) and c.strip()]
            if source_images and not meta.get("edit_endpoint"):
                return fail(
                    f"Model '{meta.get('display', model_id)}' is not capable of image-to-image / "
                    f"editing. Provide a text-only prompt (omit image_url), or switch to an "
                    f"edit-capable model via `hermes tools` → Image Generation.",
                    "modality_unsupported", model_id)
            aspect_lc = aspect if aspect in VALID_ASPECT_RATIOS else IMG_DEFAULT_ASPECT
            overrides = {k: kwargs[k] for k in
                         ("num_inference_steps", "guidance_scale", "num_images", "output_format")
                         if kwargs.get(k) is not None}
            seed = kwargs.get("seed") if isinstance(kwargs.get("seed"), int) else None
            if source_images:
                max_refs = int(meta.get("max_reference_images") or 1)
                clamped = source_images[:max_refs] if max_refs > 0 else source_images
                endpoint = meta["edit_endpoint"]
                arguments = img_tool._build_fal_edit_payload(
                    model_id, prompt, clamped, aspect_lc, seed=seed, overrides=overrides)
                modality = "image"
            else:
                endpoint = model_id
                arguments = img_tool._build_fal_payload(
                    model_id, prompt, aspect_lc, seed=seed, overrides=overrides)
                modality = "text"

            denial = okvevo_fal_spend_gate("image_generate", endpoint, arguments)
            if denial:
                return fail(denial, "approval_denied", model_id)

            try:
                result = img_tool._wait_fal_result(
                    _submit_okvevo_fal(endpoint, arguments, what="image model"))
                if not result or not result.get("images"):
                    raise ValueError(public_error_message("No images were generated"))
                upscale = kwargs.get("upscale")
                # Explicit ``upscale`` wins, including for edits; the catalog
                # default never upscales edits (Clarity is a text-to-image pass).
                should_upscale = (bool(upscale) if upscale is not None
                                  else bool(meta.get("upscale", False)) and modality == "text")
                formatted = []
                for img in result["images"]:
                    if not (isinstance(img, dict) and "url" in img):
                        continue
                    if should_upscale:
                        up = _upscale_image(img["url"], prompt.strip())
                        if up:
                            formatted.append(up)
                            continue
                        logger.warning("Using original image as fallback (upscale failed)")
                    formatted.append({"url": img["url"], "width": img.get("width", 0),
                                      "height": img.get("height", 0), "upscaled": False})
                if not formatted:
                    raise ValueError(public_error_message("No valid image URLs returned from API"))
            except img_tool.ImageGenerationInterrupted as exc:
                return fail(str(exc), "interrupted", model_id)
            except ValueError as exc:
                return fail(str(exc), "api_error", model_id)
            except Exception as exc:  # noqa: BLE001 — uniform provider contract
                logger.warning("OkVevo image gen failed (model=%s): %s", model_id, exc, exc_info=True)
                return fail(public_error_message(str(exc)), "api_error", model_id)

            return img_success(
                image=formatted[0]["url"], provider="okvevo", model=model_id, prompt=prompt,
                aspect_ratio=aspect_lc, modality=modality,
                extra={"upscaled": bool(formatted[0].get("upscaled"))},
            )

    return _OkvevoImageGenProvider()
