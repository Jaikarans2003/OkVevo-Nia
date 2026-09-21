"""Verified OkVevo Auto allow-lists (Phase B live OpenRouter probes).

Do not edit by hand unless re-running ``scripts/probe_okvevo_auto_router.py``.
"""

from __future__ import annotations

INTELLIGENCE_ALLOWED_MODELS: list[str] = [
    "anthropic/claude-fable-5",
    "anthropic/claude-opus-5",
    "anthropic/claude-opus-4.8",
    "anthropic/claude-sonnet-5",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-sol-pro",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-terra-pro",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-luna-pro",
    "x-ai/grok-4.6",
    "moonshotai/kimi-k3",
    "z-ai/glm-5.3",
    "deepseek/deepseek-v4-pro",
]

COST_ALLOWED_MODELS: list[str] = [
    "anthropic/claude-haiku-4.5",
    "openai/gpt-5.4-mini",
    "google/gemini-3.7-flash",
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.3-flash",
    "stepfun/step-3.7-flash",
    "minimax/minimax-m3",
    "tencent/hy4-preview",
]
