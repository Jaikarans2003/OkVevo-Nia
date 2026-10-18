"""Rate-limit pause → resume with stable portal run_id (RC5+B3)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_SCRIPTS = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "creative"
    / "short-drama-produce"
    / "scripts"
)
sys.path.insert(0, str(_SCRIPTS))

import production_tool  # noqa: E402

RATE_LIMIT_FIXTURE = r"""
import json, os, sys
from pathlib import Path

job = json.load(sys.stdin.buffer)
log = os.environ.get("FIXTURE_LOG")
if log:
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(job) + "\n")

if job.get("quote_only") is True:
    credits = int(os.environ.get("FIXTURE_QUOTE_CREDITS", "42"))
    json.dump({"estimate": True, "estimated_credits": credits,
               "snapshotId": "snap-1", "expiresAt": "2999-01-01T00:00:00.000Z"}, sys.stdout)
    sys.exit(0)

mode = os.environ.get("FIXTURE_RUN", "ok")
if mode == "rate_limit":
    retry = os.environ.get("FIXTURE_RETRY_AFTER")
    err = {"provider": str(job.get("adapter") or "okvevo-video"),
           "category": "rate_limit", "code": "rate_limited",
           "retryable": True, "http_status": 429,
           "message": "slow down"}
    if retry is not None:
        err["retry_after_seconds"] = int(retry)
    json.dump({"error": err}, sys.stdout)
    sys.exit(1)

