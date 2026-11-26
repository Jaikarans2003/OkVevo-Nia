#!/usr/bin/env bash
# Deterministic coding smoke against a packed payload. No model calls.
# Scratch work stays outside the bundle.
set -euo pipefail

payload="${1:-}"
if [ -z "$payload" ] || [ ! -d "$payload/tools" ]; then
  echo "usage: b5-coding-smoke.sh <agent-payload>" >&2
  exit 2
fi

find_bin() {
  set +o pipefail
  find "$payload/tools" "$payload/bin" "$payload/venv" "$payload/../ffmpeg" \
    -type f \( -name "$1" -o -name "$1.exe" -o -name "$1.cmd" \) 2>/dev/null | head -1 || true
  set -o pipefail
}

python=$(set +o pipefail; find "$payload/venv" -type f \( -name python -o -name python.exe -o -name python3 \) 2>/dev/null | head -1 || true; set -o pipefail)
[ -n "$python" ] || python=$(find_bin python3)
[ -n "$python" ] || python=$(find_bin python)
uv=$(find_bin uv)
node=$(find_bin node)
npm=$(find_bin npm)
rg=$(find_bin rg)
ffmpeg=$(find_bin ffmpeg)
git_bin=$(find_bin git)
if [ -z "$git_bin" ]; then
  git_bin=$(command -v git || true)
  echo "git: system ($git_bin)"
else
  echo "git: bundle ($git_bin)"
fi

missing=()
[ -n "$python" ] || missing+=("python")
[ -n "$uv" ] || missing+=("uv")
[ -n "$node" ] || missing+=("node")
[ -n "$npm" ] || missing+=("npm")
[ -n "$rg" ] || missing+=("rg")
[ -n "$ffmpeg" ] || missing+=("ffmpeg")
[ -n "$git_bin" ] || missing+=("git")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "missing bundled tools: ${missing[*]}" >&2
  exit 1
fi

export PATH="$(dirname "$python"):$(dirname "$uv"):$(dirname "$node"):$(dirname "$npm"):$(dirname "$rg"):$(dirname "$ffmpeg"):$(dirname "$git_bin"):$PATH"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "python project"
(
  cd "$work"
  "$uv" init pyapp
  cd pyapp
  "$uv" add pytest
  printf 'def answer():\n    return 2\n' > app.py
  printf 'from app import answer\n\ndef test_answer():\n    assert answer() == 2\n' > test_app.py
  "$uv" run python app.py
  "$uv" run pytest -q
)

echo "node project"
(
  cd "$work"
  mkdir jsapp && cd jsapp
  "$npm" init -y >/dev/null
  "$npm" install left-pad --silent
  printf 'const { test } = require("node:test");\nconst assert = require("node:assert");\ntest("left pad", () => assert.equal(require("left-pad")("x", 3), "  x"));\n' > app.test.js
  "$node" --test
)

echo "git"
(
  cd "$work"
  mkdir repo && cd repo
  "$git_bin" init -q
  echo hi > file.txt
  "$git_bin" add file.txt
  "$git_bin" -c user.email="b5@okvevo.test" -c user.name="b5" commit -q -m "b5"
)

echo "rg and ffmpeg"
echo "needle-b5" > "$work/hay.txt"
"$rg" -q needle-b5 "$work/hay.txt"
"$ffmpeg" -version >/dev/null

echo "coding tool imports"
HERMES_HOME="$work/hermes" "$python" - <<PY
import importlib
for name in ("tools.terminal_tool", "tools.file_tools", "tools.code_execution_tool", "tools.process_registry"):
    importlib.import_module(name)
print("imported", 4)
PY

echo "hermes doctor"
repo="$payload/hermes-agent"
if [ ! -d "$repo" ]; then
  echo "payload has no hermes-agent tree" >&2
  exit 1
fi
# A blank home reports config findings (exit 1). A crash is exit 2 or higher.
set +e
HERMES_HOME="$work/hermes" PYTHONPATH="$repo" "$python" -c 'from hermes_cli.doctor import run_doctor; raise SystemExit(run_doctor(type("A", (), {"fix": False, "ack": None})()))'
doctor_status=$?
set -e
echo "hermes doctor exit $doctor_status"
if [ "$doctor_status" -gt 1 ]; then
  exit "$doctor_status"
fi
echo "b5 ok"
