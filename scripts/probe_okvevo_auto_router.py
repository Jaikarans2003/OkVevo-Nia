#!/usr/bin/env python3
"""Phase B: live OpenRouter Auto Router (auto-beta) probes for OkVevo Auto.

Uses Nia's real ``TERMINAL_SCHEMA`` (not a toy function). For each mode
(Intelligence / Cost Effective):

1. Probe each ``allowed_models`` id alone with forced ``terminal`` tool-call
   (drop 404 / tools-refused).
2. Run several ``openrouter/auto-beta`` turns with ``auto-beta-router`` +
   ``cost_tier`` + the surviving allow-list; require ``response.model`` on the
   shortlist and a real ``tool_calls`` entry.

Writes a JSON report next to this script and prints a markdown table.

Requires OPENROUTER_API_KEY (env or ``~/.hermes/.env`` via load_hermes_dotenv).

Run:
  python scripts/probe_okvevo_auto_router.py
  pytest -m integration tests/providers/test_okvevo_auto_router_probe.py -q
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions"
AUTO_MODEL = "openrouter/auto-beta"
PLUGIN_ID = "auto-beta-router"
AUTO_TURNS = 5
PER_MODEL_TIMEOUT_S = 90
AUTO_TIMEOUT_S = 120

# Starting sets from plan (SoT ∩ proposed). Excludes ids not on OPENROUTER_MODELS
# (claude-fable-5.1, gpt-6-astra, …). Probes may drop more.
INTELLIGENCE_START: list[str] = [
    "anthropic/claude-fable-5",
    "anthropic/claude-opus-5",
    "anthropic/claude-opus-4.8",
    "anthropic/claude-sonnet-5",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-sol-pro",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-terra-pro",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-luna-pro",
    "google/gemini-3.1-pro-preview",
    "x-ai/grok-4.6",
    "moonshotai/kimi-k3",
    "qwen/qwen3.8-max",
    "z-ai/glm-5.3",
    "deepseek/deepseek-v4-pro",
]

COST_START: list[str] = [
    "anthropic/claude-haiku-4.5",
    "openai/gpt-5.4-mini",
    "google/gemini-3.7-flash",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3.8-flash",
    "z-ai/glm-5.3-flash",
    "stepfun/step-3.7-flash",
    "minimax/minimax-m3",
    "tencent/hy4-preview",
]

TOOL_PROMPT = (
    "You must call the terminal tool exactly once. "
    "Use command='echo okvevo-auto-probe' and intent='Probe that tools work'. "
    "Do not answer in plain text before the tool call."
)


def _read_key_from_env_file(path: Path) -> str:
    """Read OPENROUTER_API_KEY from a dotenv file without printing it."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if not line.startswith("OPENROUTER_API_KEY="):
            continue
        value = line.split("=", 1)[1].strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        return value.strip()
    return ""


def _load_api_key() -> str:
    try:
        from hermes_cli.env_loader import load_hermes_dotenv

        load_hermes_dotenv()
    except Exception:
        pass
    try:
        from tools.openrouter_decisions import _openrouter_api_key

        key = (_openrouter_api_key() or "").strip()
        if key:
            return key
    except Exception:
        pass
    env = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if env:
        return env
    # Local Nia workspace: gateway key often lives in OkVevo-Web/.env while
    # ~/.hermes/.env is empty. Probe-only fallback — never prints the value.
    for path in (
        Path.home() / ".hermes" / ".env",
        _ROOT / ".env",
        _ROOT.parent / "OkVevo-Web" / ".env",
    ):
        key = _read_key_from_env_file(path)
        if key:
            os.environ["OPENROUTER_API_KEY"] = key
            return key
    return ""


def _terminal_tool_openai() -> dict[str, Any]:
    """OpenAI tools[] entry from Nia's real TERMINAL_SCHEMA."""
    from tools.terminal_tool import TERMINAL_SCHEMA

    return {
        "type": "function",
        "function": {
            "name": TERMINAL_SCHEMA["name"],
            "description": TERMINAL_SCHEMA["description"],
            "parameters": TERMINAL_SCHEMA["parameters"],
        },
    }


def _post_chat(api_key: str, body: dict[str, Any], timeout_s: float) -> dict[str, Any]:
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_CHAT,
        data=raw,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://www.okvevo.com",
            "X-Title": "Nia OkVevo Auto probe",
        },
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as res:
            payload = json.loads(res.read().decode("utf-8"))
            return {
                "ok": True,
                "status": res.status,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "body": payload,
                "error": None,
            }
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", errors="replace")
        try:
            err_body: Any = json.loads(text)
        except json.JSONDecodeError:
            err_body = text
        return {
            "ok": False,
            "status": err.code,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "body": err_body,
            "error": f"HTTP {err.code}",
        }
    except Exception as err:  # noqa: BLE001 — probe must keep going
        return {
            "ok": False,
            "status": None,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "body": None,
            "error": f"{type(err).__name__}: {err}",
        }


