#!/usr/bin/env python3
"""P0 computer-use harness: packaged Nia via session.create + prompt.submit.

See discover.py for the desktop chat file:line entry points.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from checkers import check_kind  # noqa: E402
from client import (  # noqa: E402
    Gateway,
    budget_exceeded,
    credits_from_usage,
    observed_models,
    wait_until,
)
from config_load import load_config, redact, require_test_contact  # noqa: E402
from discover import discover  # noqa: E402
from dump import run_dumps  # noqa: E402
from ledger import RunLedger  # noqa: E402
from live_agent import ensure_bound_backend, inspect_backend, launch_nia_bound  # noqa: E402
from report import append_row, csv_path, load_rows, summary_path, write_summary  # noqa: E402
from reset import reset_kind  # noqa: E402
from tasks import (  # noqa: E402
    AUTO_MODEL,
    bakeoff_model_list,
    bakeoff_tasks,
    baseline_tasks,
    d7_tasks,
    is_alias_model,
)

ENTRY = (
    "Desktop chat: `session.create` at "
    "apps/desktop/src/app/session/hooks/use-session-actions/index.ts "
    "desktopSessionCreateParams L247–280 and requestGateway L532–538; "
    "`prompt.submit` at apps/desktop/src/app/session/hooks/use-prompt-actions/submit.ts "
    "L756–790. Gateway: tui_gateway/methods_session.py L14, "
    "tui_gateway/methods_prompt.py L287. Packaged spawn: "
    "apps/desktop/electron/main.ts L12190 / L12308. No Vite/dev mode."
)

OS_NAME = "windows" if sys.platform == "win32" else "mac"


def _run(cmd: list[str], timeout: float = 20) -> str:
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return (r.stdout or r.stderr or "").strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return f"error:{exc}"


def versions() -> dict[str, Any]:
    npm_pkg = HERE / "node_modules" / "@trycua" / "cua-driver" / "package.json"
    npm_ver = None
    if npm_pkg.exists():
        try:
            npm_ver = json.loads(npm_pkg.read_text(encoding="utf-8")).get("version")
        except json.JSONDecodeError:
            npm_ver = None
    info = inspect_backend()
    return {
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "cua_driver_binary": _run(["cua-driver", "--version"]),
        "npm_trycua_cua_driver": npm_ver or _run(["npm", "view", "@trycua/cua-driver", "version"]),
        "pinned_constant": "0.28.2",
        "nia_app": "/Applications/Nia.app" if OS_NAME == "mac" else "Nia.exe (Start Menu)",
        "live_agent": info,
    }


def done_keys(rows: list[dict[str, str]]) -> set[tuple[str, str, str]]:
    return {(r.get("suite", ""), r.get("task_id", ""), r.get("rep", "")) for r in rows}


def session_create_params(model: str) -> dict[str, Any]:
    """Match desktop session.create: model + provider (Auto requires openrouter)."""
    params: dict[str, Any] = {"cols": 96, "source": "desktop"}
    if model:
        params["model"] = model
        params["provider"] = "openrouter"
    return params


async def new_session(gw: Gateway, model: str) -> str:
    created = await gw.request("session.create", session_create_params(model), timeout=120)
    sid = created["session_id"]
    try:
        await gw.request(
            "config.set",
            {"session_id": sid, "key": "yolo", "value": "on", "scope": "session"},
            timeout=30,
        )
    except Exception:
        pass
    return sid


async def _interrupt(gw: Gateway, sid: str) -> None:
    try:
        await gw.request("session.interrupt", {"session_id": sid}, timeout=15)
    except Exception:
        pass
    await wait_until(lambda: gw.complete(sid) is not None, 15)


async def run_turn(
    gw: Gateway,
    *,
    model: str,
    prompt: str,
    timeout_s: float,
    stop_after_first_tool: bool,
    max_llm_turns: int,
    max_tokens: int,
) -> dict[str, Any]:
    sid = await new_session(gw, model)
    ledger = RunLedger()
    ledger.open()
    t0 = time.monotonic()
    await gw.request(
        "prompt.submit",
        {"session_id": sid, "text": prompt},
        timeout=min(60, timeout_s),
    )
    deadline = time.monotonic() + timeout_s
    hit_budget = False
    while time.monotonic() < deadline:
        usage_now = gw.latest_usage(sid)
        if budget_exceeded(usage_now, max_llm_turns, max_tokens):
            hit_budget = True
            break
        if stop_after_first_tool and gw.first_action_tool(sid):
            break
        if gw.complete(sid) is not None:
            break
        await asyncio.sleep(0.2)
    if hit_budget or (stop_after_first_tool and gw.first_action_tool(sid)) or gw.complete(sid) is None:
        await _interrupt(gw, sid)
    try:
        await gw.refresh_usage(sid)
    except Exception:
        pass
    usage = gw.usage(sid)
    if not hit_budget and budget_exceeded(usage, max_llm_turns, max_tokens):
        hit_budget = True
    credits = credits_from_usage(usage)
    routed = gw.routed_model(sid) or ";".join(
        observed_models([{"type": "message.complete", "payload": {"usage": usage}}])
    )
    if not routed and model and not is_alias_model(model):
        routed = model
    if ledger.ready and (not credits or not routed or is_alias_model(routed)):
        for _ in range(4):
            led_credits, led_models = ledger.finish()
            concrete = [name for name in led_models if name and not is_alias_model(name)]
            if concrete:
                routed = ";".join(concrete)
            if not credits and led_credits:
                credits = led_credits
            if credits and routed:
                break
            await asyncio.sleep(1)
    wall = round(time.monotonic() - t0, 2)
    complete = gw.complete(sid) or {}
    status = "budget_exceeded" if hit_budget else (complete.get("status") or "timeout")
    err = complete.get("error")
    err_s = ""
    if isinstance(err, str):
        err_s = err.replace("\n", " ")[:180]
    elif isinstance(err, dict):
        err_s = str(err.get("code") or err.get("layer") or err.get("message") or "")[:180]
    return {
        "session_id": sid,
        "first_tool": gw.first_action_tool(sid),
        "routed_model": routed,
        "wall_s": wall,
        "llm_turns": usage.get("calls") or gw.latest_usage(sid).get("calls") or "",
        "tokens": usage.get("total") or gw.latest_usage(sid).get("total") or "",
        "credits": credits,
        "screenshots": gw.screenshot_count(sid),
        "status": status,
        "error": err_s,
    }


def skip_task(task: dict[str, Any]) -> str | None:
    if task.get("windows_only") and sys.platform != "win32":
        return "windows_only"
    return None


async def run_suite(
    gw: Gateway,
    *,
    suite: str,
    tasks: list[dict[str, Any]],
    model: str,
    reps: int,
    timeout_s: float,
    stop_after_first_tool: bool,
    max_llm_turns: int,
    max_tokens: int,
    csv_file: Path,
    seen: set[tuple[str, str, str]],
    cfg: dict[str, Any],
    contact: str,
    score: bool,
) -> None:
    for task in tasks:
        why = skip_task(task)
        tid = task["id"]
        if suite == "bakeoff":
            tid = f"{task['id']}__{model.replace('/', '_')}"
        for rep in range(1, reps + 1):
            key = (suite, tid, str(rep))
            if key in seen:
                continue
            marker = uuid.uuid4().hex[:8]
            prompt = str(task["prompt"]).replace("{MARKER}", marker)
            if why:
                append_row(
                    csv_file,
                    {
                        "suite": suite,
                        "task_id": tid,
                        "rep": rep,
                        "os": OS_NAME,
                        "prompt": redact(prompt, contact),
                        "first_tool": "",
                        "expect_first": task.get("expect_first", ""),
                        "routed_model": model,
                        "wall_s": "",
                        "llm_turns": "",
                        "tokens": "",
                        "credits": "",
                        "screenshots": "",
                        "checker_ok": "",
                        "checker_reason": why,
                        "status": "skipped",
                    },
                )
                seen.add(key)
                continue
            reset_kind(task.get("kind") or "")
            result = await run_turn(
                gw,
                model=model,
                prompt=prompt,
                timeout_s=timeout_s,
                stop_after_first_tool=stop_after_first_tool,
                max_llm_turns=max_llm_turns,
                max_tokens=max_tokens,
            )
            checker = {"ok": "", "reason": "d7_first_tool_only"}
            if score:
                time.sleep(1.5)
                try:
                    checker = check_kind(task.get("kind") or "", marker=marker, cfg=cfg)
                except Exception as exc:
                    checker = {"ok": False, "reason": f"checker_exc:{type(exc).__name__}"}
            elif result.get("error"):
                checker = {"ok": "", "reason": result["error"][:180]}
            append_row(
                csv_file,
                {
                    "suite": suite,
                    "task_id": tid,
                    "rep": rep,
                    "os": OS_NAME,
                    "prompt": redact(prompt, contact),
                    "first_tool": result["first_tool"],
                    "expect_first": task.get("expect_first", ""),
                    "routed_model": result["routed_model"],
                    "wall_s": result["wall_s"],
                    "llm_turns": result["llm_turns"],
                    "tokens": result["tokens"],
                    "credits": result["credits"],
                    "screenshots": result["screenshots"],
                    "checker_ok": checker.get("ok"),
                    "checker_reason": checker.get("reason"),
                    "status": result["status"],
                },
            )
            seen.add(key)
            print(
                f"{suite} {tid} r{rep} first={result['first_tool'] or '-'} "
                f"model={result['routed_model']} {result['wall_s']}s",
                flush=True,
            )


def wait_gateway(explicit: str, tries: int = 30) -> tuple[str, str]:
    last = None
    for i in range(tries):
        try:
            return discover(explicit)
        except SystemExit as exc:
            last = exc
            if i == 0:
                launch_nia_bound()
            time.sleep(2)
    raise last  # type: ignore[misc]


async def async_main(args: argparse.Namespace) -> int:
    cfg = load_config()
    suites = args.suite
    needs_wa = suites != ["dump"]
    contact = ""
    if needs_wa:
        contact = require_test_contact(cfg)
    dump_file = ""
    if "dump" in suites or "all" in suites:
        dump_file = str(run_dumps(contact))
        print("dump", dump_file, flush=True)
    if suites == ["dump"]:
        return 0
    live = ensure_bound_backend()
    print(
        "live_agent using_this_checkout=",
        live.get("using_this_checkout"),
        "mode=",
        live.get("bind_mode"),
        "root=",
        live.get("agent_root"),
        flush=True,
    )
    base, token = wait_gateway(str(cfg.get("gateway_url") or args.gateway or ""))
    live = inspect_backend()
    if os.environ.get("P0_ALLOW_PACKAGED") != "1" and not live.get("using_this_checkout"):
        live = ensure_bound_backend()
        base, token = wait_gateway(str(cfg.get("gateway_url") or args.gateway or ""))
        live = inspect_backend()
    print(
        "gateway bound using_this_checkout=",
        live.get("using_this_checkout"),
        "pid=",
        live.get("gateway_pid"),
        flush=True,
    )
    gw = Gateway(base, token)
    await gw.connect()
    csv_file = csv_path(OS_NAME)
    seen = done_keys(load_rows(csv_file))
    d7_reps = int(cfg.get("d7_reps") or 3)
    bake_reps = int(cfg.get("bakeoff_reps") or 3)
    base_reps = int(cfg.get("baseline_reps") or 3)
    d7_to = float(cfg.get("d7_timeout_s") or 120)
    task_to = float(cfg.get("task_timeout_s") or 600)
    max_turns = int(cfg.get("max_llm_turns") or 12)
    max_tokens = int(cfg.get("max_tokens") or 150000)
    marker0 = "p0"
    try:
        if "d7" in suites or "all" in suites:
            await run_suite(
                gw,
                suite="d7",
                tasks=d7_tasks(contact, marker0),
                model=AUTO_MODEL,
                reps=d7_reps,
                timeout_s=d7_to,
                stop_after_first_tool=True,
                max_llm_turns=max_turns,
                max_tokens=max_tokens,
                csv_file=csv_file,
                seen=seen,
                cfg=cfg,
                contact=contact,
                score=False,
            )
        if "bakeoff" in suites or "all" in suites:
            for model in bakeoff_model_list(cfg):
                await run_suite(
                    gw,
                    suite="bakeoff",
                    tasks=bakeoff_tasks(contact, marker0),
                    model=model,
                    reps=bake_reps,
                    timeout_s=task_to,
                    stop_after_first_tool=False,
                    max_llm_turns=max_turns,
                    max_tokens=max_tokens,
                    csv_file=csv_file,
                    seen=seen,
                    cfg=cfg,
                    contact=contact,
                    score=True,
                )
        if "baseline" in suites or "all" in suites:
            await run_suite(
                gw,
                suite="baseline",
                tasks=baseline_tasks(contact, marker0),
                model=AUTO_MODEL,
                reps=base_reps,
                timeout_s=task_to,
                stop_after_first_tool=False,
                max_llm_turns=max_turns,
                max_tokens=max_tokens,
                csv_file=csv_file,
                seen=seen,
                cfg=cfg,
                contact=contact,
                score=True,
            )
    finally:
        await gw.close()
    rows = load_rows(csv_file)
    write_summary(
        summary_path(OS_NAME),
        os_name=OS_NAME,
        versions=versions(),
        dump_path=dump_file,
        rows=rows,
        entry=ENTRY,
    )
    print("csv", csv_file)
    print("summary", summary_path(OS_NAME))
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--suite",
        nargs="+",
        default=["all"],
        choices=["dump", "d7", "bakeoff", "baseline", "all"],
    )
    p.add_argument("--gateway", default="")
    return asyncio.run(async_main(p.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
