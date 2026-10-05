"""Subagent process handoff onto Nia's task_id ownership."""

import time
import weakref

from tools.delegate_tool import _active_subagents, _active_subagents_lock
from tools.process_registry import (
    ProcessSession,
    _handoff_process,
    format_process_notification,
    process_registry,
)


class _Parent:
    _current_task_id = "parent-task"
    session_id = "parent-session"


def _park(session: ProcessSession) -> None:
    with process_registry._lock:
        process_registry._running[session.id] = session


def _unpark(session_id: str, subagent_id: str) -> None:
    with process_registry._lock:
        process_registry._running.pop(session_id, None)
        process_registry._finished.pop(session_id, None)
    with _active_subagents_lock:
        _active_subagents.pop(subagent_id, None)


def test_handoff_moves_an_sa_process_to_the_parent():
    parent = _Parent()
    child = type("Child", (), {})()
    child._delegate_parent_ref = weakref.ref(parent)
    session = ProcessSession(
        id="proc_handoff_test",
        command="sleep 30",
        task_id="sa-child",
        session_key="child-key",
        started_at=time.time(),
        notify_on_complete=False,
    )
    _park(session)
    with _active_subagents_lock:
        _active_subagents["sa-child"] = {"agent": child, "subagent_id": "sa-child"}
    try:
        assert "error" in _handoff_process("proc_nope", {"data": "watch CI"}, "not-a-child")
        assert "error" in _handoff_process(session.id, {}, "sa-child")
        assert session.task_id == "sa-child"

        child._handed_off_processes = [{}, {}, {}]
        capped = _handoff_process(session.id, {"data": "watch CI"}, "sa-child")
        assert "cap" in capped["error"]
        assert session.task_id == "sa-child"

        child._handed_off_processes = []
        moved = _handoff_process(session.id, {"data": "watch CI"}, "sa-child")
        assert moved["status"] == "handed_off"
        assert session.task_id == "parent-task"
        assert session.session_key == "parent-session"
        assert session.handoff_note == "watch CI"
        assert session.notify_on_complete is True
        assert process_registry.running_owned_by("sa-child") == []
        assert process_registry.running_owned_by("parent-task") == [session]
    finally:
        _unpark(session.id, "sa-child")


def test_completion_notice_names_the_handoff():
    text = format_process_notification(
        {
            "type": "completion",
            "session_id": "proc_x",
            "command": "sleep 1",
            "task_id": "parent-task",
            "exit_code": 0,
            "handoff_note": "watch CI",
            "output": "",
        }
    )
    assert text is not None
    assert "Handoff: watch CI" in text
    assert text.endswith("]")
