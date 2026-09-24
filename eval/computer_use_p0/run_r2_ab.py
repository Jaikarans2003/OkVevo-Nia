#!/usr/bin/env python3
"""Fair A/B: A=e1d855e275 vs B=current sync. Same slug, 12/150k, interleaved."""

from __future__ import annotations

import asyncio
import json
import math
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import live_agent  # noqa: E402
from checkers import check_kind  # noqa: E402
from client import Gateway  # noqa: E402
from config_load import load_config, redact, require_test_contact  # noqa: E402
from discover import discover  # noqa: E402
from ledger import RunLedger  # noqa: E402
from live_agent import inspect_backend, launch_nia_bound  # noqa: E402
from report import append_row, load_rows, reports_dir  # noqa: E402
from reset import reset_kind  # noqa: E402
from run_p0 import OS_NAME, done_keys, run_turn  # noqa: E402
from tasks import baseline_tasks  # noqa: E402

SHA_A = "e1d855e275"
SHA_B = "WORKING_TREE"  # S3 exit: current hermes-agent checkout (not a SHA)
# S4 standard list, ranked. First priced hit wins. Not Auto.
S4_SLUGS = (
    "qwen/qwen3.8-27b",  # exact S4 name; qwen/qwen3.8-max is 404 on OpenRouter
    "google/gemini-3.6-flash",
)
TASK_IDS = (
    "base_notes",
    "base_vague_notes",
    "base_vague_notes2",
    "base_whatsapp_regression",
)
REPS = 3
MAX_TURNS = 12
MAX_TOKENS = 150_000
MARGIN = 2.0
CREDITS_PER_USD = 1000
RUNS = len(TASK_IDS) * REPS * 2
WORKTREE_A = HERE.parents[2] / "hermes-agent-r2-a"


def _openrouter_catalog() -> dict[str, dict[str, Any]]:
    """Id → row. The per-id /models/{author}/{slug} URL 404s; the list does not."""
    try:
        with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in body.get("data") or []:
        if isinstance(row, dict) and isinstance(row.get("id"), str):
            out[row["id"]] = row
    return out


def resolve_model() -> tuple[str, dict[str, float]]:
    catalog = _openrouter_catalog()
    if not catalog:
        raise SystemExit("OpenRouter /v1/models failed. Stop.")
    for slug in S4_SLUGS:
        data = catalog.get(slug)
        if not data:
            print(f"skip {slug}: not in catalog", flush=True)
            continue
        pricing = data.get("pricing") if isinstance(data, dict) else None
        if not isinstance(pricing, dict):
            continue
        try:
            prompt = float(pricing.get("prompt") or 0)
            completion = float(pricing.get("completion") or 0)
        except (TypeError, ValueError):
            continue
        if prompt <= 0 and completion <= 0:
            print(f"skip {slug}: unpriced", flush=True)
            continue
        print(f"R2 model {slug} prompt={prompt} completion={completion}", flush=True)
        return slug, {"prompt": prompt, "completion": completion}
    raise SystemExit("No S4 slug is priced on OpenRouter. Stop.")


def estimate_credits(rates: dict[str, float]) -> int:
    # Cap-based: 150k tokens, 80/20 prompt/completion (screenshots are prompt-heavy).
    raw = MAX_TOKENS * 0.8 * rates["prompt"] + MAX_TOKENS * 0.2 * rates["completion"]
    one = int(math.ceil(raw * MARGIN * CREDITS_PER_USD))
    return one * RUNS


def credit_balance() -> int | None:
    ledger = RunLedger()
    ledger.open()
    if not ledger.ready or not ledger._before:
        return None
    return int(ledger._before["allocationBalance"]) + int(ledger._before["topUpBalance"])


def ensure_worktree_a() -> Path:
    repo = HERE.parents[1]
    if (WORKTREE_A / "hermes_cli" / "main.py").is_file():
        sha = subprocess.check_output(
            ["git", "-C", str(WORKTREE_A), "rev-parse", "HEAD"], text=True
        ).strip()
        if not sha.startswith(SHA_A):
            raise SystemExit(f"worktree {WORKTREE_A} is {sha}, want {SHA_A}")
        return WORKTREE_A
    WORKTREE_A.parent.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(
        ["git", "-C", str(repo), "worktree", "add", str(WORKTREE_A), SHA_A]
    )
    return WORKTREE_A


def pin_ok(root: Path) -> bool:
    return live_agent._has_pin(root) == "0.28.2"


def bind_root(root: Path) -> dict[str, Any]:
    live_agent.CHECKOUT = root
    info = live_agent.bind_via_rsync()
    if not (info.get("gateway_pid") and live_agent._has_pin(live_agent.ACTIVE) == "0.28.2"):
        raise SystemExit(
            f"bind failed for {root} pid={info.get('gateway_pid')} "
            f"root={info.get('agent_root')}"
        )
    return info


def wait_gateway(explicit: str, tries: int = 40) -> tuple[str, str]:
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


def csv_file() -> Path:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # S3 exit must not resume the R2 CSV (same UTC day would skip all 24 rows).
    return reports_dir() / f"s3_ab_{OS_NAME}_{day}.csv"