def _message_tool_calls(body: dict[str, Any] | None) -> list[Any]:
    if not isinstance(body, dict):
        return []
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return []
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        return []
    calls = msg.get("tool_calls")
    return calls if isinstance(calls, list) else []


def _response_model(body: dict[str, Any] | None) -> str | None:
    if not isinstance(body, dict):
        return None
    model = body.get("model")
    return model if isinstance(model, str) and model else None


def _has_terminal_tool_call(calls: list[Any]) -> bool:
    for call in calls:
        if not isinstance(call, dict):
            continue
        fn = call.get("function")
        if isinstance(fn, dict) and fn.get("name") == "terminal":
            return True
        if call.get("name") == "terminal":
            return True
    return False


def probe_model_tools(api_key: str, model: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
    result = _post_chat(
        api_key,
        {
            "model": model,
            "messages": [{"role": "user", "content": TOOL_PROMPT}],
            "tools": tools,
            "tool_choice": {"type": "function", "function": {"name": "terminal"}},
            "max_tokens": 256,
        },
        PER_MODEL_TIMEOUT_S,
    )
    calls = _message_tool_calls(result.get("body") if result["ok"] else None)
    status = result.get("status")
    drop_reason: str | None = None
    if not result["ok"]:
        if status == 404:
            drop_reason = "404"
        elif status in (400, 402, 403, 422):
            drop_reason = f"http_{status}"
        else:
            drop_reason = result.get("error") or "request_failed"
    elif not _has_terminal_tool_call(calls):
        drop_reason = "no_terminal_tool_call"
    return {
        "model": model,
        "ok": drop_reason is None,
        "drop_reason": drop_reason,
        "status": status,
        "latency_ms": result["latency_ms"],
        "response_model": _response_model(result.get("body") if result["ok"] else None),
        "tool_calls": bool(calls),
        "terminal_tool_call": _has_terminal_tool_call(calls),
    }


def probe_auto_turn(
    api_key: str,
    *,
    cost_tier: str,
    allowed_models: list[str],
    tools: list[dict[str, Any]],
    turn: int,
) -> dict[str, Any]:
    result = _post_chat(
        api_key,
        {
            "model": AUTO_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": f"{TOOL_PROMPT} (turn {turn}, cost_tier={cost_tier})",
                }
            ],
            "tools": tools,
            "tool_choice": {"type": "function", "function": {"name": "terminal"}},
            "plugins": [
                {
                    "id": PLUGIN_ID,
                    "cost_tier": cost_tier,
                    "allowed_models": allowed_models,
                }
            ],
            "max_tokens": 256,
        },
        AUTO_TIMEOUT_S,
    )
    body = result.get("body") if result["ok"] else None
    calls = _message_tool_calls(body if isinstance(body, dict) else None)
    model = _response_model(body if isinstance(body, dict) else None)
    on_list = bool(model and model in allowed_models)
    return {
        "turn": turn,
        "ok": bool(result["ok"] and model and on_list and _has_terminal_tool_call(calls)),
        "status": result.get("status"),
        "latency_ms": result["latency_ms"],
        "error": result.get("error"),
        "response_model": model,
        "on_shortlist": on_list,
        "tool_calls": bool(calls),
        "terminal_tool_call": _has_terminal_tool_call(calls),
    }


def run_mode(
    api_key: str,
    *,
    mode: str,
    cost_tier: str,
    start_models: list[str],
    tools: list[dict[str, Any]],
) -> dict[str, Any]:
    per_model = [probe_model_tools(api_key, m, tools) for m in start_models]
    survivors = [r["model"] for r in per_model if r["ok"]]
    dropped = [
        {"model": r["model"], "reason": r["drop_reason"]}
        for r in per_model
        if not r["ok"]
    ]

    auto_turns: list[dict[str, Any]] = []
    selected: Counter[str] = Counter()
    if survivors:
        for i in range(1, AUTO_TURNS + 1):
            row = probe_auto_turn(
                api_key,
                cost_tier=cost_tier,
                allowed_models=survivors,
                tools=tools,
                turn=i,
            )
            auto_turns.append(row)
            if row.get("response_model"):
                selected[str(row["response_model"])] += 1

    # Sticky auto-beta often reuses one model across turns — "never selected"
    # is informational only. Hard drops are 404 / tools-refused above.
    never_selected: list[str] = []
    if auto_turns and any(t.get("response_model") for t in auto_turns):
        for mid in survivors:
            if selected.get(mid, 0) == 0:
                never_selected.append(mid)

    auto_ok = all(t.get("ok") for t in auto_turns) if auto_turns else False
    # Final allow-list = tool-capable survivors (the Auto pool). Do not shrink
    # to sticky winners — that would collapse the router to one model.
    final = list(survivors)

    return {
        "mode": mode,
        "cost_tier": cost_tier,
        "start": list(start_models),
        "per_model": per_model,
        "survivors_after_tools": survivors,
        "dropped_tools_or_404": dropped,
        "never_selected_informational": never_selected,
        "final_allowlist": final,
        "auto_turns": auto_turns,
        "auto_pass": auto_ok and bool(auto_turns),
        "selected_counts": dict(selected),
    }


