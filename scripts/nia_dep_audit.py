#!/usr/bin/env python3
"""Fail CI on CRITICAL production dependency findings.

Runs:
  - ``uv export --frozen --no-dev --no-emit-project`` + ``uvx pip-audit``
  - ``npm audit --omit=dev --audit-level=critical``

pip-audit has no severity cutoff in current uvx builds, so any non-allowlisted
Python finding fails the gate (Batch 1 baseline is clean after the anyio bump).
npm only fails on CRITICAL (``--audit-level=critical``).

Allowlist: ``.github/nia-dep-audit-allowlist.txt`` (one GHSA-/CVE- id per line).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST = ROOT / ".github" / "nia-dep-audit-allowlist.txt"


def allowlisted() -> set[str]:
    if not ALLOWLIST.is_file():
        return set()
    out: set[str] = set()
    for line in ALLOWLIST.read_text().splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            out.add(s.upper())
    return out


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, check=False)


def main() -> int:
    allowed = allowlisted()
    failed = False

    req = Path("/tmp/nia-dep-audit-req.txt")
    exp = run(
        [
            "uv",
            "export",
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "-o",
            str(req),
        ]
    )
    if exp.returncode != 0:
        sys.stderr.write(exp.stderr or exp.stdout)
        return 1

    audit = run(
        [
            "uvx",
            "pip-audit",
            "-r",
            str(req),
            "--progress-spinner",
            "off",
            "--disable-pip",
            "--format",
            "json",
        ]
    )
    # 0 = clean, 1 = vulns found, other = tool error
    if audit.returncode not in (0, 1):
        sys.stderr.write(audit.stderr or audit.stdout)
        return 1
    pip_hits: list[str] = []
    raw = (audit.stdout or "").strip()
    if raw and audit.returncode == 1:
        data = json.loads(raw)
        deps = data.get("dependencies") if isinstance(data, dict) else data
        for dep in deps or []:
            for v in dep.get("vulns") or []:
                vid = str(v.get("id") or "")
                aliases = {str(a).upper() for a in (v.get("aliases") or [])}
                ids = {vid.upper(), *aliases}
                if ids & allowed:
                    continue
                pip_hits.append(f"{dep.get('name')}:{vid}")
    if pip_hits:
        failed = True
        print("pip-audit findings (gate treats as CRITICAL for Batch 1):")
        for h in pip_hits:
            print(f"  - {h}")

    npm = run(["npm", "audit", "--omit=dev", "--audit-level=critical"])
    if npm.stdout:
        print(npm.stdout)
    if npm.stderr:
        sys.stderr.write(npm.stderr)
    # audit-level=critical → non-zero only when critical vulns exist
    if npm.returncode != 0:
        # Filter allowlist via JSON if possible
        npm_json = run(["npm", "audit", "--omit=dev", "--json"])
        blocking = True
        try:
            data = json.loads(npm_json.stdout or "{}")
            vulns = data.get("vulnerabilities") or {}
            crit_ids: set[str] = set()
            for info in vulns.values():
                if str(info.get("severity") or "").upper() != "CRITICAL":
                    continue
                for item in info.get("via") or []:
                    if isinstance(item, dict) and item.get("url"):
                        crit_ids.add(str(item["url"]).rsplit("/", 1)[-1].upper())
            if crit_ids and crit_ids <= allowed:
                blocking = False
                print("npm CRITICAL findings allowlisted:", ", ".join(sorted(crit_ids)))
        except json.JSONDecodeError:
            pass
        if blocking:
            failed = True
            print("npm audit: CRITICAL production findings")

    if failed:
        print(
            "nia-dep-audit FAILED. Accept only via .github/nia-dep-audit-allowlist.txt.",
            file=sys.stderr,
        )
        return 1
    print("nia-dep-audit: OK (no non-allowlisted CRITICAL findings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
