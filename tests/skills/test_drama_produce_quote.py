"""Prepare-time portal quote gate. No network, no Fal key.

A paid (portal) job cannot be confirmed without a usable quote; a confirmed
run sends the approved credits so the gateway can refuse a higher reserve.
"""

from __future__ import annotations

import json
import sys
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

PORTAL_FIXTURE = r"""
import json, os, sys
from pathlib import Path

job = json.load(sys.stdin.buffer)
log = os.environ.get("FIXTURE_LOG")
if log:
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(job) + "\n")

if job.get("quote_only") is True:
    mode = os.environ.get("FIXTURE_QUOTE", "ok")
    if mode == "signed_out":
        json.dump({"error": {"provider": str(job.get("adapter") or "portal"),
                             "category": "authentication",
                             "code": "signed_out", "retryable": False}}, sys.stdout)
        sys.exit(1)
    expires = "2000-01-01T00:00:00.000Z" if mode == "expired" else "2999-01-01T00:00:00.000Z"
    json.dump({"estimate": True, "estimated_credits": 42,
               "snapshotId": "snap-1", "expiresAt": expires}, sys.stdout)
    sys.exit(0)

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
        "job_id": "QUOTE-TEST-001",
        "modality": "video",
        "adapter": "okvevo-video",
        "prompt": "slow push in",
        "references": [],
        "outputs": ["剧集/EP001/制作成果/a.mp4"],
        "parameters": {"duration": 5, "resolution": "720p"},
        "overwrite": False,
    }
    path = project / "job.json"
    path.write_text(json.dumps(job), encoding="utf-8")
    return path


def _config(tmp_path: Path, *, portal: bool = True) -> Path:
    script = tmp_path / "fake_adapter.py"
    script.write_text(PORTAL_FIXTURE, encoding="utf-8")
    command = [sys.executable, str(script)] + (["portal"] if portal else [])
    config = tmp_path / "adapters.json"
    config.write_text(
        json.dumps({"adapters": {"okvevo-video": {"command": command, "timeout_seconds": 30}}}),
        encoding="utf-8",
    )
    return config


def _logged_payloads(tmp_path: Path) -> list[dict]:
    log = tmp_path / "payloads.jsonl"
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def test_prepare_without_quote_cannot_confirm(tmp_path, monkeypatch):
    monkeypatch.setenv("FIXTURE_QUOTE", "signed_out")
    monkeypatch.setenv("FIXTURE_LOG", str(tmp_path / "payloads.jsonl"))
    project = _project(tmp_path)
    config = _config(tmp_path)
    preview = production_tool.prepare_job(project, _write_job(project), adapter_config=config)
    assert preview["paid"] is True
    assert preview["estimated_credits"] is None
    assert preview["quote_error"] == "signed_out"
    with pytest.raises(production_tool.ConfirmationRequiredError, match="sign in"):
        production_tool.confirm_job(
            project, job_id="QUOTE-TEST-001", confirmation=preview["confirmation"]
        )


def test_expired_quote_refuses_confirm(tmp_path, monkeypatch):
    monkeypatch.setenv("FIXTURE_QUOTE", "expired")
    monkeypatch.setenv("FIXTURE_LOG", str(tmp_path / "payloads.jsonl"))
    project = _project(tmp_path)
    config = _config(tmp_path)
    preview = production_tool.prepare_job(project, _write_job(project), adapter_config=config)
    assert preview["estimated_credits"] == 42
    with pytest.raises(production_tool.ConfirmationRequiredError, match="expired"):
        production_tool.confirm_job(
            project, job_id="QUOTE-TEST-001", confirmation=preview["confirmation"]
        )


def test_confirmed_run_sends_approved_credits(tmp_path, monkeypatch):
    monkeypatch.setenv("FIXTURE_QUOTE", "ok")
    monkeypatch.setenv("FIXTURE_LOG", str(tmp_path / "payloads.jsonl"))
    project = _project(tmp_path)
    config = _config(tmp_path)
    preview = production_tool.prepare_job(project, _write_job(project), adapter_config=config)
    assert preview["estimated_credits"] == 42
    assert preview["quote_error"] is None
    production_tool.confirm_job(
        project, job_id="QUOTE-TEST-001", confirmation=preview["confirmation"]
    )
    result = production_tool.run_job(project, job_id="QUOTE-TEST-001", adapter_config=config)
    assert result["state"] == "succeeded"
    payloads = _logged_payloads(tmp_path)
    assert payloads[0].get("quote_only") is True
    assert "approved_credits" not in payloads[0]
    run_payload = payloads[-1]
    assert run_payload.get("approved_credits") == 42
    assert run_payload.get("quote_only") is not True


def test_non_portal_job_confirms_without_quote(tmp_path, monkeypatch):
    monkeypatch.setenv("FIXTURE_LOG", str(tmp_path / "payloads.jsonl"))
    project = _project(tmp_path)
    config = _config(tmp_path, portal=False)
    preview = production_tool.prepare_job(project, _write_job(project), adapter_config=config)
    assert preview["paid"] is False
    assert preview["estimated_credits"] is None
    production_tool.confirm_job(
        project, job_id="QUOTE-TEST-001", confirmation=preview["confirmation"]
    )
