"""Phase 1 drama portal adapter. No network, no Fal key."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_PATH = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "creative"
    / "short-drama-produce"
    / "scripts"
    / "provider_adapters.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("provider_adapters", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_two_shot_scene_is_image_to_video_not_extend():
    adapters = _load()
    scene = adapters.phase1_scene(
        [
            {"task": "text", "continuous": True, "last_frame": "shot-1-last.png"},
            {
                "task": "extend",
                "continuous": True,
                "start_frame": "shot-1-last.png",
            },
        ],
        ffmpeg_available=True,
    )
    assert scene[1]["endpoint"] == "bytedance/seedance-2.5/image-to-video"
    assert scene[1]["task"] == "image"
    assert "extend" not in scene[1]["endpoint"]


def test_missing_ffmpeg_fails_before_hold():
    adapters = _load()
    held = {"n": 0}

    def hold():
        held["n"] += 1

    with pytest.raises(ValueError, match="ffmpeg"):
        adapters.phase1_scene(
            [
                {"task": "text", "last_frame": "a.png"},
                {"task": "extend", "continuous": True, "needs_frame_extract": True},
            ],
            ffmpeg_available=False,
            hold=None,
        )
    assert held["n"] == 0
    with pytest.raises(AssertionError):
        adapters.phase1_scene(
            [{"task": "text"}],
            ffmpeg_available=True,
            hold=hold,
        )


def test_speech_reference_audio_and_length():
    adapters = _load()
    with pytest.raises(ValueError, match="reference audio"):
        adapters.prepare_speech(
            {
                "prompt": "hello",
                "reference_bindings": [{"role": "reference_audio"}],
            }
        )
    with pytest.raises(ValueError, match="5000"):
        adapters.prepare_speech({"prompt": "x" * 5001})
    hindi = adapters.prepare_speech(
        {
            "prompt": "नमस्ते 2.",
            "parameters": {
                "voice_direction": {"language": "hi", "age": "adult", "gender": "female"}
            },
        }
    )
    assert hindi["voice_id"] == "Wise_Woman"
    assert hindi["language_boost"] == "Hindi"
    assert hindi["voice_id"] in adapters.VERIFIED_VOICE_IDS


def test_download_allowlist_rejects_other_hosts():
    adapters = _load()
    with pytest.raises(adapters.AdapterFailure, match="allowlist"):
        adapters._download(
            {"outputs": ["a.mp4"]},
            "https://example.com/a.mp4",
            "a.mp4",
            provider="okvevo",
        )
