#!/usr/bin/env bash
# Build the bundled agent payload before npm run build. Does not export
# HERMES_BUILD_COMMIT — that env would rename the app and change the bundle id.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$root"
if [[ ! "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "GITHUB_SHA must be a full 40-char commit" >&2
  exit 1
fi
unset HERMES_BUILD_COMMIT || true
if command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  PY=python
fi
"$PY" scripts/bundles/desktop.py --variant bundled --commit "$GITHUB_SHA" --prepare-only
"$PY" - <<'PY'
import json
from pathlib import Path

manifest = Path("apps/desktop/build/agent-payload/manifest.json")
ok = False
if manifest.is_file():
    data = json.loads(manifest.read_text(encoding="utf-8"))
    commands = (data.get("runtime") or {}).get("commands") or {}
    ok = bool(commands.get("hermes"))
if not ok:
    from scripts.bundles.native import finish_native
    raise SystemExit(finish_native(Path("apps/desktop/build/agent-payload.prepared.json"), {}))
PY
