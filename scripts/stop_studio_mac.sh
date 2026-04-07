#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/shared_env.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
load_media_env "$MEDIA_ROOT"
RUNTIME_DIR="$MEDIA_ROOT/data/runtime"
API_PID_FILE="$RUNTIME_DIR/media-studio-api.pid"
WEB_PID_FILE="$RUNTIME_DIR/media-studio-web.pid"
TAIL_PID_FILE="$RUNTIME_DIR/media-studio-tail.pid"
LAUNCHER_PID_FILE="$RUNTIME_DIR/media-studio-launcher.pid"

kill_pid_and_children() {
  local pid="$1"
  local child
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    kill_pid_and_children "$child"
  done < <(pgrep -P "$pid" || true)
  kill "$pid" >/dev/null 2>&1 || true
  sleep 0.1
  kill -9 "$pid" >/dev/null 2>&1 || true
}

stop_pid_file() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi
  local pid
  pid="$(tr -d '[:space:]' <"$pid_file")"
  kill_pid_and_children "$pid"
  rm -f "$pid_file"
}

wait_for_port_clear() {
  local port="$1"
  local attempts="${2:-20}"
  local delay_seconds="${3:-0.2}"
  local attempt=0
  while (( attempt < attempts )); do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
  return 1
}

stop_port() {
  local port="$1"
  local pid
  pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  local command
  command="$(ps -p "$pid" -o command= || true)"
  if [[ -z "${command// }" ]]; then
    return 0
  fi
  if [[ "$command" == *"media-studio"* || "$command" == *"$MEDIA_ROOT"* || "$command" == *"app.main:app"* || "$command" == *"next dev"* || "$command" == *"next start"* ]]; then
    kill_pid_and_children "$pid"
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

echo "Stopping local Media Studio..."

stop_pid_file "$TAIL_PID_FILE"
stop_pid_file "$WEB_PID_FILE"
stop_pid_file "$API_PID_FILE"
stop_pid_file "$LAUNCHER_PID_FILE"
stop_port "$WEB_PORT"
stop_port "$API_PORT"

pkill -f "$MEDIA_ROOT/apps/api.*app.main:app" >/dev/null 2>&1 || true
pkill -f "$MEDIA_ROOT.*next start" >/dev/null 2>&1 || true
pkill -f "$MEDIA_ROOT.*next dev" >/dev/null 2>&1 || true
wait_for_port_clear "$WEB_PORT" || true
wait_for_port_clear "$API_PORT" || true

echo "Media Studio stopped for ports $WEB_PORT and $API_PORT."
