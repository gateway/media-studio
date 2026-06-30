#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This launcher is for macOS. Use the repo scripts directly on other platforms." >&2
  exit 1
fi

cd "$MEDIA_ROOT"
exec node "$SCRIPT_DIR/run_studio.mjs" --production --open "$@"