def _markdown_table(report: dict[str, Any]) -> str:
    lines = [
        "| Mode | cost_tier | Auto pass | Turns ok | Final allow-list | Dropped |",
        "|---|---|---|---|---|---|",
    ]
    for mode_key in ("intelligence", "cost"):
        m = report["modes"][mode_key]
        turns = m["auto_turns"]
        ok_n = sum(1 for t in turns if t.get("ok"))
        dropped = [d["model"] for d in m["dropped_tools_or_404"]]
        lines.append(
            "| {mode} | `{tier}` | {ap} | {ok}/{tot} | {final} | {drop} |".format(
                mode=m["mode"],
                tier=m["cost_tier"],
                ap="yes" if m["auto_pass"] else "no",
                ok=ok_n,
                tot=len(turns),
                final=", ".join(m["final_allowlist"]) or "(empty)",
                drop=", ".join(dropped) or "—",
            )
        )
    lines.append("")
    lines.append("### Per auto turn")
    lines.append("| Mode | Turn | response.model | on list | terminal tool | latency_ms | ok |")
    lines.append("|---|---|---|---|---|---|---|")
    for mode_key in ("intelligence", "cost"):
        m = report["modes"][mode_key]
        for t in m["auto_turns"]:
            lines.append(
                "| {mode} | {turn} | `{model}` | {on} | {term} | {lat} | {ok} |".format(
                    mode=m["mode"],
                    turn=t["turn"],
                    model=t.get("response_model") or "—",
                    on="yes" if t.get("on_shortlist") else "no",
                    term="yes" if t.get("terminal_tool_call") else "no",
                    lat=t.get("latency_ms"),
                    ok="yes" if t.get("ok") else "no",
                )
            )
    return "\n".join(lines)


def write_allowlists_module(path: Path, intelligence: list[str], cost: list[str]) -> None:
    """Durable allow-lists for Phase C (okvevo_auto_router)."""

    def fmt(ids: list[str]) -> str:
        if not ids:
            return "[]"
        inner = ",\n".join(f'    "{m}"' for m in ids)
        return "[\n" + inner + ",\n]"

    body = (
        '"""Verified OkVevo Auto allow-lists (Phase B live OpenRouter probes).\n'
        "\n"
        "Do not edit by hand unless re-running ``scripts/probe_okvevo_auto_router.py``.\n"
        '"""\n'
        "\n"
        "from __future__ import annotations\n"
        "\n"
        f"INTELLIGENCE_ALLOWED_MODELS: list[str] = {fmt(intelligence)}\n"
        "\n"
        f"COST_ALLOWED_MODELS: list[str] = {fmt(cost)}\n"
    )
    path.write_text(body, encoding="utf-8")


def main() -> int:
    api_key = _load_api_key()
    if not api_key:
        print("FAIL: OPENROUTER_API_KEY absent (env or ~/.hermes/.env)")
        return 2

    tools = [_terminal_tool_openai()]
    print("Probing Intelligence (xhigh)…", flush=True)
    intelligence = run_mode(
        api_key,
        mode="Intelligence",
        cost_tier="xhigh",
        start_models=INTELLIGENCE_START,
        tools=tools,
    )
    print("Probing Cost Effective (medium)…", flush=True)
    cost = run_mode(
        api_key,
        mode="Cost Effective",
        cost_tier="medium",
        start_models=COST_START,
        tools=tools,
    )

    report = {
        "wire_model": AUTO_MODEL,
        "plugin_id": PLUGIN_ID,
        "auto_turns_per_mode": AUTO_TURNS,
        "modes": {"intelligence": intelligence, "cost": cost},
        "phase_b_pass": bool(intelligence["auto_pass"] and cost["auto_pass"]),
    }

    out_json = Path(__file__).with_name("probe_okvevo_auto_router.report.json")
    out_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    allowlists = _ROOT / "agent" / "okvevo_auto_allowlists.py"
    write_allowlists_module(
        allowlists,
        intelligence["final_allowlist"],
        cost["final_allowlist"],
    )

    print()
    print(_markdown_table(report))
    print()
    print(f"Wrote {out_json}")
    print(f"Wrote {allowlists}")
    print(f"phase_b_pass={report['phase_b_pass']}")
    return 0 if report["phase_b_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
