"""Replay rebuild must keep the durable-row stamp (#123462).

Nia has no ``agent.session_persistence._db_flush_collect``. The stamp is what
that flush uses to avoid writing the same transcript twice; this pins the
gateway rebuild that was dropping it.
"""

from gateway.run import _build_gateway_agent_history


def test_build_gateway_agent_history_preserves_db_persisted_marker():
    stored = [
        {"role": "user", "content": "first", "_db_persisted": True, "timestamp": 1.0},
        {"role": "assistant", "content": "reply", "_db_persisted": True},
    ]
    history, _ = _build_gateway_agent_history(stored)

    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[0].get("_db_persisted") is True
    assert history[1]["role"] == "assistant"
    assert history[1].get("_db_persisted") is True
