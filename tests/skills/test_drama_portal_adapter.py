"""Drama portal adapter, full parity. No network, no Fal key.

The portal measures uploaded media server-side; these tests pin the adapter's
routing (native extend/edit/reference/frames), the upload-flow contract
(consent, signed PUT, complete), and the media cache that lets an extend chain
reuse the previous shot's Fal output URL instead of re-uploading.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import time
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


class FakeHttp:
    """Records portal upload calls; no network."""

    def __init__(self, voices=None):
        self.posts: list[tuple[str, dict]] = []
        self.puts: list[tuple[str, bytes, str]] = []
        self.gets: list[str] = []
        self.deletes: list[str] = []
        self.voices = voices or []

    def post_json(self, path, body):
        self.posts.append((path, body))
        if path == "/api/fal/uploads":
            return {"path": "drama-inputs/uid/11111111-2222-3333-4444-555555555555.png",
                    "uploadUrl": "https://storage.example/signed-put"}
        if path == "/api/fal/uploads/complete":
            return {"ref": "drama-upload://11111111-2222-3333-4444-555555555555"}
        raise AssertionError(f"unexpected POST {path}")

    def get_json(self, path):
        self.gets.append(path)
        if path == "/api/fal/voices":
            return {"voices": self.voices}
        raise AssertionError(f"unexpected GET {path}")

    def delete_json(self, path):
        self.deletes.append(path)
        return {
            "deleted": True,
            "provider_deleted": False,
            "note": "Fal/MiniMax has no delete-voice API. Unused provider clones auto-delete after 7 days.",
        }

    def put_bytes(self, url, data, content_type):
        self.puts.append((url, data, content_type))


def _project(tmp_path: Path, files: dict[str, bytes]) -> Path:
    for name, data in files.items():
        (tmp_path / name).write_bytes(data)
    return tmp_path


PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)
MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 32
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 32


def _job(tmp_path: Path, references, **kw):
    job = {
        "modality": "video",
        "prompt": "p",
        "outputs": ["o.mp4"],
        "parameters": {},
        "references": references,
        "project_root": str(tmp_path),
    }
    job.update(kw)
    return job


# --- routing ---------------------------------------------------------------

def test_text_routes_per_family():
    adapters = _load()
    assert adapters._portal_endpoint(_job(Path("/x"), [])) == "bytedance/seedance-2.5/text-to-video"
    assert adapters._portal_endpoint(
        _job(Path("/x"), [], parameters={"model": "wan-3.0"})
    ) == "alibaba/wan-3.0-prime/text-to-video"
    assert adapters._portal_endpoint(
        _job(Path("/x"), [], parameters={"model": "minimax-h3"})
    ) == "minimax/h3-max/text-to-video"
    assert adapters._portal_endpoint(
        _job(Path("/x"), [], parameters={"model": "seedance-2.0"})
    ) == "bytedance/seedance-2.0/text-to-video"


def test_first_and_last_frames_route_to_image_to_video():
    adapters = _load()
    assert adapters._portal_endpoint(_job(Path("/x"), ["a.png"])) == (
        "bytedance/seedance-2.5/image-to-video"
    )
    bound = _job(
        Path("/x"),
        ["a.png", "b.png"],
        reference_bindings=[{"role": "first_frame"}, {"role": "last_frame"}],
    )
    assert adapters._portal_endpoint(bound) == "bytedance/seedance-2.5/image-to-video"
    # Two unbound images: first frame + reference image -> reference endpoint.
    assert adapters._portal_endpoint(_job(Path("/x"), ["a.png", "b.png"])) == (
        "bytedance/seedance-2.5/reference-to-video"
    )


def test_extend_and_edit_route_to_seedance_25_reference():
    adapters = _load()
    for task in ("extend", "edit"):
        job = _job(
            Path("/x"),
            ["shot1.mp4"],
            parameters={"task": task},
            reference_bindings=[{"role": "reference_video"}],
        )
        assert adapters._portal_endpoint(job) == "bytedance/seedance-2.5/reference-to-video"


def test_extend_without_video_fails_before_any_upload():
    adapters = _load()
    job = _job(
        Path("/x"),
        ["a.png"],
        parameters={"task": "extend"},
        reference_bindings=[{"role": "first_frame"}],
    )
    with pytest.raises(adapters.AdapterFailure, match="reference_video"):
        adapters._portal_endpoint(job)


def test_reference_media_routes_per_family():
    adapters = _load()
    assert adapters._portal_endpoint(_job(Path("/x"), ["clip.mp4"])) == (
        "bytedance/seedance-2.5/reference-to-video"
    )
    assert adapters._portal_endpoint(
        _job(Path("/x"), ["clip.mp4"], parameters={"model": "minimax-h3"})
    ) == "minimax/h3-max/reference-to-video"
    assert adapters._portal_endpoint(
        _job(Path("/x"), ["voice.wav"], parameters={"model": "wan-3.0"})
    ) == "alibaba/wan-3.0-prime/reference-to-video"


def test_unknown_task_fails():
    adapters = _load()
    with pytest.raises(adapters.AdapterFailure, match="task"):
        adapters._portal_endpoint(_job(Path("/x"), [], parameters={"task": "rewind"}))


def test_gpt_edit_ref_cap_is_schema_max():
    adapters = _load()
    job = {
        "modality": "image",
        "parameters": {"model": "gpt-image-2"},
        "references": [f"/tmp/r{i}.png" for i in range(17)],
    }
    with pytest.raises(adapters.AdapterFailure, match="at most 16"):
        adapters._portal_endpoint(job)
    job["references"] = job["references"][:16]
    assert adapters._portal_endpoint(job) == "openai/gpt-image-2/edit"
    job["references"] = []
    assert adapters._portal_endpoint(job) == "openai/gpt-image-2"


def test_media_slot_keys_match_fal_schema():
    adapters = _load()
    assert adapters._media_slot("bytedance/seedance-2.5/image-to-video", "first_frame") == ("image_url", False)
    assert adapters._media_slot("bytedance/seedance-2.5/image-to-video", "last_frame") == ("end_image_url", False)
    assert adapters._media_slot("alibaba/wan-3.0-prime/image-to-video", "first_frame") == ("start_image_url", False)
    ref = "bytedance/seedance-2.5/reference-to-video"
    assert adapters._media_slot(ref, "reference_image") == ("image_urls", True)
    assert adapters._media_slot(ref, "reference_video") == ("video_urls", True)
    assert adapters._media_slot(ref, "reference_audio") == ("audio_urls", True)
    h3 = "minimax/h3-max/reference-to-video"
    assert adapters._media_slot(h3, "first_frame") == ("image_url", False)
    assert adapters._media_slot(h3, "reference_video") == ("reference_video_urls", True)
    assert adapters._media_slot(h3, "reference_audio") == ("reference_audio_urls", True)
    wan = "alibaba/wan-3.0-prime/reference-to-video"
    assert adapters._media_slot(wan, "reference_image") == ("reference_image_urls", True)
    assert adapters._media_slot("openai/gpt-image-2/edit", "reference_image") == ("image_urls", True)


# --- upload flow -------------------------------------------------------------

def test_upload_flow_consent_put_complete(tmp_path):
    adapters = _load()
    _project(tmp_path, {"a.png": PNG})
    http = FakeHttp()
    job = _job(tmp_path, ["a.png"], parameters={"consent_rights": True})
    args = adapters._portal_media_args(
        job, "bytedance/seedance-2.5/image-to-video", http=http
    )
    assert args == {"image_url": "drama-upload://11111111-2222-3333-4444-555555555555"}
    assert http.posts[0][0] == "/api/fal/uploads"
    assert http.posts[0][1]["contentType"] == "image/png"
    assert http.posts[0][1]["bytes"] == len(PNG)
    assert http.posts[0][1]["consentRights"] is True
    assert http.puts == [("https://storage.example/signed-put", PNG, "image/png")]
    assert http.posts[1] == ("/api/fal/uploads/complete", {"path": "drama-inputs/uid/11111111-2222-3333-4444-555555555555.png"})


def test_upload_requires_consent(tmp_path):
    adapters = _load()
    _project(tmp_path, {"a.png": PNG})
    http = FakeHttp()
    job = _job(tmp_path, ["a.png"])  # no consent_rights
    with pytest.raises(adapters.AdapterFailure, match="consent"):
        adapters._portal_media_args(job, "bytedance/seedance-2.5/image-to-video", http=http)
    assert http.posts == [] and http.puts == []


def test_reference_arrays_per_kind(tmp_path):
    adapters = _load()
    _project(tmp_path, {"a.png": PNG, "b.mp4": MP4, "c.mp3": MP3})
    http = FakeHttp()
    job = _job(tmp_path, ["a.png", "b.mp4", "c.mp3"], parameters={"consent_rights": True})
    args = adapters._portal_media_args(
        job, "bytedance/seedance-2.5/reference-to-video", http=http
    )
    ref = "drama-upload://11111111-2222-3333-4444-555555555555"
    assert args == {"image_urls": [ref], "video_urls": [ref], "audio_urls": [ref]}
    kinds = [post[1]["contentType"] for post in http.posts if post[0] == "/api/fal/uploads"]
    assert kinds == ["image/png", "video/mp4", "audio/mpeg"]


def test_wan_first_frame_key(tmp_path):
    adapters = _load()
    _project(tmp_path, {"a.png": PNG})
    http = FakeHttp()
    job = _job(tmp_path, ["a.png"], parameters={"consent_rights": True})
    args = adapters._portal_media_args(
        job, "alibaba/wan-3.0-prime/image-to-video", http=http
    )
    assert list(args) == ["start_image_url"]


# --- media cache / extend chain ----------------------------------------------

def _seed_cache(adapters, tmp_path: Path, name: str, ref: str, at: float) -> None:
    digest = hashlib.sha256((tmp_path / name).read_bytes()).hexdigest()
    handles = tmp_path / "handles"
    handles.mkdir(exist_ok=True)
    (handles / adapters.PORTAL_MEDIA_CACHE).write_text(
        json.dumps({digest: {"ref": ref, "at": at}}), encoding="utf-8"
    )


def test_extend_chain_reuses_prior_fal_output(tmp_path):
    """Shot 2 binds shot 1's real output video. The portal still serves that
    Fal URL (recorded in the media cache at shot 1's completion), so shot 2
    submits task=extension with the Fal URL and uploads nothing."""
    adapters = _load()
    _project(tmp_path, {"shot1.mp4": MP4})
    fal_url = "https://v3b.fal.media/files/shot1.mp4"
    _seed_cache(adapters, tmp_path, "shot1.mp4", fal_url, time.time())
    job = _job(
        tmp_path,
        ["shot1.mp4"],
        parameters={"task": "extend", "consent_rights": True},
        reference_bindings=[{"role": "reference_video"}],
        handle_path=str(tmp_path / "handles" / "shot2.json"),
    )
    endpoint = adapters._portal_endpoint(job)
    assert endpoint == "bytedance/seedance-2.5/reference-to-video"
    http = FakeHttp()
    args = adapters._portal_media_args(job, endpoint, http=http)
    assert args == {"video_urls": [fal_url]}
    assert http.posts == [] and http.puts == []
    portal_args = adapters.explicit_portal_args(job, endpoint)
    assert portal_args["task"] == "extension"
    assert portal_args["duration"] == 5  # extension bills requested output seconds


def test_stale_cache_entry_reuploads(tmp_path):
    adapters = _load()
    _project(tmp_path, {"shot1.mp4": MP4})
    stale = time.time() - adapters.PORTAL_FAL_REUSE_S - 60
    _seed_cache(adapters, tmp_path, "shot1.mp4", "https://v3b.fal.media/old.mp4", stale)
    job = _job(
        tmp_path,
        ["shot1.mp4"],
        parameters={"task": "extend", "consent_rights": True},
        reference_bindings=[{"role": "reference_video"}],
        handle_path=str(tmp_path / "handles" / "shot2.json"),
    )
    http = FakeHttp()
    args = adapters._portal_media_args(
        job, "bytedance/seedance-2.5/reference-to-video", http=http
    )
    assert args == {"video_urls": ["drama-upload://11111111-2222-3333-4444-555555555555"]}
    assert len(http.puts) == 1


def test_editing_drops_duration():
    adapters = _load()
    job = _job(Path("/x"), ["shot1.mp4"], parameters={"task": "edit", "duration": 9})
    args = adapters.explicit_portal_args(job, "bytedance/seedance-2.5/reference-to-video")
    assert args["task"] == "editing"
    assert "duration" not in args  # Fal forces auto; portal prices input seconds
    assert "omni_reference_task_type" not in args


# --- speech -------------------------------------------------------------------

def test_speech_reference_audio_and_length():
    adapters = _load()
    with pytest.raises(ValueError, match="fal-ai/minimax/voice-clone"):
        adapters.prepare_speech(
            {"prompt": "hello", "reference_bindings": [{"role": "reference_audio"}]}
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


def test_voice_clone_consent_once_and_reuse(tmp_path):
    adapters = _load()
    job = {
        "prompt": "line",
        "handle_path": str(tmp_path / "handle.json"),
        "reference_bindings": [{"role": "reference_audio"}],
        "parameters": {"voice_clone_consent": True, "character": "hero"},
    }
    with pytest.raises(ValueError, match="consent"):
        adapters.prepare_voice_clone(
            {
                "prompt": "x",
                "handle_path": str(tmp_path / "handle.json"),
                "reference_bindings": [{"role": "reference_audio"}],
            }
        )
    prepared = adapters.prepare_voice_clone(job)
    assert prepared["endpoint"] == adapters.PORTAL_VOICE_CLONE_ENDPOINT
    assert prepared["text"] == adapters.VOICE_CLONE_PREVIEW
    assert prepared["preview_text"] == adapters.VOICE_CLONE_PREVIEW
    assert adapters._media_slot(adapters.PORTAL_VOICE_CLONE_ENDPOINT, "reference_audio") == (
        "audio_url",
        False,
    )
    adapters._voice_store_write(
        job,
        {
            "custom_voice_id": "cloned-hero-1",
            "cloned_at": "2026-10-10T00:00:00Z",
            "used_in_tts_at": None,
            "character": "hero",
        },
    )
    reused = adapters.prepare_speech(
        {
            "prompt": "second line",
            "handle_path": str(tmp_path / "handle.json"),
            "parameters": {"character": "hero", "voice_direction": {"language": "hi"}},
        }
    )
    assert reused["voice_id"] == "cloned-hero-1"
    assert reused["endpoint"] == adapters.PORTAL_SPEECH_ENDPOINT
    assert reused["language_boost"] == "Hindi"
    with pytest.raises(ValueError, match="confirm_reclone"):
        adapters.prepare_voice_clone(job)
    again = adapters.prepare_voice_clone(
        {
            **job,
            "parameters": {
                "voice_clone_consent": True,
                "confirm_reclone": True,
                "character": "hero",
            },
        }
    )
    assert again["endpoint"] == adapters.PORTAL_VOICE_CLONE_ENDPOINT
    assert adapters._extract_custom_voice_id({"custom_voice_id": "abc"}) == "abc"


def test_voice_restore_from_portal_when_local_cache_missing(tmp_path):
    adapters = _load()
    job = {
        "prompt": "line",
        "handle_path": str(tmp_path / "handle.json"),
        "parameters": {"character": "hero", "voice_direction": {"language": "hi"}},
    }
    http = FakeHttp(
        voices=[
            {
                "custom_voice_id": "cloned-hero-1",
                "character": "hero",
                "cloned_at": "2026-10-01T00:00:00Z",
                "used_in_tts_at": None,
            }
        ]
    )
    reused = adapters.prepare_speech(job, http=http)
    assert reused["voice_id"] == "cloned-hero-1"
    assert reused["endpoint"] == adapters.PORTAL_SPEECH_ENDPOINT
    assert http.gets == ["/api/fal/voices"]
    cached = tmp_path / "metadata" / "voices" / "hero.json"
    assert json.loads(cached.read_text())["custom_voice_id"] == "cloned-hero-1"
    again = adapters.prepare_speech(job, http=http)
    assert again["voice_id"] == "cloned-hero-1"
    assert http.gets == ["/api/fal/voices"]


def test_delete_cloned_voice_drops_cache_and_portal_record(tmp_path):
    adapters = _load()
    job = {
        "handle_path": str(tmp_path / "handle.json"),
        "parameters": {"character": "hero"},
    }
    adapters._voice_store_write(
        job,
        {"custom_voice_id": "cloned-hero-1", "character": "hero", "cloned_at": "2026-10-01T00:00:00Z"},
    )
    http = FakeHttp()
    result = adapters.delete_cloned_voice(job, http=http)
    assert result["deleted"] is True
    assert result["provider_deleted"] is False
    assert result["custom_voice_id"] == "cloned-hero-1"
    assert http.deletes == ["/api/fal/voices/cloned-hero-1"]
    assert not (tmp_path / "metadata" / "voices" / "hero.json").exists()


# --- result payloads / download -----------------------------------------------

def test_payload_result_urls_by_shape():
    adapters = _load()
    assert adapters._payload_result_urls({"video": {"url": "https://v3b.fal.media/a.mp4"}}) == [
        "https://v3b.fal.media/a.mp4"
    ]
    assert adapters._payload_result_urls({"images": [{"url": "https://v3b.fal.media/a.png"}]}) == [
        "https://v3b.fal.media/a.png"
    ]
    assert adapters._payload_result_urls({"audio": {"url": "https://v3b.fal.media/a.mp3"}}) == [
        "https://v3b.fal.media/a.mp3"
    ]
    assert adapters._payload_result_urls({"status": "COMPLETED", "logs": []}) == []


def test_download_allowlist_rejects_other_hosts():
    adapters = _load()
    with pytest.raises(adapters.AdapterFailure, match="allowlist"):
        adapters._download(
            {"outputs": ["a.mp4"]},
            "https://example.com/a.mp4",
            "a.mp4",
            provider="okvevo",
        )


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required to build and probe reference images",
)
def test_oversized_image_downscales_under_portal_bound(tmp_path):
    """A 3000x2000 reference exceeds the portal's 2048px normalization bound;
    _portal_image_bytes must downscale it below the bound and the byte cap."""
    adapters = _load()
    target = tmp_path / "ref.png"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", "testsrc2=size=3000x2000:duration=1,noise=alls=25:allf=t",
         "-frames:v", "1", str(target)],
        check=True,
    )
    data, mime = adapters._portal_image_bytes(target)
    assert len(data) <= adapters.PORTAL_UPLOAD_CAPS["image"]
    out = tmp_path / f"out.{mime.split('/')[1]}"
    out.write_bytes(data)
    width, height, _ = adapters._probe_image(out)
    assert max(width, height) <= adapters.PORTAL_IMAGE_EDGE
