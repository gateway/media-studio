#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/shared_env.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
load_media_env "$MEDIA_ROOT"

stop_port() {
  local port="$1"
  local pid
  pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  local command
  command="$(ps -p "$pid" -o command= || true)"
  if [[ "$command" == *"media-studio"* || "$command" == *"app.main:app"* || "$command" == *"next dev --hostname 127.0.0.1"* ]]; then
    kill "$pid" >/dev/null 2>&1 || true
  else
    echo "Skipping port $port because it is owned by another app:" >&2
    echo "  $command" >&2
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This stop helper is for macOS. Stop the app processes manually on other platforms." >&2
  exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
  echo "Missing required command: lsof" >&2
  exit 1
fi

API_PORT="${MEDIA_STUDIO_API_PORT:-8000}"
WEB_PORT="${MEDIA_STUDIO_WEB_PORT:-3000}"

stop_port "$WEB_PORT"
stop_port "$API_PORT"

pkill -f "app.main:app" >/dev/null 2>&1 || true
pkill -f "next dev --hostname 127.0.0.1" >/dev/null 2>&1 || true

echo "Media Studio stop signal sent for ports $WEB_PORT and $API_PORT."
