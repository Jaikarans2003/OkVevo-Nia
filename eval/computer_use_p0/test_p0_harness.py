"""Self-check for P0 harness: TEST_CONTACT refuse, redact, CSV. No live Nia."""

from __future__ import annotations

import tempfile
from pathlib import Path

import config_load
import report
import tasks


def test_refuse_without_contact(tmp_path, monkeypatch):
    monkeypatch.setattr(config_load, "LOCAL", tmp_path / "missing.json")
    monkeypatch.setattr(config_load, "EXAMPLE", tmp_path / "ex.json")
    (tmp_path / "ex.json").write_text("{}", encoding="utf-8")
    cfg = config_load.load_config()
    try:
        config_load.require_test_contact(cfg)
        raise AssertionError("should refuse")
    except SystemExit as exc:
        assert "TEST_CONTACT" in str(exc)


def test_redact_contact():
    assert config_load.redact("hi Yuktha there", "Yuktha") == "hi ***CONTACT*** there"


def test_d7_whatsapp_uses_contact_only():
    ts = tasks.d7_tasks("AliceTest", "m1")
    wa = [t for t in ts if t["needs_contact"]]
    assert wa
    for t in wa:
        assert "AliceTest" in t["prompt"]
        assert "Yuktha" not in t["prompt"] or "AliceTest" == "Yuktha"


def test_csv_and_summary(tmp_path, monkeypatch):
    monkeypatch.setattr(report, "REPORTS", tmp_path)
    p = tmp_path / "p0_mac_2099-01-01.csv"
    report.append_row(
        p,
        {
            "suite": "d7",
            "task_id": "d7_sn_05_math",
            "rep": 1,
            "os": "mac",
            "prompt": "What's 18% of 2,450?",
            "first_tool": "terminal",
            "expect_first": "not_computer_use",
            "routed_model": "okvevo/auto-cost",
            "wall_s": 2.5,
            "llm_turns": 1,
            "tokens": 100,
            "credits": "",
            "checker_ok": "",
            "checker_reason": "d7_first_tool_only",
            "status": "interrupted",
        },
    )
    rows = report.load_rows(p)
    assert rows[0]["first_tool"] == "terminal"
    sm = tmp_path / "sum.md"
    report.write_summary(
        sm,
        os_name="mac",
        versions={"cua": "0.28.2"},
        dump_path="dumps/x.json",
        rows=rows,
        entry="entry",
    )
    text = sm.read_text(encoding="utf-8")
    assert "d7_sn_05_math" in text
    assert "0.28.2" in text


def test_live_agent_checkout_path():
    import live_agent

    assert live_agent.CHECKOUT.name == "hermes-agent"
    assert live_agent.CHECKOUT != live_agent.ACTIVE


def test_cua_unwrap_keeps_windows():
    from dump import _unwrap_cua, _window_list

    nested = {"result": {"windows": [{"title": "Notes", "pid": 1, "window_id": 2}]}}
    got = _unwrap_cua(nested)
    assert _window_list(got)[0]["title"] == "Notes"


def test_d7_scores_first_action_not_skill_lookup():
    from client import NEUTRAL_TOOLS, first_named_tool

    events = [
        {"type": "tool.start", "payload": {"name": "skill_view"}},
        {"type": "tool.complete", "payload": {"name": "skills_list"}},
        {
            "type": "tool.start",
            "payload": {"name": "computer_use", "args": {"action": "capture"}},
        },
    ]
    assert first_named_tool(events, neutral=NEUTRAL_TOOLS) == "computer_use"
    assert first_named_tool(events[:2], neutral=NEUTRAL_TOOLS) == ""


def test_routed_model_is_response_not_alias():
    from client import credits_from_usage, observed_models

    events = [
        {
            "type": "session.usage",
            "payload": {"usage": {"model": "okvevo/auto-cost", "calls": 1, "total": 100}},
        },
        {
            "type": "message.complete",
            "payload": {
                "usage": {"model": "okvevo/auto-cost"},
                "response_model": "anthropic/claude-haiku-4.5",
            },
        },
        {
            "type": "message.complete",
            "payload": {"response_model": "openai/gpt-5.4-mini"},
        },
    ]
    assert observed_models(events) == [
        "anthropic/claude-haiku-4.5",
        "openai/gpt-5.4-mini",
    ]
    assert credits_from_usage({"credits": 4}) == "4"
    assert credits_from_usage({"dev_credits_spent_micros": 2_500_000}) == "2.5"
    assert credits_from_usage({"model": "okvevo/auto-cost"}) == ""


def test_screenshot_and_budget():
    from client import budget_exceeded, screenshot_count

    events = [
        {
            "type": "tool.start",
            "payload": {
                "name": "computer_use",
                "tool_id": "a",
                "args": {"action": "capture"},
            },
        },
        {
            "type": "tool.complete",
            "payload": {
                "name": "computer_use",
                "tool_id": "a",
                "args": {"action": "capture"},
            },
        },
        {
            "type": "tool.complete",
            "payload": {
                "name": "computer_use",
                "tool_id": "b",
                "args": {"action": "click", "capture_after": True},
            },
        },
    ]
    assert screenshot_count(events) == 2
    assert budget_exceeded({"calls": 12, "total": 10}, 12, 150000)
    assert budget_exceeded({"calls": 1, "total": 150000}, 12, 150000)
    assert not budget_exceeded({"calls": 1, "total": 100}, 12, 150000)
    assert not budget_exceeded({"calls": 0, "total": 0}, 12, 150000)


