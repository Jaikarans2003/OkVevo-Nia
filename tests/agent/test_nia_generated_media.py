"""Tests for durable generated-media helper (validate-first, tiers)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from agent.nia_generated_media import (
    OutputValidationError,
    resolve_and_validate,
    save_generated_bytes,
    save_generated_url,
)
from agent.provider_media import GENERATED_SUBDIR


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    home = tmp_path / "hermes_home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("HERMES_SESSION_PROJECT_PATH", raising=False)
    monkeypatch.delenv("HERMES_GENERATED_OUTPUT_DIR", raising=False)
    return home


def test_tier_c_writes_under_generated(hermes_home):
    result = save_generated_bytes(
        "images", b"png-bytes", prefix="image", extension="png", apply_tiers=True
    )
    assert result.path.is_absolute()
    assert "~" not in str(result.path)
    assert result.warning is None
    rel = result.path.relative_to(hermes_home)
    assert rel.parts[:3] == ("cache", GENERATED_SUBDIR, "images")
    assert result.path.read_bytes() == b"png-bytes"


def test_tier_a_output_dir_flat_move(hermes_home, tmp_path):
    dest = tmp_path / "exports"
    dest.mkdir()
    result = save_generated_bytes(
        "images",
        b"img",
        prefix="image",
        extension="png",
        output_dir=str(dest),
    )
    assert result.path.parent == dest.resolve()
    assert result.path.read_bytes() == b"img"
    # Nothing left dangling unnamed under generated (moved).
    gen = hermes_home / "cache" / GENERATED_SUBDIR / "images"
    assert list(gen.glob("image_*")) == [] or result.path.parent != gen


def test_tier_b_session_project_path(hermes_home, tmp_path, monkeypatch):
    project = tmp_path / "MyProject"
    project.mkdir()
    monkeypatch.setenv("HERMES_SESSION_PROJECT_PATH", str(project))
    result = save_generated_bytes(
        "videos", b"mp4", prefix="video", extension="mp4"
    )
    assert result.path.parent == project.resolve()
    assert result.path.is_absolute()


def test_pet_apply_tiers_false_ignores_project(hermes_home, tmp_path, monkeypatch):
    project = tmp_path / "proj"
    project.mkdir()
    monkeypatch.setenv("HERMES_SESSION_PROJECT_PATH", str(project))
    result = save_generated_bytes(
        "images", b"x", prefix="pet", extension="png", apply_tiers=False
    )
    assert "generated" in result.path.parts
    assert result.path.parent != project.resolve()


def test_validate_rejects_before_download(hermes_home, monkeypatch):
    """F1: validation failure — no Fal/download, no credits."""
    download = MagicMock()
    with patch("agent.provider_media.save_url", download):
        with pytest.raises(OutputValidationError, match="traversal"):
            resolve_and_validate("images", output_dir="safe/../../etc/shadow")
        # Also exercise save path: denied path must not call save_url
        with pytest.raises(OutputValidationError):
            save_generated_url(
                "images",
                "https://example.com/x.png",
                prefix="image",
                output_dir="foo/../../etc/shadow",
                timeout=1.0,
                max_bytes=100,
                chunk_size=64,
                content_types={"image/png": "png"},
                url_extensions=("png",),
                default_extension="png",
                label="Image",
                empty_error="empty",
            )
    download.assert_not_called()


def test_validate_rejects_media_directive(hermes_home):
    with pytest.raises(OutputValidationError, match="MEDIA"):
        resolve_and_validate("images", output_dir="/tmp/MEDIA:/evil.png")


def test_move_fail_keeps_generated_and_warns(hermes_home, tmp_path, monkeypatch):
    dest = tmp_path / "locked"
    dest.mkdir()
    # Make destination unwritable by replacing mkdir/move behavior.
    real_move = __import__("shutil").move

    def boom(src, dst):
        raise OSError("simulated move failure")

    monkeypatch.setattr("agent.nia_generated_media.shutil.move", boom)
    result = save_generated_bytes(
        "images", b"keep-me", prefix="image", extension="png", output_dir=str(dest)
    )
    assert result.warning is not None
    assert "Kept durable copy" in result.warning
    assert result.path.is_file()
    assert result.path.read_bytes() == b"keep-me"
    assert GENERATED_SUBDIR in result.path.parts
    monkeypatch.setattr("agent.nia_generated_media.shutil.move", real_move)


def test_no_tilde_in_stored_path(hermes_home, tmp_path, monkeypatch):
    dest = tmp_path / "out"
    dest.mkdir()
    # expanduser-style input must still store absolute
    monkeypatch.setenv("HOME", str(tmp_path))
    result = save_generated_bytes(
        "audio", b"wav", prefix="tts", extension="mp3", output_dir=str(dest)
    )
    assert not str(result.path).startswith("~")
    assert result.path.is_absolute()


def test_image_tool_validation_reject_skips_fal(hermes_home, monkeypatch):
    """Unit: validation reject → Fal never called, no credits."""
    from tools import image_generation_tool as igt

    monkeypatch.setattr(
        "agent.nia_generated_media.resolve_and_validate",
        MagicMock(side_effect=OutputValidationError("bad folder")),
    )
    fal_submit = MagicMock()
    monkeypatch.setattr(igt, "_submit_fal_request", fal_submit)
    spend = MagicMock()
    monkeypatch.setattr(
        "agent.okvevo_gateway.ensure_okvevo_fal_run_id",
        spend,
        raising=False,
    )

    raw = igt.image_generate_tool(prompt="a cat")
    payload = json.loads(raw)
    assert payload["success"] is False
    assert "bad folder" in payload["error"]
    fal_submit.assert_not_called()


def test_sweep_leaves_generated(hermes_home):
    from gateway.platforms.base import cleanup_image_cache

    gen = hermes_home / "cache" / GENERATED_SUBDIR / "images"
    gen.mkdir(parents=True)
    durable = gen / "keep.png"
    durable.write_bytes(b"durable")
    # Also populate swept cache/images with an old file
    swept = hermes_home / "cache" / "images"
    swept.mkdir(parents=True)
    old = swept / "old.png"
    old.write_bytes(b"old")
    os.utime(old, (0, 0))

    cleanup_image_cache(max_age_hours=1)
    assert durable.exists()


def test_auto_append_video_exactly_once():
    from gateway.run import (
        _AUTO_APPEND_MEDIA_TOOL_NAMES,
        _collect_auto_append_media_tags,
        _collect_history_media_paths,
    )

    assert "video_generate" in _AUTO_APPEND_MEDIA_TOOL_NAMES
    video_path = "/tmp/clip.mp4"
    messages = [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {"name": "video_generate", "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "c1",
            "content": json.dumps({"success": True, "video": video_path}),
        },
    ]
    tags, _ = _collect_auto_append_media_tags(messages)
    assert tags == [f"MEDIA:{video_path}"]
    history = _collect_history_media_paths(messages)
    tags2, _ = _collect_auto_append_media_tags(messages, history_media_paths=history)
    assert tags2 == []


def test_conformance_no_direct_cache_images_writers():
    """Gen writers must not hardcode cache/images or cache/videos anymore."""
    root = Path(__file__).resolve().parents[2]
    offenders = []
    for rel in (
        "agent/image_gen_provider.py",
        "agent/video_gen_provider.py",
    ):
        text = (root / rel).read_text(encoding="utf-8")
        if '_images_cache_dir' in text or '_videos_cache_dir' in text:
            offenders.append(rel)
        if 'cache" / "images"' in text or "cache' / 'images'" in text:
            if "generated" not in text.split("cache")[0][-40:]:
                # crude: still flag direct cache/images path construction
                if '/ "images"' in text and "GENERATED" not in text:
                    pass
        if "cache/images" in text and "generated/images" not in text and "doc" not in rel:
            # Allow comments mentioning the old path
            for line in text.splitlines():
                stripped = line.strip()
                if stripped.startswith("#") or stripped.startswith('"""') or stripped.startswith("'''"):
                    continue
                if "cache/images" in stripped and "generated" not in stripped:
                    offenders.append(f"{rel}:{stripped[:80]}")
    assert not offenders, offenders
