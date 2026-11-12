#!/usr/bin/env python3
"""Warn (never fail) when a workaround in docs/okvevo/WORKAROUNDS.md is due for review.

A row is due when its upstream Bug issue is closed, or its Last-Update is older
than 60 days. Output uses GitHub Actions ``::warning::`` lines. Set GITHUB_TOKEN
to avoid the anonymous API rate limit. ``--self-check`` runs the parser asserts.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

DOC = Path(__file__).resolve().parents[2] / "docs" / "okvevo" / "WORKAROUNDS.md"
MAX_AGE_DAYS = 60
ISSUE_RE = re.compile(r"https://github\.com/([\w.-]+)/([\w.-]+)/issues/(\d+)")
COLUMNS = ("Id", "Description", "Bug", "Forwarded", "Applied-Upstream", "Last-Update")


def parse_rows(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    header: list[str] | None = None
    for line in text.splitlines():
        if not line.startswith("|"):
            header = None
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if header is None:
            if tuple(cells) == COLUMNS:
                header = cells
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        rows.append(dict(zip(header, cells)))
    return rows


def stale(last_update: str, today: dt.date) -> bool:
    try:
        return (today - dt.date.fromisoformat(last_update)).days > MAX_AGE_DAYS
    except ValueError:
        return True


def issue_state(owner: str, repo: str, number: str) -> str:
    request = urllib.request.Request(f"https://api.github.com/repos/{owner}/{repo}/issues/{number}")
    request.add_header("Accept", "application/vnd.github+json")
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response).get("state", "unknown")


def main() -> int:
    rows = parse_rows(DOC.read_text(encoding="utf-8"))
    if not rows:
        print(f"::warning::no workaround rows parsed from {DOC.name}")
        return 0
    today = dt.date.today()
    for row in rows:
        wid = row.get("Id", "?")
        if stale(row.get("Last-Update", ""), today):
            print(f"::warning::workaround {wid}: Last-Update {row.get('Last-Update')} is older than "
                  f"{MAX_AGE_DAYS} days; re-check the upstream issue and bump the date")
        for owner, repo, number in ISSUE_RE.findall(row.get("Bug", "")):
            try:
                state = issue_state(owner, repo, number)
            except Exception as exc:  # noqa: BLE001 — warn-only check
                print(f"workaround {wid}: could not read {owner}/{repo}#{number}: {exc}")
                continue
            if state == "closed":
                print(f"::warning::workaround {wid}: {owner}/{repo}#{number} is closed; run its behavior "
                      "test with the toggle off and remove the workaround if Hermes passes")
    print(f"checked {len(rows)} workaround(s)")
    return 0


def self_check() -> int:
    sample = "intro\n\n| Id | Description | Bug | Forwarded | Applied-Upstream | Last-Update |\n" \
             "| --- | --- | --- | --- | --- | --- |\n" \
             "| a | x | https://github.com/o/r/issues/7 | no | no | 2026-10-30 |\n"
    rows = parse_rows(sample)
    assert [row["Id"] for row in rows] == ["a"], rows
    assert ISSUE_RE.findall(rows[0]["Bug"]) == [("o", "r", "7")]
    assert not stale("2026-10-30", dt.date(2026, 12, 29))
    assert stale("2026-10-30", dt.date(2026, 12, 30))
    assert stale("not a date", dt.date(2026, 10, 30))
    assert {row["Id"] for row in parse_rows(DOC.read_text(encoding="utf-8"))} >= {
        "groups_all_profiles", "event_loop_block_stack"}
    print("check_workarounds self-check: ok")
    return 0


if __name__ == "__main__":
    sys.exit(self_check() if "--self-check" in sys.argv else main())
