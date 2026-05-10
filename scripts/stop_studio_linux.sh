#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$MEDIA_ROOT"
exec node "$SCRIPT_DIR/stop_studio.mjs" "$@"
