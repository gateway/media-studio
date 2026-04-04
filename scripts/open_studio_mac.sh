#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_ROOT="${MEDIA_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="$MEDIA_ROOT/.env"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

port_is_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

env_value() {
  local key="$1"
  python3 - "$ENV_FILE" "$key" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]
prefix = f"{key}="
if not env_path.exists():
    raise SystemExit(0)
for line in env_path.read_text().splitlines():
    if line.startswith(prefix):
        print(line[len(prefix):])
        break
PY
}

port_owner_command() {
  local port="$1"
  local pid
  pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  ps -p "$pid" -o command= || true
}

looks_like_media_studio_process() {
  local command="$1"
  [[ "$command" == *"media-studio"* || "$command" == *"app.main:app"* || "$command" == *"next dev --hostname 127.0.0.1"* ]]
}

open_terminal_command() {
  local command="$1"
  osascript <<OSA >/dev/null
tell application "Terminal"
  activate
  do script "cd \"$MEDIA_ROOT\"; $command"
end tell
OSA
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This launcher is for macOS. Use the repo scripts directly on other platforms." >&2
  exit 1
fi

require_command osascript
require_command open
require_command lsof
require_command python3

if [[ ! -f "$MEDIA_ROOT/.env" ]]; then
  echo "Missing .env in $MEDIA_ROOT" >&2
  echo "Run ./scripts/onboard_mac.sh first." >&2
  exit 1
fi

API_PORT="$(env_value MEDIA_STUDIO_API_PORT)"
WEB_PORT="$(env_value MEDIA_STUDIO_WEB_PORT)"

if [[ -z "$API_PORT" ]]; then
  API_PORT="8000"
fi
if [[ -z "$WEB_PORT" ]]; then
  WEB_PORT="3000"
fi

if port_is_listening "$API_PORT"; then
  api_owner="$(port_owner_command "$API_PORT")"
  if ! looks_like_media_studio_process "$api_owner"; then
    echo "Port $API_PORT is already in use by another app:" >&2
    echo "  $api_owner" >&2
    echo "Close that app or change MEDIA_STUDIO_API_PORT in .env, then try again." >&2
    exit 1
  fi
else
  open_terminal_command "MEDIA_STUDIO_API_PORT=$API_PORT ./scripts/dev_api.sh"
fi

if port_is_listening "$WEB_PORT"; then
  web_owner="$(port_owner_command "$WEB_PORT")"
  if ! looks_like_media_studio_process "$web_owner"; then
    echo "Port $WEB_PORT is already in use by another app:" >&2
    echo "  $web_owner" >&2
    echo "Close that app or change MEDIA_STUDIO_WEB_PORT in .env, then try again." >&2
    exit 1
  fi
else
  open_terminal_command "MEDIA_STUDIO_WEB_PORT=$WEB_PORT ./scripts/dev_web.sh"
fi

sleep 2
open "http://127.0.0.1:$WEB_PORT/"
