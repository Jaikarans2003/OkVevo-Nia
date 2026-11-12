"""Sync canary: every upstream-owned helper the okvevo plugins reuse, pinned.

The upstream-reset rule is that ``plugins/okvevo*`` never edits upstream
files; the cost is that these imports are upstream's private internals. When
an upstream sync renames or reshapes one, THIS file must fail — fix the
okvevo plugin in the same sync commit (see docs/okvevo/SYNC.md), never the
upstream file.
"""

from __future__ import annotations

import inspect


def test_video_fal_seams():
    import plugins.video_gen.fal as fal_video

    assert callable(fal_video._resolve_family)
    assert callable(fal_video._build_payload)
    assert callable(fal_video._video_url_from_result)
    assert callable(fal_video._load_fal_client)
    assert set(fal_video._MODALITY_MISSING_MSG) == {"image", "text"}
    assert isinstance(fal_video.UPSCALER_ENDPOINT, str)
    assert isinstance(fal_video.UPSCALER_FACTOR, int)
    params = inspect.signature(fal_video._build_payload).parameters
    for name in ("prompt", "image_url", "duration", "aspect_ratio", "resolution",
                 "negative_prompt", "audio", "seed"):
        assert name in params, f"_build_payload lost kwarg {name}"


def test_image_tool_seams():
    import tools.image_generation_tool as img_tool

    assert callable(img_tool._resolve_fal_model)
    assert callable(img_tool._build_fal_payload)
    assert callable(img_tool._build_fal_edit_payload)
    assert callable(img_tool._wait_fal_result)
    assert issubclass(img_tool.ImageGenerationInterrupted, Exception)
    from tools.image_generation_catalog import (  # noqa: F401
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


def test_fal_common_seams():
    from tools.fal_common import (  # noqa: F401
        _ManagedFalSyncClient,
        submit_managed_fal_with_rate_limit_retry,
        wait_fal_queue_result,
    )

    params = inspect.signature(_ManagedFalSyncClient.__init__).parameters
    assert "key" in params and "queue_run_origin" in params


def test_web_seams():
    from plugins.web._common import (  # noqa: F401
        SEARCH_LIMIT_CAP,
        BaseWebSearchProvider,
        http_status_detail,
        run_extract,
        run_search,
        setup_schema,
    )
    from plugins.web.tavily.provider import (  # noqa: F401
        _normalize_tavily_documents,
        _normalize_tavily_search_results,
    )


def test_provider_hook_seams():
    """The transport must apply profile top-level kwargs AFTER the base model
    kwarg (that ordering is what makes the Auto wire-model swap work), and the
    plugin error-classification hook must exist."""
    import agent.transports.chat_completions as cc
    from hermes_cli.plugins import get_plugin_error_classification  # noqa: F401

    src = inspect.getsource(cc.ChatCompletionsTransport._build_kwargs_from_profile)
    assert "api_kwargs.update(top_level_from_profile)" in src, (
        "transport no longer merges profile top-level kwargs over base kwargs — "
        "the okvevo Auto alias wire swap depends on this"
    )


def test_approval_seams():
    from tools.approval import is_approval_bypass_active, request_tool_approval  # noqa: F401

    params = inspect.signature(request_tool_approval).parameters
    assert "rule_key" in params