def test_ledger_window_and_balance():
    import base64
    import json
    from datetime import datetime, timezone

    from ledger import (
        balance_spent,
        claims_from_token,
        parse_transactions,
        summarize_debits,
        window_debits,
    )

    start = datetime(2026, 9, 24, 1, 0, tzinfo=timezone.utc)
    payload = {
        "documents": [
            {
                "fields": {
                    "type": {"stringValue": "debit"},
                    "amount": {"integerValue": "3"},
                    "model": {"stringValue": "openai/gpt-5.4-mini"},
                    "createdAt": {"timestampValue": "2026-09-24T01:00:02Z"},
                }
            },
            {
                "fields": {
                    "type": {"stringValue": "debit"},
                    "amount": {"integerValue": "5"},
                    "model": {"stringValue": "anthropic/claude-haiku-4.5"},
                    "createdAt": {"timestampValue": "2026-09-24T01:00:08Z"},
                }
            },
            {
                "fields": {
                    "type": {"stringValue": "debit"},
                    "amount": {"integerValue": "99"},
                    "model": {"stringValue": "okvevo/auto-cost"},
                    "createdAt": {"timestampValue": "2026-09-23T01:00:05Z"},
                }
            },
        ]
    }
    credits, models = summarize_debits(window_debits(parse_transactions(payload), start))
    assert credits == "8"
    assert models == ["openai/gpt-5.4-mini", "anthropic/claude-haiku-4.5"]
    assert (
        balance_spent(
            {"allocationBalance": 100, "topUpBalance": 5},
            {"allocationBalance": 90, "topUpBalance": 5},
        )
        == 10
    )
    body = base64.urlsafe_b64encode(
        json.dumps({"aud": "proj", "user_id": "uid1"}).encode()
    ).decode().rstrip("=")
    assert claims_from_token(f"h.{body}.sig") == ("proj", "uid1")
    assert claims_from_token("not-a-token") == ("", "")


def test_bakeoff_requires_pinned_models():
    got = tasks.bakeoff_model_list(
        {
            "bakeoff_models": [
                "anthropic/claude-haiku-4.5",
                "openai/gpt-5.4-mini",
                "okvevo/auto-cost",
            ]
        }
    )
    assert got == ["anthropic/claude-haiku-4.5", "openai/gpt-5.4-mini"]
    try:
        tasks.bakeoff_model_list({"bakeoff_models": ["okvevo/auto-cost"]})
        raise AssertionError("should refuse")
    except SystemExit as exc:
        assert "pinned" in str(exc)


def test_append_refuses_old_header(tmp_path, monkeypatch):
    del monkeypatch
    old = tmp_path / "p0_mac_2099-01-02.csv"
    old.write_text("suite,task_id\n", encoding="utf-8")
    try:
        report.append_row(old, {"suite": "d7", "task_id": "x"})
        raise AssertionError("should refuse")
    except SystemExit as exc:
        assert "older column layout" in str(exc)


def test_auto_session_sends_openrouter_provider():
    from run_p0 import session_create_params
    from tasks import AUTO_MODEL

    assert AUTO_MODEL == "okvevo/auto-cost"
    auto = session_create_params(AUTO_MODEL)
    assert auto["model"] == "okvevo/auto-cost"
    assert auto["provider"] == "openrouter"
    bake = session_create_params("anthropic/claude-sonnet-5")
    assert bake["provider"] == "openrouter"


if __name__ == "__main__":
    import traceback

    fails = 0

    class Dummy:
        def __init__(self):
            self.items = {}

        def setattr(self, obj, name, val):
            self.items[(obj, name)] = getattr(obj, name)
            setattr(obj, name, val)

        def undo(self):
            for (obj, name), val in self.items.items():
                setattr(obj, name, val)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        monkey = Dummy()
        for fn in (
            test_refuse_without_contact,
            test_csv_and_summary,
            test_append_refuses_old_header,
        ):
            try:
                fn(tmp, monkey)
                monkey.undo()
                print("ok", fn.__name__)
            except Exception:
                fails += 1
                traceback.print_exc()
                monkey.undo()
        try:
            test_redact_contact()
            test_d7_whatsapp_uses_contact_only()
            test_cua_unwrap_keeps_windows()
            test_live_agent_checkout_path()
            test_auto_session_sends_openrouter_provider()
            test_d7_scores_first_action_not_skill_lookup()
            test_routed_model_is_response_not_alias()
            test_screenshot_and_budget()
            test_ledger_window_and_balance()
            test_bakeoff_requires_pinned_models()
            print("ok test_redact_contact")
            print("ok test_d7_whatsapp_uses_contact_only")
            print("ok test_cua_unwrap_keeps_windows")
            print("ok test_live_agent_checkout_path")
            print("ok test_auto_session_sends_openrouter_provider")
            print("ok test_d7_scores_first_action_not_skill_lookup")
            print("ok test_routed_model_is_response_not_alias")
            print("ok test_screenshot_and_budget")
            print("ok test_ledger_window_and_balance")
            print("ok test_bakeoff_requires_pinned_models")
        except Exception:
            fails += 1
            traceback.print_exc()
    raise SystemExit(fails)

