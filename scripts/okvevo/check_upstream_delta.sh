#!/usr/bin/env bash
# Fail if any upstream-owned path differs from the pinned Hermes release tag.
# OkVevo-owned paths are ignored, except apps/desktop and apps/bootstrap-installer:
# those must match docs/okvevo/PATCHES.md "UI/packaging deltas" exactly.
# Entries added after PR 1.2 need a reason: "- `path` — why". Prints the
# desktop / installer / other counts so a sync PR shows the patch budget.
set -euo pipefail

TAG="${1:-v0.22.4}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! git rev-parse --verify "$TAG^{commit}" >/dev/null 2>&1; then
  echo "error: missing tag $TAG (fetch origin, do not push it)" >&2
  exit 2
fi

is_owned() {
  case "$1" in
    apps/desktop|apps/desktop/*) return 0 ;;
    apps/bootstrap-installer|apps/bootstrap-installer/*) return 0 ;;
    plugins/okvevo|plugins/okvevo/*) return 0 ;;
    plugins/model-providers/okvevo|plugins/model-providers/okvevo/*) return 0 ;;
    docs/okvevo|docs/okvevo/*) return 0 ;;
    scripts/okvevo|scripts/okvevo/*) return 0 ;;
    brand|brand/*) return 0 ;;
    okvevo|okvevo/*) return 0 ;;
    plugin-catalog|plugin-catalog/*) return 0 ;;
    PRE-LIVE-BACKLOG.md) return 0 ;;
    ENVIRONMENT.md) return 0 ;;
    package-lock.json) return 0 ;;
    .github/workflows/okvevo-*.yml) return 0 ;;
    .cursor|.cursor/*) return 0 ;;
    *) return 1 ;;
  esac
}

drift=()
while IFS= read -r f; do
  f="${f#\"}"
  f="${f%\"}"
  [ -z "$f" ] && continue
  if is_owned "$f"; then
    continue
  fi
  drift+=("$f")
done < <(git -c core.quotepath=false diff --name-only "$TAG" --)

if [ "${#drift[@]}" -gt 0 ]; then
  echo "Upstream drift vs $TAG (not in OkVevo-owned exclude list):" >&2
  printf '  %s\n' "${drift[@]}" >&2
  exit 1
fi

python3 - "$TAG" <<'PY'
import re
import subprocess
import sys
from pathlib import Path

tag = sys.argv[1]
root = Path(".")
md = (root / "docs/okvevo/PATCHES.md").read_text(encoding="utf-8")
failed = 0
# Reason-less entries listed before PR 1.2 (10 installer + 273 desktop; 3 left
# the list in PR 1.2 when they matched upstream again). Lower it, never raise. Do not
# backfill; every entry added since carries "— reason". ponytail: a count
# ceiling, not per-path history; a reason-less swap of one path for another
# passes. Upgrade path: pin the grandfathered paths in a baseline file.
GRANDFATHERED = 283


def git_names(prefix: str) -> list[str]:
    out = subprocess.check_output(
        ["git", "-c", "core.quotepath=false", "diff", "--name-only", tag, "--", prefix],
        text=True,
    )
    return sorted(line.strip().strip('"') for line in out.splitlines() if line.strip())


def patches_entries(section: str) -> dict[str, str]:
    start = f"<!-- okvevo-delta:{section} -->"
    end = f"<!-- /okvevo-delta:{section} -->"
    i = md.find(start)
    j = md.find(end)
    if i < 0 or j < 0 or j <= i:
        raise SystemExit(f"PATCHES.md missing {start} … {end}")
    block = md[i + len(start) : j]
    entries: dict[str, str] = {}
    for line in block.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^- `([^`]+)`(?:\s+—\s+(\S.*))?$", line)
        if not m:
            raise SystemExit(f"PATCHES.md {section}: expected '- `path`' or '- `path` — reason', got {line!r}")
        entries[m.group(1)] = m.group(2) or ""
    return entries


reasonless = 0
counts = {}
for section in ("apps/bootstrap-installer", "apps/desktop"):
    live = git_names(section)
    entries = patches_entries(section)
    reasonless += sum(1 for reason in entries.values() if not reason)
    extra = [p for p in live if p not in entries]
    missing = [p for p in entries if p not in live]
    counts[section] = live
    if extra or missing:
        failed = 1
        print(f"UI/packaging delta mismatch for {section} vs {tag}:", file=sys.stderr)
        for p in extra:
            print(f"  extra (in git, not PATCHES.md): {p}  — add '- `{p}` — <reason>'", file=sys.stderr)
        for p in missing:
            print(f"  missing (in PATCHES.md, not git): {p}", file=sys.stderr)
    else:
        print(f"{section}: {len(live)} files match PATCHES.md")

if reasonless > GRANDFATHERED:
    failed = 1
    print(
        f"PATCHES.md has {reasonless} entries without a reason (cap {GRANDFATHERED}). "
        "New entries must read '- `path` — one-line reason'.",
        file=sys.stderr,
    )

desktop = counts["apps/desktop"]
on_tag = set(subprocess.check_output(
    ["git", "-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", tag, "--", "apps/desktop"], text=True,
).splitlines())
patched = sum(1 for p in desktop if p in on_tag)
other = [p for p in git_names(".") if not p.startswith(("apps/desktop/", "apps/bootstrap-installer/"))]
print(
    f"Patch budget vs {tag}: desktop {len(desktop)} ({patched} upstream files patched, "
    f"{len(desktop) - patched} OkVevo-new), installer {len(counts['apps/bootstrap-installer'])}, "
    f"other {len(other)} (OkVevo-owned paths)"
)

if failed:
    raise SystemExit(1)
print(f"No upstream drift vs {tag} outside OkVevo-owned paths.")
PY
