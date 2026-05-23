#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
ENV_FILE="$MEDIA_ROOT/.env"
CLI_API_PORT=""
CLI_WEB_PORT=""
CLI_API_PORT_SET=false
CLI_WEB_PORT_SET=false

usage() {
  cat <<'EOF'
Usage: ./scripts/open_studio_mac.sh [--api-port PORT] [--web-port PORT]
EOF
}

while (($# > 0)); do
  case "$1" in
    --api-port)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --api-port" >&2; exit 1; }
      CLI_API_PORT="$1"
      CLI_API_PORT_SET=true
      ;;
    --web-port)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --web-port" >&2; exit 1; }
      CLI_WEB_PORT="$1"
      CLI_WEB_PORT_SET=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

runtime_dir="$MEDIA_ROOT/data/runtime"
api_pid_file="$runtime_dir/media-studio-api.pid"
web_pid_file="$runtime_dir/media-studio-web.pid"
tail_pid_file="$runtime_dir/media-studio-tail.pid"
launcher_pid_file="$runtime_dir/media-studio-launcher.pid"

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

port_owner_cwd() {
  local port="$1"
  local pid
  pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | awk 'BEGIN{FS="n"} /^n/ {print $2; exit}'
}

looks_like_media_studio_process() {
  local command="$1"
  local cwd="$2"
  [[ "$command" == *"media-studio"* || "$command" == *"$MEDIA_ROOT"* || "$command" == *"app.main:app"* || "$command" == *"next dev"* || "$command" == *"next start"* || "$command" == *"next-server"* || "$cwd" == "$MEDIA_ROOT"* ]]
}

cleanup_stale_media_studio() {
  MEDIA_ROOT="$MEDIA_ROOT" \
  MEDIA_STUDIO_API_PORT="$API_PORT" \
  MEDIA_STUDIO_WEB_PORT="$WEB_PORT" \
  ./scripts/stop_studio_mac.sh >/dev/null 2>&1 || true
  rm -f "$api_pid_file" "$web_pid_file" "$tail_pid_file" "$launcher_pid_file"
  sleep 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This launcher is for macOS. Use the repo scripts directly on other platforms." >&2
  exit 1
fi

require_command open
require_command lsof
require_command python3

if [[ ! -f "$MEDIA_ROOT/.env" ]]; then
  echo "Missing .env in $MEDIA_ROOT" >&2
  echo "Run ./scripts/onboard_mac.sh first." >&2
  exit 1
fi

API_PORT="${CLI_API_PORT:-$(env_value MEDIA_STUDIO_API_PORT)}"
WEB_PORT="${CLI_WEB_PORT:-$(env_value MEDIA_STUDIO_WEB_PORT)}"

if [[ -z "$API_PORT" ]]; then
  API_PORT="8000"
fi
if [[ -z "$WEB_PORT" ]]; then
  WEB_PORT="3000"
fi

api_running=false
web_running=false
ports_changed=false

if port_is_listening "$API_PORT"; then
  api_owner="$(port_owner_command "$API_PORT")"
  api_cwd="$(port_owner_cwd "$API_PORT")"
  if ! looks_like_media_studio_process "$api_owner" "$api_cwd"; then
    if [[ "$CLI_API_PORT_SET" == true ]]; then
      echo "Port $API_PORT is already in use by another app:" >&2
      echo "  $api_owner" >&2
      echo "Choose a different API port or remove the explicit --api-port value." >&2
      exit 1
    fi
    original_api_port="$API_PORT"
    API_PORT="$(media_find_available_port "127.0.0.1" "$((API_PORT + 1))" "$WEB_PORT")"
    ports_changed=true
    echo "API port $original_api_port is already in use by another app; using $API_PORT for this launch."
    echo "  $api_owner"
  else
    api_running=true
  fi
fi

if port_is_listening "$WEB_PORT"; then
  web_owner="$(port_owner_command "$WEB_PORT")"
  web_cwd="$(port_owner_cwd "$WEB_PORT")"
  if ! looks_like_media_studio_process "$web_owner" "$web_cwd"; then
    if [[ "$CLI_WEB_PORT_SET" == true ]]; then
      echo "Port $WEB_PORT is already in use by another app:" >&2
      echo "  $web_owner" >&2
      echo "Choose a different web port or remove the explicit --web-port value." >&2
      exit 1
    fi
    original_web_port="$WEB_PORT"
    WEB_PORT="$(media_find_available_port "127.0.0.1" "$((WEB_PORT + 1))" "$API_PORT")"
    ports_changed=true
    echo "Web port $original_web_port is already in use by another app; using $WEB_PORT for this launch."
    echo "  $web_owner"
  else
    web_running=true
  fi
fi

if [[ "$ports_changed" == true ]]; then
  echo "The selected ports are temporary. To make them permanent, set MEDIA_STUDIO_API_PORT and MEDIA_STUDIO_WEB_PORT in .env."
  echo
fi

if [[ "$api_running" == true && "$web_running" == true ]]; then
  echo "Media Studio is already running."
  echo "Opening the browser to http://127.0.0.1:$WEB_PORT/studio ..."
  sleep 1
  open "http://127.0.0.1:$WEB_PORT/studio"
  exit 0
fi

if [[ "$api_running" == true || "$web_running" == true ]]; then
  echo "Media Studio looks partially started already."
  echo "Cleaning up the stale local processes and restarting..."
  cleanup_stale_media_studio
fi

cd "$MEDIA_ROOT"
run_args=()
if [[ "$CLI_API_PORT_SET" == true || "$ports_changed" == true ]]; then
  run_args+=(--api-port "$API_PORT")
fi
if [[ "$CLI_WEB_PORT_SET" == true || "$ports_changed" == true ]]; then
  run_args+=(--web-port "$WEB_PORT")
fi
exec ./scripts/run_studio_mac.sh "${run_args[@]}"
