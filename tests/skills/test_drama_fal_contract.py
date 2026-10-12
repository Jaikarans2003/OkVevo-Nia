"""Drama portal adapter ↔ Fal request contract. No network, no Fal key.

Every rate-card endpoint × mode builds its body through the real routing and
body builder (portal_request_body) and must validate against the pinned Fal
OpenAPI input schema (okvevo/fal-schemas, fetch date inside each file) with
objects closed: required fields, types, enums, and no field Fal does not
define. The portal runs the same check before any hold (OkVevo-Web
src/lib/fal/falSchema.ts); this catches it in CI before a tester does.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

_ROOT = Path(__file__).resolve().parents[2]
_PATH = _ROOT / "skills" / "creative" / "short-drama-produce" / "scripts" / "provider_adapters.py"
_SCHEMAS = _ROOT / "okvevo" / "fal-schemas"
# Portal-only control fields; pickSubmitArgs strips them before Fal.
_CONTROL = {"character", "project", "voice_clone_consent"}
_REF = "drama-upload://11111111-2222-3333-4444-555555555555"

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)
MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 32
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 32


def _load():
    spec = importlib.util.spec_from_file_location("provider_adapters_contract", _PATH)
    assert spec is not None and spec.loader is not None, f"drama adapter missing: {_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeHttp:
    def __init__(self, voices=None):
        self.voices = voices or []

    def post_json(self, path, body):
        if path == "/api/fal/uploads":
            return {"path": "drama-inputs/uid/11111111-2222-3333-4444-555555555555.png",
                    "uploadUrl": "https://storage.example/signed-put"}
        if path == "/api/fal/uploads/complete":
            return {"ref": _REF}
        raise AssertionError(f"unexpected POST {path}")

    def get_json(self, path):
        if path == "/api/fal/voices":
            return {"voices": self.voices}
        raise AssertionError(f"unexpected GET {path}")

    def put_bytes(self, url, data, content_type):
        pass


def _validator(endpoint: str) -> Draft202012Validator:
    """Fal's input schema with every object closed (Fal's OpenAPI leaves
    additionalProperties unset; an unknown field is still a contract bug)."""
    doc = json.loads((_SCHEMAS / (endpoint.replace("/", "__") + ".json")).read_text("utf-8"))["openapi"]
    ref = doc["paths"]["/" + endpoint]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"]
    components = copy.deepcopy(doc["components"])
    for schema in components["schemas"].values():
        if "properties" in schema:
            schema["additionalProperties"] = False
    return Draft202012Validator({"$ref": ref, "components": components})


def _errors(endpoint: str, body: dict) -> list[str]:
    return sorted(
        f"{'.'.join(map(str, e.absolute_path)) or '(body)'}: {e.message}"
        for e in _validator(endpoint).iter_errors(body)
    )


# (case id, expected endpoint, job overrides, files to create)
_V = {"modality": "video", "prompt": "a hero walks into the rain", "outputs": ["o.mp4"]}
_CONSENT = {"consent_rights": True}
CASES = [
    ("seedance-2.5 text", "bytedance/seedance-2.5/text-to-video", {**_V, "parameters": {"ratio": "9:16"}}, {}),
    ("seedance-2.5 image", "bytedance/seedance-2.5/image-to-video",
     {**_V, "references": ["a.png"], "parameters": {**_CONSENT, "ratio": "9:16"}}, {"a.png": PNG}),
    ("seedance-2.5 first+last", "bytedance/seedance-2.5/image-to-video",
     {**_V, "references": ["a.png", "b.png"], "parameters": _CONSENT,
      "reference_bindings": [{"role": "first_frame"}, {"role": "last_frame"}]}, {"a.png": PNG, "b.png": PNG}),
    ("seedance-2.5 reference", "bytedance/seedance-2.5/reference-to-video",
     {**_V, "references": ["a.png", "b.mp4", "c.mp3"], "parameters": {**_CONSENT, "ratio": "16:9"}},
     {"a.png": PNG, "b.mp4": MP4, "c.mp3": MP3}),
    ("seedance-2.5 extension", "bytedance/seedance-2.5/reference-to-video",
     {**_V, "references": ["s1.mp4"], "parameters": {**_CONSENT, "task": "extend", "duration": 8},
      "reference_bindings": [{"role": "reference_video"}]}, {"s1.mp4": MP4}),
    ("seedance-2.5 editing", "bytedance/seedance-2.5/reference-to-video",
     {**_V, "references": ["s1.mp4"], "parameters": {**_CONSENT, "task": "edit"},
      "reference_bindings": [{"role": "reference_video"}]}, {"s1.mp4": MP4}),
    ("seedance-2.0 text", "bytedance/seedance-2.0/text-to-video",
     {**_V, "parameters": {"model": "seedance-2.0", "resolution": "480p"}}, {}),
    ("seedance-2.0 image", "bytedance/seedance-2.0/image-to-video",
     {**_V, "references": ["a.png"], "parameters": {**_CONSENT, "model": "seedance-2.0"}}, {"a.png": PNG}),
    ("seedance-2.0 reference", "bytedance/seedance-2.0/reference-to-video",
     {**_V, "references": ["a.png", "b.mp4"], "parameters": {**_CONSENT, "model": "seedance-2.0"}},
     {"a.png": PNG, "b.mp4": MP4}),
    ("h3 text", "minimax/h3-max/text-to-video",
     {**_V, "parameters": {"model": "h3-max", "ratio": "9:16"}}, {}),
    ("h3 image", "minimax/h3-max/image-to-video",
     {**_V, "references": ["a.png"], "parameters": {**_CONSENT, "model": "h3-max", "resolution": "768p"}},
     {"a.png": PNG}),
    ("h3 reference", "minimax/h3-max/reference-to-video",
     {**_V, "references": ["a.png", "b.png"], "parameters": {**_CONSENT, "model": "h3-max", "ratio": "auto"},
      "reference_bindings": [{"role": "reference_image"}, {"role": "reference_image"}]},
     {"a.png": PNG, "b.png": PNG}),
    ("wan text", "alibaba/wan-3.0-prime/text-to-video",
     {**_V, "parameters": {"model": "wan-3.0", "ratio": "auto", "duration": 6}}, {}),
    ("wan image", "alibaba/wan-3.0-prime/image-to-video",
     {**_V, "references": ["a.png"], "parameters": {**_CONSENT, "model": "wan-3.0"}}, {"a.png": PNG}),
    ("wan reference", "alibaba/wan-3.0-prime/reference-to-video",
     {**_V, "references": ["a.png", "b.png"], "parameters": {**_CONSENT, "model": "wan-3.0"},
      "reference_bindings": [{"role": "reference_image"}, {"role": "reference_image"}]},
     {"a.png": PNG, "b.png": PNG}),
    ("gpt text", "openai/gpt-image-2",
     {"modality": "image", "prompt": "a red door", "outputs": ["a.png"], "quality": "low",
      "parameters": {"width": 1024, "height": 1024}}, {}),
    ("gpt edit", "openai/gpt-image-2/edit",
     {"modality": "image", "prompt": "make it night", "outputs": ["a.jpg"], "references": ["r.png"],
      "parameters": {**_CONSENT, "size": "1024x1024"}}, {"r.png": PNG}),
    ("music lyrics", "minimax/music-3",
     {"modality": "music", "prompt": "lofi", "outputs": ["m.mp3"],
      "parameters": {"lyrics": "[Verse]\nHello", "duration": 30}}, {}),
    ("music instrumental", "minimax/music-3",
     {"modality": "music", "prompt": "lofi", "outputs": ["m.mp3"],
      "parameters": {"is_instrumental": True}}, {}),
    ("speech preset", "fal-ai/minimax/speech-02-hd",
     {"modality": "tts", "prompt": "Hello there.", "outputs": ["s.mp3"],
      "parameters": {"voice_direction": {"language": "en", "age": "adult", "gender": "male"}}}, {}),
    ("speech hindi", "fal-ai/minimax/speech-02-hd",
     {"modality": "tts", "prompt": "Namaste.", "outputs": ["s.mp3"],
      "parameters": {"voice_direction": {"language": "hi", "age": "adult", "gender": "female"}}}, {}),
    ("speech custom", "fal-ai/minimax/speech-02-hd",
     {"modality": "tts", "prompt": "It is me.", "outputs": ["s.mp3"], "parameters": {"character": "hero"}}, {}),
    ("voice clone", "fal-ai/minimax/voice-clone",
     {"modality": "tts", "prompt": "line", "outputs": ["s.mp3"], "references": ["v.mp3"],
      "reference_bindings": [{"role": "reference_audio"}],
      "parameters": {**_CONSENT, "voice_clone_consent": True, "character": "villain"}}, {"v.mp3": MP3}),
]


def _build(adapters, monkeypatch, tmp_path, job, files):
    for name, data in files.items():
        (tmp_path / name).write_bytes(data)
    voices = [{"custom_voice_id": "cloned-hero-1", "character": "hero"}]
    monkeypatch.setattr(adapters, "_default_portal_http", lambda: FakeHttp(voices))
    job = {"project_root": str(tmp_path), "handle_path": str(tmp_path / "h" / "job.json"), **job}
    endpoint = adapters._portal_endpoint(job)
    return endpoint, adapters.portal_request_body(job, endpoint)


@pytest.mark.parametrize("case,expected,job,files", CASES, ids=[c[0] for c in CASES])
def test_every_endpoint_mode_matches_pinned_fal_schema(case, expected, job, files, tmp_path, monkeypatch):
    adapters = _load()
    endpoint, body = _build(adapters, monkeypatch, tmp_path, job, files)
    assert endpoint == expected
    fal_body = {k: v for k, v in body.items() if k not in _CONTROL}
    assert _errors(endpoint, fal_body) == [], fal_body


def test_matrix_covers_every_portal_endpoint():
    adapters = _load()
    wired = {e for modes in adapters.PORTAL_ENDPOINTS.values() for e in modes.values()}
    assert wired == {c[1] for c in CASES}
    pinned = {json.loads(p.read_text("utf-8"))["endpoint_id"] for p in _SCHEMAS.glob("*.json")}
    assert pinned == wired
    for path in _SCHEMAS.glob("*.json"):
        assert json.loads(path.read_text("utf-8"))["fetched_at"]


def test_g3_job1_regression(tmp_path, monkeypatch):
    """G3 job 1 (2026-10-12): Fal rejected gpt-image-2 — no prompt and
    image_size "1024x1024". The old body must fail; the new one must pass."""
    old = {"quality": "low", "image_size": "1024x1024", "num_images": 1}
    errors = _errors("openai/gpt-image-2", old)
    assert any("'prompt' is a required property" in e for e in errors)
    assert any(e.startswith("image_size") for e in errors)
    adapters = _load()
    _, body = _build(adapters, monkeypatch, tmp_path, CASES[15][2], {})
    assert body["prompt"] == "a red door"
    assert body["image_size"] == {"width": 1024, "height": 1024}
    assert body["quality"] == "low" and body["output_format"] == "png"


def test_schema_spelling_and_defaults(tmp_path, monkeypatch):
    adapters = _load()
    by_id = {c[0]: c for c in CASES}

    def body(case):
        return _build(adapters, monkeypatch, tmp_path, by_id[case][2], by_id[case][3])[1]

    h3 = body("h3 text")
    assert h3["resolution"] == "768P"  # no 720P on h3: schema default, schema case
    assert h3["prompt_expansion_mode"] == "balanced"  # schema default, stated
    assert "generate_audio" not in h3
    assert body("h3 image")["resolution"] == "768P"  # "768p" requested → schema case
    music = body("music instrumental")
    assert music["lyrics"] == "[instrumental]" and music["duration"] == 60
    assert not {"resolution", "generate_audio"} & set(music)
    speech = body("speech custom")
    assert speech["voice_setting"] == {"voice_id": "cloned-hero-1"} and "voice_id" not in speech
    assert speech["output_format"] == "url"
    assert body("speech hindi")["language_boost"] == "Hindi"
    wan = body("wan text")
    assert wan["audio"] is True and wan["duration"] == 6 and wan["aspect_ratio"] == "adaptive"
    assert "generate_audio" not in wan
    assert body("seedance-2.5 text")["duration"] == "5"
    assert "duration" not in body("seedance-2.5 editing")


def test_invalid_values_fail_before_hold(tmp_path, monkeypatch):
    adapters = _load()
    h3_720 = {**_V, "parameters": {"model": "h3-max", "resolution": "720p"}}
    with pytest.raises(adapters.AdapterFailure, match="480P, 768P, 1080P"):
        _build(adapters, monkeypatch, tmp_path, h3_720, {})
    no_lyrics = {"modality": "music", "prompt": "lofi", "outputs": ["m.mp3"], "parameters": {}}
    with pytest.raises(adapters.AdapterFailure, match="lyrics"):
        _build(adapters, monkeypatch, tmp_path, no_lyrics, {})
    preset = {"modality": "image", "prompt": "door", "outputs": ["a.png"], "parameters": {"size": "square_hd"}}
    with pytest.raises(adapters.AdapterFailure, match="width/height"):
        _build(adapters, monkeypatch, tmp_path, preset, {})


def test_pinned_schemas_match_okvevo_web_copy():
    sibling = _ROOT.parent / "OkVevo-Web" / "src" / "lib" / "fal" / "schemas"
    if not sibling.is_dir():
        pytest.skip("OkVevo-Web sibling checkout absent")
    ours = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in _SCHEMAS.glob("*.json")}
    theirs = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sibling.glob("*.json")}
    assert ours == theirs, "re-pin: copy OkVevo-Web src/lib/fal/schemas/*.json to okvevo/fal-schemas/"
