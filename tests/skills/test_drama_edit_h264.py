"""LGPL H.264 delivery: encoder resolution order and the bundled ffmpeg.

No network. The bundled-binary test skips unless
apps/desktop/resources/ffmpeg/<platform>-<arch>/ffmpeg exists (run
apps/desktop/scripts/fetch-ffmpeg.mjs first).
"""

from __future__ import annotations

import importlib.util
import platform
import stat
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[2]
_PATH = _ROOT / "skills" / "creative" / "short-drama-edit" / "scripts" / "edit_tool.py"


def _load():
    spec = importlib.util.spec_from_file_location("edit_tool", _PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _fake_ffmpeg(tmp_path: Path, encoders: str) -> str:
    script = tmp_path / "ffmpeg"
    script.write_text(f"#!/bin/sh\ncat <<'EOF'\n{encoders}\nEOF\n", encoding="utf-8")
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return str(script)


def test_h264_delivery_prefers_hardware_then_libx264(tmp_path):
    edit_tool = _load()
    listing = (
        "Encoders:\n"
        " V..... libx264              libx264 H.264\n"
        " V....D h264_videotoolbox    VideoToolbox H.264 Encoder\n"
        " V....D h264_mf              MediaFoundation H.264\n"
    )
    args = edit_tool._h264_delivery_args(_fake_ffmpeg(tmp_path, listing))
    assert args[:2] == ["-c:v", "h264_videotoolbox"]

    edit_tool._ENCODER_LISTING_CACHE.clear()
    no_vt = listing.replace(" V....D h264_videotoolbox    VideoToolbox H.264 Encoder\n", "")
    args = edit_tool._h264_delivery_args(_fake_ffmpeg(tmp_path, no_vt))
    assert args[:2] == ["-c:v", "h264_mf"]

    edit_tool._ENCODER_LISTING_CACHE.clear()
    only_x264 = " V..... libx264              libx264 H.264\n"
    args = edit_tool._h264_delivery_args(_fake_ffmpeg(tmp_path, only_x264))
    assert args == ["-c:v", "libx264", "-preset", "medium", "-crf", "18"]

    edit_tool._ENCODER_LISTING_CACHE.clear()
    with pytest.raises(edit_tool.EditError, match="H.264"):
        edit_tool._h264_delivery_args(_fake_ffmpeg(tmp_path, " V..... mpeg4               MPEG-4\n"))


def _bundled(tool: str) -> Path:
    machine = platform.machine()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    system = platform.system()
    plat = "darwin" if system == "Darwin" else "win32" if system == "Windows" else "linux"
    suffix = ".exe" if plat == "win32" else ""
    return _ROOT / "apps" / "desktop" / "resources" / "ffmpeg" / f"{plat}-{arch}" / f"{tool}{suffix}"


@pytest.mark.skipif(not _bundled("ffmpeg").exists(), reason="bundled ffmpeg not fetched")
def test_bundled_ffmpeg_last_frame_extraction(tmp_path):
    """The continuous-shot path pulls the previous shot's real last frame;
    the bundled LGPL binary must do that end to end."""
    ffmpeg, ffprobe = str(_bundled("ffmpeg")), str(_bundled("ffprobe"))
    encoders = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=True
    ).stdout
    assert " libx264 " not in encoders and " libx265 " not in encoders

    clip = tmp_path / "shot.mp4"
    frame = tmp_path / "last.png"
    subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-f", "lavfi",
         "-i", "testsrc2=size=320x240:duration=2,format=yuv420p",
         *_load()._h264_delivery_args(ffmpeg), str(clip)],
        check=True,
    )
    subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-sseof", "-0.1", "-i", str(clip),
         "-frames:v", "1", str(frame)],
        check=True,
    )
    assert frame.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    probed = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(clip)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert probed.startswith("320,240")