out = Path(job["output_root"]) / "output-0.mp4"
out.write_bytes(b"ftyp0000")
json.dump({"outputs": [{"target": job["outputs"][0], "source": str(out)}]}, sys.stdout)
"""


def _project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "short-drama.json").write_text("{}\n", encoding="utf-8")
    return project


def _write_job(project: Path) -> Path:
    job = {
        "job_id": "RATE-001",
        "modality": "video",
        "adapter": "okvevo-video",
        "prompt": "slow push in",
        "references": [],
        "outputs": ["剧集/EP001/制作成果/a.mp4"],
        "parameters": {"duration": 5, "resolution": "720p"},
        "overwrite": True,
    }
    path = project / "job.json"
    path.write_text(json.dumps(job), encoding="utf-8")
    return path


def _config(tmp_path: Path) -> Path:
    script = tmp_path / "fake_adapter.py"
    script.write_text(RATE_LIMIT_FIXTURE, encoding="utf-8")
    config = tmp_path / "adapters.json"
    config.write_text(
        json.dumps(
            {
                "adapters": {
                    "okvevo-video": {
                        "command": [sys.executable, str(script), "portal"],
                        "timeout_seconds": 30,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    return config


def _prepare_and_confirm(project: Path, config: Path, job_path: Path) -> dict:
    preview = production_tool.prepare_job(project, job_path, adapter_config=config)
    return production_tool.confirm_job(
        project, job_id="RATE-001", confirmation=preview["confirmation"]
    )


def _logged(tmp_path: Path) -> list[dict]:
    log = tmp_path / "payloads.jsonl"
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def test_rate_limit_pause_then_early_run_returns_paused_until(tmp_path, monkeypatch):
    monkeypatch.setenv("FIXTURE_LOG", str(tmp_path / "payloads.jsonl"))
    monkeypatch.setenv("FIXTURE_RUN", "rate_limit")
    monkeypatch.setenv("FIXTURE_RETRY_AFTER", "120")
    project = _project(tmp_path)
    config = _config(tmp_path)
    job_path = _write_job(project)
    _prepare_and_confirm(project, config, job_path)

    paused = production_tool.run_job(project, job_id="RATE-001", adapter_config=config)
    assert paused["state"] == "paused_for_rate_limit"
    assert paused["error"]["category"] == "rate_limit"
    assert paused["error"]["retry_after_seconds"] == 120
    portal_run_id = paused["portal_run_id"]
    # Empty source_entry → trailing colon (gateway form; file name is UUID only).
    assert portal_run_id == f"{paused['run_id']}:"

    early = production_tool.run_job(project, job_id="RATE-001", adapter_config=config)
    assert early["state"] == "paused_until"
    assert early["paused_until"] == paused["paused_until"]
    # Adapter must not be called again while paused.
    runs = [p for p in _logged(tmp_path) if not p.get("quote_only")]
    assert len(runs) == 1


def test_resume_reuses_same_portal_run_id(tmp_path, monkeypatch):
    monkeypatch.setenv("FIXTURE_LOG", str(tmp_path / "payloads.jsonl"))
    monkeypatch.setenv("FIXTURE_RUN", "rate_limit")
    monkeypatch.setenv("FIXTURE_RETRY_AFTER", "0")
    project = _project(tmp_path)
    config = _config(tmp_path)
    job_path = _write_job(project)
    _prepare_and_confirm(project, config, job_path)

    first = production_tool.run_job(project, job_id="RATE-001", adapter_config=config)
    assert first["state"] == "paused_for_rate_limit"
    portal_run_id = first["portal_run_id"]

    # Force next_attempt_at into the past.
    pause_path = (
        project
        / ".short-drama"
        / "production"
        / "pauses"
        / production_tool._job_key("RATE-001")
        / f"{first['run_id']}.json"
    )
    pause = json.loads(pause_path.read_text(encoding="utf-8"))
    past = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat().replace(
        "+00:00", "Z"
    )
    pause["next_attempt_at"] = past
    pause_path.write_text(json.dumps(pause), encoding="utf-8")

    second = production_tool.run_job(project, job_id="RATE-001", adapter_config=config)
    assert second["state"] == "paused_for_rate_limit"
    assert second["portal_run_id"] == portal_run_id
    assert second["run_id"] == first["run_id"]
    runs = [p for p in _logged(tmp_path) if not p.get("quote_only")]
    assert len(runs) == 2
    assert runs[0]["run_id"] == portal_run_id
    assert runs[1]["run_id"] == portal_run_id


def test_success_then_new_confirm_gets_new_run_id(tmp_path, monkeypatch):
    monkeypatch.setenv("FIXTURE_LOG", str(tmp_path / "payloads.jsonl"))
    monkeypatch.setenv("FIXTURE_RUN", "ok")
    project = _project(tmp_path)
    config = _config(tmp_path)
    job_path = _write_job(project)
    _prepare_and_confirm(project, config, job_path)
    first = production_tool.run_job(project, job_id="RATE-001", adapter_config=config)
    assert first["state"] == "succeeded"
    first_portal = first["portal_run_id"]

    # New prepare+confirm after success → new UUID (not deduped to old result).
    preview = production_tool.prepare_job(project, job_path, adapter_config=config)
    production_tool.confirm_job(
        project, job_id="RATE-001", confirmation=preview["confirmation"]
    )
    second = production_tool.run_job(project, job_id="RATE-001", adapter_config=config)
    assert second["state"] == "succeeded"
    assert second["portal_run_id"] != first_portal
    assert second["run_id"] != first["run_id"]


def test_parse_public_error_keeps_message_and_retry_after():
    raw = json.dumps(
        {
            "error": {
                "provider": "okvevo-video",
                "category": "rate_limit",
                "code": "rate_limited",
                "retryable": True,
                "http_status": 429,
                "message": "slow down",
                "retry_after_seconds": 30,
            }
        }
    ).encode("utf-8")
    parsed = production_tool._parse_public_adapter_error(
        raw, profile="okvevo-video", returncode=1
    )
    assert parsed["category"] == "rate_limit"
    assert parsed["message"] == "slow down"
    assert parsed["retry_after_seconds"] == 30


def test_backoff_respects_retry_after_floor(monkeypatch):
    monkeypatch.setattr(production_tool.random, "uniform", lambda a, b: 1.0)
    delay = production_tool._rate_limit_backoff_seconds(0, 90.0)
    assert delay == 90.0
    delay2 = production_tool._rate_limit_backoff_seconds(0, None)
    assert delay2 == 1.0
