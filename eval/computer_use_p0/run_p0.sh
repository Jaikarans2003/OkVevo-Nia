#!/usr/bin/env bash
# One command: run the P0 computer-use suite on Mac against packaged Nia.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
PYTHON="${P0_PYTHON:-$HOME/.hermes/hermes-agent/venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="python3"
fi
if ! "$PYTHON" -c "import websockets" >/dev/null 2>&1; then
  "$PYTHON" -m pip install --user websockets
fi
exec "$PYTHON" "$DIR/run_p0.py" "$@"
