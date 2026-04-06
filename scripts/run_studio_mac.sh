#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
load_media_env "$MEDIA_ROOT"

API_PORT="${MEDIA_STUDIO_API_PORT:-8000}"
WEB_PORT="${MEDIA_STUDIO_WEB_PORT:-3000}"
RUNTIME_DIR="$MEDIA_ROOT/data/runtime"
API_LOG="$RUNTIME_DIR/media-studio-api.log"
WEB_LOG="$RUNTIME_DIR/media-studio-web.log"

mkdir -p "$RUNTIME_DIR"
: >"$API_LOG"
: >"$WEB_LOG"

echo "Starting Media Studio in one Terminal window..."
echo " - API: http://127.0.0.1:$API_PORT"
echo " - Web: http://127.0.0.1:$WEB_PORT"
echo " - API log: $API_LOG"
echo " - Web log: $WEB_LOG"
echo
echo "Press Ctrl+C in this window to stop the local launcher."
echo "You can also use Stop Media Studio.command."
echo

cleanup() {
  if [[ -n "${TAIL_PID:-}" ]]; then
    kill "$TAIL_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

(
  cd "$MEDIA_ROOT"
  MEDIA_STUDIO_API_PORT="$API_PORT" ./scripts/dev_api.sh
) >>"$API_LOG" 2>&1 &
API_PID=$!

(
  cd "$MEDIA_ROOT"
  MEDIA_STUDIO_WEB_PORT="$WEB_PORT" ./scripts/dev_web.sh
) >>"$WEB_LOG" 2>&1 &
WEB_PID=$!

sleep 2

tail -n +1 -f "$API_LOG" "$WEB_LOG" &
TAIL_PID=$!

while true; do
  if ! kill -0 "$API_PID" >/dev/null 2>&1; then
    echo
    echo "The Media Studio API process exited. Check:"
    echo " - $API_LOG"
    exit 1
  fi
  if ! kill -0 "$WEB_PID" >/dev/null 2>&1; then
    echo
    echo "The Media Studio web process exited. Check:"
    echo " - $WEB_LOG"
    exit 1
  fi
  sleep 2
done
