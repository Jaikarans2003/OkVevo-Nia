"""CSV + summary.md for one OS P0 run."""

from __future__ import annotations

import csv
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPORTS = HERE / "reports"

FIELDS = [
    "suite",
    "task_id",
    "rep",
    "os",
    "prompt",
    "first_tool",
    "expect_first",
    "routed_model",
    "wall_s",
    "llm_turns",
    "tokens",
    "credits",
    "screenshots",
    "checker_ok",
    "checker_reason",
    "status",
]


def reports_dir() -> Path:
    REPORTS.mkdir(parents=True, exist_ok=True)
    return REPORTS


def csv_path(os_name: str, day: str | None = None) -> Path:
    day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return reports_dir() / f"p0_{os_name}_{day}.csv"


def summary_path(os_name: str, day: str | None = None) -> Path:
    day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return reports_dir() / f"p0_{os_name}_{day}_summary.md"


def append_row(path: Path, row: dict[str, Any]) -> None:
    if path.exists():
        with path.open(encoding="utf-8", newline="") as f:
            header = (f.readline() or "").strip()
        if header and header.split(",") != FIELDS:
            raise SystemExit(
                f"{path.name} has an older column layout. Move it to reports/archive/ "
                "before re-running so new rows are not mixed into it."
            )
    new = not path.exists()
    with path.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        if new:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in FIELDS})


def load_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _num(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x


def write_summary(
    path: Path,
    *,
    os_name: str,
    versions: dict[str, Any],
    dump_path: str,
    rows: list[dict[str, str]],
    entry: str,
) -> None:
    d7 = [r for r in rows if r.get("suite") == "d7"]
    bake = [r for r in rows if r.get("suite") == "bakeoff"]
    base = [r for r in rows if r.get("suite") == "baseline"]
    blob = " ".join((r.get("checker_reason") or "") + " " + (r.get("status") or "") for r in d7)
    auto_note = ""
    if "ValidationException" in blob or "invalid model identifier" in blob.lower():
        auto_note = (
            "Auto turns hit Bedrock `ValidationException` (invalid model id). "
            "Empty `first_tool` is that error, not a routing decision.\n\n"
        )

    def d7_table() -> str:
        lines = [
            "| task | rep | expect | first_tool | routed_model | wall_s | tokens | credits | screenshots |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for r in d7:
            lines.append(
                "| {task_id} | {rep} | {expect_first} | {first_tool} | {routed_model} | {wall_s} | {tokens} | {credits} | {screenshots} |".format(
                    **{k: r.get(k, "") for k in FIELDS}
                )
            )
        return "\n".join(lines) if d7 else "_no D7 rows_"

    def bake_table() -> str:
        models: dict[str, list[dict[str, str]]] = {}
        for r in bake:
            models.setdefault(r.get("routed_model") or r.get("model") or "?", []).append(r)
        # Rank by success rate then p50 wall among successes.
        scored = []
        for model, rs in models.items():
            oks = [r for r in rs if r.get("checker_ok") == "True"]
            rate = (len(oks) / len(rs)) if rs else 0.0
            walls = [_num(r.get("wall_s")) for r in oks]
            walls = [w for w in walls if w is not None]
            p50 = statistics.median(walls) if walls else None
            scored.append((rate, -(p50 or 1e9), model, len(oks), len(rs), p50))
        scored.sort(reverse=True)
        lines = [
            "| model | success | p50_s | n |",
            "|---|---|---|---|",
        ]
        for rate, _, model, ok, n, p50 in scored:
            lines.append(
                f"| {model} | {ok}/{n} ({rate:.0%}) | {p50 if p50 is not None else ''} | {n} |"
            )
        winner = scored[0][2] if scored else ""
        extra = f"\n\nProvisional winner (success rate, then p50): **{winner}**. Not locked (R6 waits for P2 re-run)."
        return "\n".join(lines) + extra if bake else "_no bake-off rows_"

    def baseline_block() -> str:
        if not base:
            return "_no baseline rows_"
        oks = [r for r in base if r.get("checker_ok") == "True"]
        walls = [_num(r.get("wall_s")) for r in oks]
        walls = [w for w in walls if w is not None]
        tokens = [_num(r.get("tokens")) for r in base]
        tokens = [t for t in tokens if t is not None]
        turns = [_num(r.get("llm_turns")) for r in base]
        turns = [t for t in turns if t is not None]
        credits = [_num(r.get("credits")) for r in base]
        credits = [c for c in credits if c is not None]
        p50 = statistics.median(walls) if walls else None
        return (
            f"- success rate: {len(oks)}/{len(base)}\n"
            f"- p50 wall (successes): {p50}\n"
            f"- LLM turns (mean): {round(sum(turns)/len(turns), 2) if turns else ''}\n"
            f"- tokens (mean): {round(sum(tokens)/len(tokens), 1) if tokens else ''}\n"
            f"- credits (mean, if gateway exposed them): {round(sum(credits)/len(credits), 4) if credits else 'unknown'}\n"
        )

    text = f"""# P0 computer-use report ({os_name})

Date: {datetime.now(timezone.utc).strftime("%Y-%m-%d")} (UTC)

## Entry point (packaged Nia, not dev mode)

{entry}

## Versions

```
{json_pretty(versions)}
```

## Dumps

`{dump_path}`

## D7 matrix (Cost Effective Auto, 3×, first tool only)

{auto_note}{d7_table()}

## Provisional bake-off

{bake_table()}

## Baseline scores (app-state checkers)

{baseline_block()}

Raw CSV: `{csv_path(os_name).name}`
"""
    path.write_text(text, encoding="utf-8")


def json_pretty(obj: Any) -> str:
    import json

    return json.dumps(obj, indent=2, ensure_ascii=False)
