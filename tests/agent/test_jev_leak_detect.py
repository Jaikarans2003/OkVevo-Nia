"""Mocked Jev leak-detect tests. Live bench: python tests/agent/test_jev_leak_detect.py --live"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

import httpx
import pytest

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from agent.brand_scrub import sanitize_user_facing_brand
from tools.openrouter_decisions import (
    LEAK_DETECT_QUESTIONS,
    classify_leak,
    post_decisions,
)

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jev_leak_corpus.json"
_HELPER = _ROOT / "tools" / "openrouter_decisions.py"
_LOCAL_SESSION_IDS = (
    "20260914_020719_aee028",
    "20260914_022423_b9eff6",
)

_CHOICE_NOUL_PAYLOAD = {
    "answers": {
        "is_leak": {
            "type": "choice",
            "choice": "leak",
            "confidence": 0.82,
            "probabilities": {"leak": 0.82, "clean": 0.18},
        },
        "hermes_brand": {"type": "noul", "noul": 0.91},
        "internal_mechanism": {"type": "noul", "noul": 0.40},
        "tooling_or_paths": {"type": "noul", "noul": 0.12},
    },
    "usage": {"cost": 0.00002, "input_tokens": 100, "output_tokens": 10},
    "model": "typesafe/jev-1.13",
}


def _corpus_rows() -> list[dict[str, Any]]:
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return list(data["rows"])


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any = None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def test_corpus_regex_labels_match_scrub():
    for row in _corpus_rows():
        hit = sanitize_user_facing_brand(row["text"]) != row["text"]
        assert hit is row["expect_regex_hit"], row["id"]


def test_helper_skips_gateway_and_async_client():
    src = _HELPER.read_text(encoding="utf-8")
    assert "apply_okvevo_gateway" not in src
    assert "get_async_client" not in src


def test_parses_choice_and_noul(monkeypatch):
    monkeypatch.setattr(
        "tools.openrouter_decisions._openrouter_api_key", lambda: "sk-test"
    )
    monkeypatch.setattr(
        "tools.openrouter_decisions.httpx.post",
        lambda *a, **k: _FakeResponse(200, _CHOICE_NOUL_PAYLOAD),
    )
    out = post_decisions({"assistant": "x"}, LEAK_DETECT_QUESTIONS)
    assert out is not None
    leak = out["answers"]["is_leak"]
    assert leak["choice"] == "leak"
    assert leak["confidence"] == 0.82
    assert out["answers"]["hermes_brand"]["noul"] == 0.91
    assert "noul" in out["answers"]["internal_mechanism"]
    assert "noul" in out["answers"]["tooling_or_paths"]


def test_fail_open_timeout(monkeypatch):
    monkeypatch.setattr(
        "tools.openrouter_decisions._openrouter_api_key", lambda: "sk-test"
    )

    def _boom(*_a, **_k):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr("tools.openrouter_decisions.httpx.post", _boom)
    assert post_decisions({"assistant": "x"}, LEAK_DETECT_QUESTIONS) is None
    assert classify_leak("x") is None


def test_fail_open_5xx(monkeypatch):
    calls = {"n": 0}

    def _post(*_a, **_k):
        calls["n"] += 1
        return _FakeResponse(503)

    monkeypatch.setattr(
        "tools.openrouter_decisions._openrouter_api_key", lambda: "sk-test"
    )
    monkeypatch.setattr("tools.openrouter_decisions.httpx.post", _post)
    assert post_decisions({"assistant": "x"}, LEAK_DETECT_QUESTIONS) is None
    assert calls["n"] == 1


def test_fail_open_no_key(monkeypatch):
    monkeypatch.setattr("tools.openrouter_decisions._openrouter_api_key", lambda: None)

    def _post(*_a, **_k):
        raise AssertionError("must not POST without a key")

    monkeypatch.setattr("tools.openrouter_decisions.httpx.post", _post)
    assert post_decisions({"assistant": "x"}, LEAK_DETECT_QUESTIONS) is None


def test_fail_open_malformed_json(monkeypatch):
    monkeypatch.setattr(
        "tools.openrouter_decisions._openrouter_api_key", lambda: "sk-test"
    )
    monkeypatch.setattr(
        "tools.openrouter_decisions.httpx.post",
        lambda *a, **k: _FakeResponse(200, None),
    )
    assert post_decisions({"assistant": "x"}, LEAK_DETECT_QUESTIONS) is None


def _percentile(values: list[float], p: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * (p / 100.0)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    frac = rank - low
    return ordered[low] + (ordered[high] - ordered[low]) * frac


def _optional_local_positives() -> list[dict[str, Any]]:
    db_path = Path.home() / ".hermes" / "state.db"
    if not db_path.is_file():
        return []
    try:
        import sqlite3

        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        rows: list[dict[str, Any]] = []
        try:
            for session_id in _LOCAL_SESSION_IDS:
                cur = conn.execute(
                    "SELECT content FROM messages "
                    "WHERE session_id = ? AND role = 'assistant' "
                    "AND content IS NOT NULL AND content != '' "
                    "ORDER BY id LIMIT 3",
                    (session_id,),
                )
                for i, (content,) in enumerate(cur.fetchall()):
                    if not isinstance(content, str) or not content.strip():
                        continue
                    rows.append(
                        {
                            "id": f"local_{session_id}_{i}",
                            "text": content,
                            "expect_regex_hit": None,
                            "expect_semantic_leak": True,
                        }
                    )
        finally:
            conn.close()
        return rows
    except Exception:
        return []


def run_live_bench() -> int:
    try:
        from hermes_cli.env_loader import load_hermes_dotenv

        load_hermes_dotenv()
    except Exception:
        pass
    from tools.openrouter_decisions import _openrouter_api_key

    if not _openrouter_api_key():
        print("SKIP live bench: OPENROUTER_API_KEY absent")
        return 0

    rows = _corpus_rows()
    extra = _optional_local_positives()
    if extra:
        print(f"local state.db extras: {len(extra)} (not committed)")
    else:
        print("local state.db extras: skipped (missing)")

    results: list[dict[str, Any]] = []
    latencies: list[float] = []
    costs: list[float] = []
    input_tokens = 0
    output_tokens = 0

    for row in rows + extra:
        regex_hit = sanitize_user_facing_brand(row["text"]) != row["text"]
        t0 = time.perf_counter()
        jev = classify_leak(row["text"])
        latency_ms = (time.perf_counter() - t0) * 1000.0
        latencies.append(latency_ms)
        usage = (jev or {}).get("usage") or {}
        if isinstance(usage.get("cost"), (int, float)):
            costs.append(float(usage["cost"]))
        if isinstance(usage.get("input_tokens"), int):
            input_tokens += usage["input_tokens"]
        if isinstance(usage.get("output_tokens"), int):
            output_tokens += usage["output_tokens"]
        answers = (jev or {}).get("answers") or {}
        leak = answers.get("is_leak") or {}
        results.append(
            {
                "id": row["id"],
                "regex_hit": regex_hit,
                "expect_regex_hit": row.get("expect_regex_hit"),
                "expect_semantic_leak": row.get("expect_semantic_leak"),
                "jev_choice": leak.get("choice"),
                "jev_confidence": leak.get("confidence"),
                "hermes_brand": (answers.get("hermes_brand") or {}).get("noul"),
                "internal_mechanism": (answers.get("internal_mechanism") or {}).get(
                    "noul"
                ),
                "tooling_or_paths": (answers.get("tooling_or_paths") or {}).get("noul"),
                "latency_ms": round(latency_ms, 1),
                "cost": usage.get("cost"),
                "input_tokens": usage.get("input_tokens"),
                "ok": jev is not None,
            }
        )

    corpus_ids = {r["id"] for r in rows}
    corpus_results = [r for r in results if r["id"] in corpus_ids]

    regex_only = [
        r
        for r in corpus_results
        if r["regex_hit"] and r["jev_choice"] != "leak"
    ]
    jev_only = [
        r
        for r in corpus_results
        if (not r["regex_hit"]) and r["jev_choice"] == "leak"
    ]
    both_agree = [
        r
        for r in corpus_results
        if (r["regex_hit"] and r["jev_choice"] == "leak")
        or ((not r["regex_hit"]) and r["jev_choice"] == "clean")
    ]
    jev_fp = [
        r
        for r in corpus_results
        if r["expect_semantic_leak"] is False and r["jev_choice"] == "leak"
    ]

    print("\n| id | regex | jev | conf | brand | mech | tools | ms |")
    print("|---|---|---|---|---|---|---|---|")
    for r in results:
        print(
            f"| {r['id']} | {r['regex_hit']} | {r['jev_choice']} | "
            f"{r['jev_confidence']} | {r['hermes_brand']} | "
            f"{r['internal_mechanism']} | {r['tooling_or_paths']} | {r['latency_ms']} |"
        )

    print("\nRegex-only hits Jev missed:")
    print(", ".join(r["id"] for r in regex_only) or "(none)")
    print("Jev hits regex missed:")
    print(", ".join(r["id"] for r in jev_only) or "(none)")
    print("Both agree:")
    print(", ".join(r["id"] for r in both_agree) or "(none)")
    print("Jev false positives on negatives:")
    print(", ".join(r["id"] for r in jev_fp) or "(none)")
    print(
        f"p50_ms={_percentile(latencies, 50):.1f} "
        f"p95_ms={_percentile(latencies, 95):.1f} "
        f"input_tokens={input_tokens} output_tokens={output_tokens} "
        f"cost_sum={sum(costs):.8f}"
    )
    return 0


if __name__ == "__main__":
    if "--live" not in sys.argv:
        raise SystemExit("usage: python tests/agent/test_jev_leak_detect.py --live")
    raise SystemExit(run_live_bench())