def summarize(rows: list[dict[str, str]]) -> None:
    print("\n=== R2 A/B ===", flush=True)
    for build in ("A", "B"):
        rs = [r for r in rows if r.get("suite") == f"r2_{build}"]
        oks = [r for r in rs if r.get("checker_ok") == "True"]
        credits = []
        for r in rs:
            try:
                credits.append(float(r.get("credits") or 0))
            except (TypeError, ValueError):
                pass
        spent = sum(credits)
        per_ok = (spent / len(oks)) if oks else None
        mix: dict[str, int] = {}
        for r in rs:
            name = (r.get("first_tool") or "-") or "-"
            mix[name] = mix.get(name, 0) + 1
        print(
            f"Build {build}: success {len(oks)}/{len(rs)} "
            f"credits_total={spent} credits_per_success={per_ok} "
            f"first_tool={mix}",
            flush=True,
        )
    a = [r for r in rows if r.get("suite") == "r2_A"]
    b = [r for r in rows if r.get("suite") == "r2_B"]
    a_ok = sum(1 for r in a if r.get("checker_ok") == "True")
    b_ok = sum(1 for r in b if r.get("checker_ok") == "True")
    a_rate = (a_ok / len(a)) if a else 0.0
    b_rate = (b_ok / len(b)) if b else 0.0

    def _spent(rs: list[dict[str, str]]) -> float:
        tot = 0.0
        for r in rs:
            try:
                tot += float(r.get("credits") or 0)
            except (TypeError, ValueError):
                pass
        return tot

    a_cps = (_spent(a) / a_ok) if a_ok else None
    b_cps = (_spent(b) / b_ok) if b_ok else None
    rate_ok = b_rate >= a_rate
    credit_ok = True
    if a_cps is not None and b_cps is not None:
        credit_ok = b_cps <= a_cps * 1.2
    passed = rate_ok and credit_ok
    print(
        f"pass={passed} (B≥A success {b_rate:.0%} vs {a_rate:.0%}; "
        f"credits/success B={b_cps} A={a_cps} cap=+20%)",
        flush=True,
    )
    wa = [r for r in b if r.get("task_id") == "base_whatsapp_regression"]
    wa_cu = sum(1 for r in wa if (r.get("first_tool") or "") == "computer_use")
    s3_pass = b_ok > a_ok and wa_cu == 3 and len(wa) == 3
    print(
        f"S3_exit pass={s3_pass} (S3 success {b_ok} > A {a_ok}; "
        f"WhatsApp first_tool computer_use {wa_cu}/{len(wa)})",
        flush=True,
    )


async def run_one(
    *,
    build: str,
    root: Path,
    task: dict[str, Any],
    rep: int,
    model: str,
    cfg: dict[str, Any],
    contact: str,
    out: Path,
    seen: set[tuple[str, str, str]],
) -> None:
    suite = f"r2_{build}"
    tid = task["id"]
    key = (suite, tid, str(rep))
    if key in seen:
        print(f"skip {suite} {tid} r{rep}", flush=True)
        return
    live_agent.CHECKOUT = root
    bind_root(root)
    base, token = wait_gateway(str(cfg.get("gateway_url") or ""))
    gw = Gateway(base, token)
    await gw.connect()
    try:
        reset_kind(task.get("kind") or "")
        marker = uuid.uuid4().hex[:8]
        prompt = str(task["prompt"]).replace("{MARKER}", marker)
        result = await run_turn(
            gw,
            model=model,
            prompt=prompt,
            timeout_s=float(cfg.get("task_timeout_s") or 600),
            stop_after_first_tool=False,
            max_llm_turns=MAX_TURNS,
            max_tokens=MAX_TOKENS,
        )
        time.sleep(1.5)
        try:
            checker = check_kind(task.get("kind") or "", marker=marker, cfg=cfg)
        except Exception as exc:
            checker = {"ok": False, "reason": f"checker_exc:{type(exc).__name__}"}
        append_row(
            out,
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
            f"ok={checker.get('ok')} tokens={result['tokens']} "
            f"credits={result['credits']} {result['status']}",
            flush=True,
        )
    finally:
        await gw.close()


async def async_main() -> int:
    cfg = load_config()
    contact = require_test_contact(cfg)
    model, rates = resolve_model()
    estimate = estimate_credits(rates)
    bal = credit_balance()
    print(f"estimate_credits={estimate} balance={bal} runs={RUNS} caps=12/{MAX_TOKENS}", flush=True)
    if bal is None:
        raise SystemExit("Cannot read test-account credits. Stop.")
    if bal < estimate:
        raise SystemExit(f"Balance {bal} below estimate {estimate}. Stop.")
    root_a = ensure_worktree_a()
    root_b = HERE.parents[1]
    if not pin_ok(root_a) or not pin_ok(root_b):
        raise SystemExit(
            f"cua pin missing A={live_agent._has_pin(root_a)} B={live_agent._has_pin(root_b)}"
        )
    print(f"A={root_a} B={root_b} model={model}", flush=True)
    out = csv_file()
    seen = done_keys(load_rows(out))
    tasks = [t for t in baseline_tasks(contact, "p0") if t["id"] in TASK_IDS]
    if len(tasks) != len(TASK_IDS):
        raise SystemExit(f"task mismatch { [t['id'] for t in tasks] }")
    for task in tasks:
        for rep in range(1, REPS + 1):
            await run_one(
                build="A",
                root=root_a,
                task=task,
                rep=rep,
                model=model,
                cfg=cfg,
                contact=contact,
                out=out,
                seen=seen,
            )
            await run_one(
                build="B",
                root=root_b,
                task=task,
                rep=rep,
                model=model,
                cfg=cfg,
                contact=contact,
                out=out,
                seen=seen,
            )
    summarize(load_rows(out))
    print("csv", out, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(async_main()))
