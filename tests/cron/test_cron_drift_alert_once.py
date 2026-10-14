"""Legacy snapshot records follow the main model. They are not skipped.

A stored provider_snapshot used to fail the tick closed. Unpinned jobs now
run on the current model, and a non-drift failure still alerts every tick.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import cron.jobs as cron_jobs
import cron.scheduler as sched


def _job(**overrides):
    job = {
        "id": "drift-once-test",
        "name": "drift once test",
        "prompt": "hello",
        "enabled": True,
        "state": "scheduled",
        "schedule": {"kind": "interval", "minutes": 5, "display": "every 5m"},
        "deliver": "local",
        "model": None,
        "provider": None,
        "provider_snapshot": "openrouter",
        "base_url": None,
    }
    job.update(overrides)
    return job


def _tick(job, tmp_path, current_provider, deliveries):
    """Run one run_one_job tick with the provider resolution pinned."""
    fake_db = MagicMock()

    def fake_deliver(job, content, adapters=None, loop=None):
        deliveries.append(content)
        return None

    with patch("cron.scheduler._hermes_home", tmp_path), \
         patch("cron.scheduler._resolve_origin", return_value=None), \
         patch("hermes_cli.env_loader.load_hermes_dotenv"), \
         patch("hermes_cli.env_loader.reset_secret_source_cache"), \
         patch("hermes_state.SessionDB", return_value=fake_db), \
         patch("tools.mcp_tool.discover_mcp_tools", return_value=[]), \
         patch("hermes_cli.runtime_provider.resolve_runtime_provider",
               return_value={
                   "api_key": "test-key",
                   "base_url": "https://example.invalid/v1",
                   "provider": current_provider,
                   "api_mode": "chat_completions",
               }), \
         patch.object(sched, "_deliver_result", side_effect=fake_deliver), \
         patch("run_agent.AIAgent") as mock_agent_cls:
        mock_agent = MagicMock()
        mock_agent.run_conversation.return_value = {"final_response": "ok"}
        mock_agent_cls.return_value = mock_agent
        ok = sched.run_one_job(job)
    return ok, mock_agent_cls.called


class TestLegacySnapshotFollowsMainModel:
    def test_snapshot_mismatch_still_runs(self, tmp_path, monkeypatch):
        monkeypatch.delenv("HERMES_MODEL", raising=False)
        (tmp_path / "config.yaml").write_text("model:\n  default: live-model\n")
        job = _job(provider_snapshot="old-provider", model_snapshot="old-model")
        deliveries = []
        with cron_jobs.use_cron_store(tmp_path):
            cron_jobs.save_jobs([job])
            fresh = [j for j in cron_jobs.load_jobs() if j["id"] == job["id"]][0]
            ok, agent_called = _tick(fresh, tmp_path, "new-provider", deliveries)
        assert agent_called is True
        assert ok is True
        assert not any("drift" in d.lower() for d in deliveries)

    def test_non_drift_failures_untouched_by_the_bit(self, tmp_path):
        """A job with the drift bit set whose run fails for another reason
        still alerts — only the drift branch consults the bit."""
        job = _job(provider_snapshot=None, drift_alerted=True)
        deliveries = []

        def fake_deliver(jb, content, adapters=None, loop=None):
            deliveries.append(content)
            return None

        fake_db = MagicMock()
        with cron_jobs.use_cron_store(tmp_path):
            cron_jobs.save_jobs([job])
            fresh = [j for j in cron_jobs.load_jobs() if j["id"] == job["id"]][0]
            with patch("cron.scheduler._hermes_home", tmp_path), \
                 patch("cron.scheduler._resolve_origin", return_value=None), \
                 patch("hermes_cli.env_loader.load_hermes_dotenv"), \
                 patch("hermes_cli.env_loader.reset_secret_source_cache"), \
                 patch("hermes_state.SessionDB", return_value=fake_db), \
                 patch("tools.mcp_tool.discover_mcp_tools", return_value=[]), \
                 patch("hermes_cli.runtime_provider.resolve_runtime_provider",
                       return_value={
                           "api_key": "test-key",
                           "base_url": "https://example.invalid/v1",
                           "provider": "openrouter",
                           "api_mode": "chat_completions",
                       }), \
                 patch.object(sched, "_deliver_result", side_effect=fake_deliver), \
                 patch("run_agent.AIAgent") as mock_agent_cls:
                mock_agent = MagicMock()
                mock_agent.run_conversation.side_effect = RuntimeError("boom unrelated")
                mock_agent_cls.return_value = mock_agent
                sched.run_one_job(fresh)

        assert len(deliveries) == 1, "non-drift failure must still deliver"
        assert "boom unrelated" in deliveries[0]
