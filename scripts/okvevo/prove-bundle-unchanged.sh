#!/usr/bin/env bash
# After the packed app has been launched, fail if the bundle gained or changed a file.
set -euo pipefail

app="${1:-}"
stamp="${2:-}"
if [ -z "$app" ] || [ -z "$stamp" ] || [ ! -d "$app" ] || [ ! -f "$stamp" ]; then
  echo "usage: prove-bundle-unchanged.sh <OkVevo.app> <stamp-file>" >&2
  exit 2
fi

newer=$(find "$app" -newer "$stamp" -print)
if [ -n "$newer" ]; then
  echo "Bundle changed after launch:" >&2
  printf '%s\n' "$newer" >&2
  exit 1
fi
echo "Bundle unchanged after launch. No new or modified files, including __pycache__."
