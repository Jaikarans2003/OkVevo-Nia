#!/usr/bin/env bash
# Make packaged Nia.app run THIS checkout's Python without a new DMG.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${P0_PYTHON:-$HOME/.hermes/hermes-agent/venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="python3"
fi
exec "$PYTHON" "$DIR/live_agent.py" bind
