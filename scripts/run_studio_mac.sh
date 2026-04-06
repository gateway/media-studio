#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
ensure_media_env_control_token "$MEDIA_ROOT" >/dev/null 2>&1 || true
ENV_API_PORT="${MEDIA_STUDIO_API_PORT:-}"
ENV_WEB_PORT="${MEDIA_STUDIO_WEB_PORT:-}"
load_media_env "$MEDIA_ROOT"

API_PORT="${ENV_API_PORT:-${MEDIA_STUDIO_API_PORT:-8000}}"
WEB_PORT="${ENV_WEB_PORT:-${MEDIA_STUDIO_WEB_PORT:-3000}}"
RUNTIME_DIR="$MEDIA_ROOT/data/runtime"
API_LOG="$RUNTIME_DIR/media-studio-api.log"
WEB_LOG="$RUNTIME_DIR/media-studio-web.log"
STUDIO_URL="http://127.0.0.1:$WEB_PORT/studio"
SETTINGS_URL="http://127.0.0.1:$WEB_PORT/settings"
API_HEALTH_URL="http://127.0.0.1:$API_PORT/health"

mkdir -p "$RUNTIME_DIR"
: >"$API_LOG"
: >"$WEB_LOG"

echo "Starting Media Studio in one Terminal window (production mode)..."
echo " - API: http://127.0.0.1:$API_PORT"
echo " - Web: http://127.0.0.1:$WEB_PORT"
echo " - Studio: $STUDIO_URL"
echo " - Settings: $SETTINGS_URL"
echo " - API log: $API_LOG"
echo " - Web log: $WEB_LOG"
echo
echo "The launcher will open your browser to Studio when the app is ready."
echo "To stop the app later, double-click Stop Media Studio.command."
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

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

wait_for_url() {
  local url="$1"
  local attempts="${2:-90}"
  local delay_seconds="${3:-1}"
  local attempt=0
  while (( attempt < attempts )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
  return 1
}

require_command curl
require_command open

bash "$SCRIPT_DIR/ensure_web_build.sh"

(
  cd "$MEDIA_ROOT"
  MEDIA_STUDIO_API_PORT="$API_PORT" ./scripts/start_api.sh
) >>"$API_LOG" 2>&1 &
API_PID=$!

(
  cd "$MEDIA_ROOT"
  MEDIA_STUDIO_WEB_PORT="$WEB_PORT" ./scripts/start_web.sh
) >>"$WEB_LOG" 2>&1 &
WEB_PID=$!

sleep 2

tail -n +1 -f "$API_LOG" "$WEB_LOG" &
TAIL_PID=$!

echo "Waiting for the API and Studio to become ready..."
if ! wait_for_url "$API_HEALTH_URL" 90 1; then
  echo
  echo "The Media Studio API did not become ready. Check:"
  echo " - $API_LOG"
  exit 1
fi
if ! wait_for_url "$STUDIO_URL" 90 1; then
  echo
  echo "The Media Studio web app did not become ready. Check:"
  echo " - $WEB_LOG"
  exit 1
fi

echo "Media Studio is ready."
open "$STUDIO_URL"

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
