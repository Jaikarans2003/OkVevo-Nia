"""Phase 1 drama portal adapter. No network, no Fal key."""

from __future__ import annotations

import base64
import importlib.util
import shutil
import subprocess
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


def test_wan_profile_routes_through_adapter():
    """A profile whose target_video_model is wan-3.0 is not in the generic
    chooser menu, but the adapter must still reach alibaba/wan-3.0-prime."""
    adapters = _load()
    job = {"modality": "video", "parameters": {"model": "wan-3.0"}, "references": []}
    assert adapters._portal_endpoint(job) == "alibaba/wan-3.0-prime/text-to-video"
    job["references"] = ["/tmp/ref.png"]
    assert adapters._portal_endpoint(job) == "alibaba/wan-3.0-prime/image-to-video"


def test_gpt_edit_ref_cap_is_four():
    adapters = _load()
    job = {
        "modality": "image",
        "parameters": {"model": "gpt-image-2"},
        "references": [f"/tmp/r{i}.png" for i in range(5)],
    }
    with pytest.raises(adapters.AdapterFailure, match="at most 4"):
        adapters._portal_endpoint(job)
    job["references"] = job["references"][:4]
    assert adapters._portal_endpoint(job) == "openai/gpt-image-2/edit"


def test_portal_media_args_shape():
    adapters = _load()
    job = {"references": ["/tmp/a.png", "/tmp/b.png"]}
    with pytest.raises(adapters.AdapterFailure, match="one first-frame"):
        adapters._portal_media_args(job, "alibaba/wan-3.0-prime/image-to-video")
    assert adapters._portal_media_args({"references": []}, "openai/gpt-image-2") == {}
    with pytest.raises(adapters.AdapterFailure, match="first-frame"):
        adapters._portal_media_args({"references": []}, "alibaba/wan-3.0-prime/image-to-video")


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required to build and probe reference images",
)
def test_nine_references_downscale_under_portal_cap(tmp_path):
    """9 realistic 3000x2000 PNGs (multi-MB each, photo-like grain) must fit
    the portal body cap after the ffmpeg downscale/re-encode pass."""
    adapters = _load()
    refs = []
    for i in range(9):
        target = tmp_path / f"ref-{i}.png"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
             "-i", "testsrc2=size=3000x2000:duration=1,noise=alls=25:allf=t",
             "-frames:v", "1", str(target)],
            check=True,
        )
        assert target.stat().st_size > 2 * 1024 * 1024  # realistic source size
        refs.append(target)
    urls = [adapters._portal_image_data_url(path) for path in refs]
    assert all(url.startswith("data:image/") for url in urls)
    assert sum(len(url) for url in urls) < adapters.PORTAL_INLINE_BODY_LIMIT
    assert all(len(url) < path.stat().st_size for url, path in zip(urls, refs))
    header, b64 = urls[0].split(",", 1)
    decoded = tmp_path / f"decoded.{header.removeprefix('data:image/')}"
    decoded.write_bytes(base64.b64decode(b64))
    width, height, _ = adapters._probe_image(decoded)
    assert max(width, height) <= adapters.PORTAL_IMAGE_EDGE
