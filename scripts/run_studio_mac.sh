#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
KIE_ROOT="$(resolve_kie_root "$MEDIA_ROOT")"
CLI_API_HOST=""
CLI_API_PORT=""
CLI_WEB_HOST=""
CLI_WEB_PORT=""

usage() {
  cat <<'EOF'
Usage: ./scripts/run_studio_mac.sh [--api-host HOST] [--api-port PORT] [--web-host HOST] [--web-port PORT]
EOF
}

while (($# > 0)); do
  case "$1" in
    --api-host)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --api-host" >&2; exit 1; }
      CLI_API_HOST="$1"
      ;;
    --api-port)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --api-port" >&2; exit 1; }
      CLI_API_PORT="$1"
      ;;
    --web-host)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --web-host" >&2; exit 1; }
      CLI_WEB_HOST="$1"
      ;;
    --web-port)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --web-port" >&2; exit 1; }
      CLI_WEB_PORT="$1"
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

ensure_media_env_control_token "$MEDIA_ROOT" >/dev/null 2>&1 || true
ENV_API_HOST="${MEDIA_STUDIO_API_HOST:-}"
ENV_API_PORT="${MEDIA_STUDIO_API_PORT:-}"
ENV_WEB_HOST="${MEDIA_STUDIO_WEB_HOST:-}"
ENV_WEB_PORT="${MEDIA_STUDIO_WEB_PORT:-}"
ENV_DB_PATH="${MEDIA_STUDIO_DB_PATH:-}"
ENV_DATA_ROOT="${MEDIA_STUDIO_DATA_ROOT:-}"
load_media_env "$MEDIA_ROOT"

API_HOST="${CLI_API_HOST:-${ENV_API_HOST:-${MEDIA_STUDIO_API_HOST:-127.0.0.1}}}"
API_PORT="${CLI_API_PORT:-${ENV_API_PORT:-${MEDIA_STUDIO_API_PORT:-8000}}}"
WEB_HOST="${CLI_WEB_HOST:-${ENV_WEB_HOST:-${MEDIA_STUDIO_WEB_HOST:-127.0.0.1}}}"
WEB_PORT="${CLI_WEB_PORT:-${ENV_WEB_PORT:-${MEDIA_STUDIO_WEB_PORT:-3000}}}"
DB_PATH="${ENV_DB_PATH:-${MEDIA_STUDIO_DB_PATH:-$MEDIA_ROOT/data/media-studio.db}}"
DATA_ROOT="${ENV_DATA_ROOT:-${MEDIA_STUDIO_DATA_ROOT:-$MEDIA_ROOT/data}}"
BACKUP_DIR="$DATA_ROOT/backups"
WEB_ACCESS_HOST="$(media_runtime_access_host "$WEB_HOST")"
API_ACCESS_HOST="$(media_runtime_access_host "$API_HOST")"
RUNTIME_DIR="$MEDIA_ROOT/data/runtime"
API_LOG="$RUNTIME_DIR/media-studio-api.log"
WEB_LOG="$RUNTIME_DIR/media-studio-web.log"
API_PID_FILE="$RUNTIME_DIR/media-studio-api.pid"
WEB_PID_FILE="$RUNTIME_DIR/media-studio-web.pid"
TAIL_PID_FILE="$RUNTIME_DIR/media-studio-tail.pid"
LAUNCHER_PID_FILE="$RUNTIME_DIR/media-studio-launcher.pid"
STUDIO_URL="http://$WEB_ACCESS_HOST:$WEB_PORT/studio"
SETTINGS_URL="http://$WEB_ACCESS_HOST:$WEB_PORT/settings"
API_HEALTH_URL="http://$API_ACCESS_HOST:$API_PORT/health"
WEB_READY_URL="http://$WEB_ACCESS_HOST:$WEB_PORT/icon.svg"
UPDATE_EXISTING_KIE_API="${MEDIA_STUDIO_UPDATE_KIE_API:-ask}"

mkdir -p "$RUNTIME_DIR"
: >"$API_LOG"
: >"$WEB_LOG"
echo "$$" >"$LAUNCHER_PID_FILE"

echo "Starting Media Studio in one Terminal window (production mode)..."
echo " - API: http://127.0.0.1:$API_PORT"
echo " - Web: http://127.0.0.1:$WEB_PORT"
echo " - Studio: $STUDIO_URL"
echo " - Settings: $SETTINGS_URL"
echo " - API log: $API_LOG"
echo " - Web log: $WEB_LOG"
echo " - Data root: $DATA_ROOT"
echo
echo "Local Studio data under ./data is persistent user content and is never cleaned by this launcher."
echo "Do not run blanket cleanup commands like 'git clean -fd' in this repo."
echo
echo "The launcher will open your browser to Studio when the app is ready."
echo "To stop the app later, double-click Stop Media Studio.command."
echo "Press Ctrl+C in this window to stop the local launcher."
echo "You can also use Stop Media Studio.command."
echo

cleanup() {
  kill_tree() {
    local pid="$1"
    local child
    if [[ -z "$pid" ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    while IFS= read -r child; do
      [[ -n "$child" ]] || continue
      kill_tree "$child"
    done < <(pgrep -P "$pid" || true)
    kill "$pid" >/dev/null 2>&1 || true
    sleep 0.1
    kill -9 "$pid" >/dev/null 2>&1 || true
  }
  if [[ -n "${TAIL_PID:-}" ]]; then
    kill_tree "$TAIL_PID"
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill_tree "$WEB_PID"
  fi
  if [[ -n "${API_PID:-}" ]]; then
    kill_tree "$API_PID"
  fi
  rm -f "$API_PID_FILE" "$WEB_PID_FILE" "$TAIL_PID_FILE" "$LAUNCHER_PID_FILE"
}

trap cleanup EXIT INT TERM HUP

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
  MEDIA_STUDIO_API_PORT="$API_PORT" \
  MEDIA_STUDIO_WEB_PORT="$WEB_PORT" \
  ./scripts/stop_studio_mac.sh >/dev/null 2>&1 || true
  rm -f "$API_PID_FILE" "$WEB_PID_FILE" "$TAIL_PID_FILE" "$LAUNCHER_PID_FILE"
  sleep 1
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
require_command lsof
require_command python3

prompt_yes_no() {
  local label="$1"
  local default_answer="${2:-N}"
  local reply=""
  read -r -p "$label [$default_answer]: " reply
  if [[ -z "$reply" ]]; then
    reply="$default_answer"
  fi
  [[ "$reply" =~ ^[Yy]$ ]]
}

print_kie_upgrade_banner() {
  local message="$1"
  echo "************************************************************"
  echo "********** KIE-API UPDATE AVAILABLE ***********************"
  echo "************************************************************"
  echo "$message"
  echo "************************************************************"
}

kie_repo_preflight() {
  if ! kie_repo_is_git_checkout "$KIE_ROOT"; then
    return 0
  fi

  if ! kie_repo_refresh_remote "$KIE_ROOT"; then
    echo "Warning: unable to check whether kie-api is up to date with GitHub."
    echo "Reusing the current kie-api checkout at: $KIE_ROOT"
    echo
    return 0
  fi

  local kie_state=""
  local kie_behind="0"
  local kie_dirty="false"
  local kie_upstream="origin"
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    case "$key" in
      state) kie_state="$value" ;;
      behind) kie_behind="$value" ;;
      dirty) kie_dirty="$value" ;;
      upstream) kie_upstream="$value" ;;
    esac
  done < <(kie_repo_status_summary "$KIE_ROOT")

  if [[ "$kie_state" != "ok" || "$kie_behind" == "0" ]]; then
    return 0
  fi

  print_kie_upgrade_banner "Local kie-api checkout is behind $kie_upstream by $kie_behind commit(s)."
  if [[ "$kie_dirty" == "true" ]]; then
    echo "Local kie-api changes are present, so startup will not try to update it."
    echo "Update it manually when ready:"
    echo "  git -C \"$KIE_ROOT\" fetch --prune origin && git -C \"$KIE_ROOT\" pull --ff-only"
    echo
    return 0
  fi

  local should_update="false"
  case "$UPDATE_EXISTING_KIE_API" in
    true|yes|1|always)
      should_update="true"
      ;;
    false|no|0|never)
      should_update="false"
      ;;
    ask|*)
      if [[ -t 0 ]]; then
        echo "A newer kie-api checkout usually means newer models, specs, and runtime fixes."
        if prompt_yes_no "Update kie-api now before starting Studio?" "Y"; then
          should_update="true"
        fi
      else
        echo "Startup is non-interactive, so Studio will keep the current kie-api checkout."
      fi
      ;;
  esac

  if [[ "$should_update" == "true" ]]; then
    echo "Updating kie-api checkout..."
    if kie_repo_update_ff_only "$KIE_ROOT"; then
      echo "kie-api updated successfully."
    else
      echo "Warning: kie-api update failed. Studio will continue with the current checkout."
    fi
  else
    echo "Keeping the current kie-api checkout."
    echo "You can update it later with:"
    echo "  git -C \"$KIE_ROOT\" fetch --prune origin && git -C \"$KIE_ROOT\" pull --ff-only"
  fi
  echo
}

migration_preflight() {
  if [[ ! -f "$DB_PATH" ]]; then
    return 0
  fi

  local status_json
  if ! status_json="$(MEDIA_STUDIO_DB_PATH="$DB_PATH" MEDIA_STUDIO_DATA_ROOT="$DATA_ROOT" "$SCRIPT_DIR/migration_status.sh" --db "$DB_PATH")"; then
    echo "Unable to inspect Media Studio migration status for $DB_PATH." >&2
    echo "Refusing to start automatically because startup safety checks failed." >&2
    exit 1
  fi

  local pending_count
  pending_count="$(python3 - "$status_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
print(len(payload.get("pending_migrations", [])))
PY
)"
  local user_schema_present
  user_schema_present="$(python3 - "$status_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
print("true" if payload.get("user_schema_present") else "false")
PY
)"

  if [[ "$user_schema_present" != "true" || "$pending_count" == "0" ]]; then
    return 0
  fi

  echo "Detected $pending_count pending database migration(s) for an existing Media Studio install."
  echo "Creating a safety backup before startup..."
  local backup_output
  if ! backup_output="$(MEDIA_STUDIO_DB_PATH="$DB_PATH" MEDIA_STUDIO_DATA_ROOT="$DATA_ROOT" "$SCRIPT_DIR/backup_db.sh" --source "$DB_PATH" --backup-dir "$BACKUP_DIR")"; then
    echo "Automatic database backup failed. Startup aborted to avoid unsafe migration." >&2
    exit 1
  fi
  echo "$backup_output"
  export MEDIA_AUTO_BACKUP_BEFORE_MIGRATION=0
  echo "Backup complete. Continuing with startup."
  echo
}

api_running=false
web_running=false

if port_is_listening "$API_PORT"; then
  api_owner="$(port_owner_command "$API_PORT")"
  api_cwd="$(port_owner_cwd "$API_PORT")"
  if ! looks_like_media_studio_process "$api_owner" "$api_cwd"; then
    echo "Port $API_PORT is already in use by another app:" >&2
    echo "  $api_owner" >&2
    echo "Choose a different API port with --api-port or update MEDIA_STUDIO_API_PORT in .env." >&2
    exit 1
  fi
  api_running=true
fi

if port_is_listening "$WEB_PORT"; then
  web_owner="$(port_owner_command "$WEB_PORT")"
  web_cwd="$(port_owner_cwd "$WEB_PORT")"
  if ! looks_like_media_studio_process "$web_owner" "$web_cwd"; then
    echo "Port $WEB_PORT is already in use by another app:" >&2
    echo "  $web_owner" >&2
    echo "Choose a different web port with --web-port or update MEDIA_STUDIO_WEB_PORT in .env." >&2
    exit 1
  fi
  web_running=true
fi

if [[ "$api_running" == true || "$web_running" == true ]]; then
  echo "Media Studio looks partially started already."
  echo "Cleaning up the stale local processes and restarting..."
  cleanup_stale_media_studio
fi

kie_repo_preflight
migration_preflight

echo "Checking the production web build..."
bash "$SCRIPT_DIR/ensure_web_build.sh"

echo "Starting the Media Studio API..."
(
  cd "$MEDIA_ROOT"
  MEDIA_STUDIO_API_HOST="$API_HOST" MEDIA_STUDIO_API_PORT="$API_PORT" ./scripts/start_api.sh --host "$API_HOST" --port "$API_PORT"
) >>"$API_LOG" 2>&1 &
API_PID=$!
echo "$API_PID" >"$API_PID_FILE"

echo "Starting the Media Studio web app..."
(
  cd "$MEDIA_ROOT"
  MEDIA_STUDIO_API_HOST="$API_HOST" MEDIA_STUDIO_API_PORT="$API_PORT" MEDIA_STUDIO_WEB_HOST="$WEB_HOST" MEDIA_STUDIO_WEB_PORT="$WEB_PORT" ./scripts/start_web.sh --api-host "$API_HOST" --api-port "$API_PORT" --host "$WEB_HOST" --port "$WEB_PORT"
) >>"$WEB_LOG" 2>&1 &
WEB_PID=$!
echo "$WEB_PID" >"$WEB_PID_FILE"

sleep 2

tail -n +1 -f "$API_LOG" "$WEB_LOG" &
TAIL_PID=$!
echo "$TAIL_PID" >"$TAIL_PID_FILE"

echo "Waiting for the API and Studio to become ready..."
if ! wait_for_url "$API_HEALTH_URL" 90 1; then
  echo
  echo "The Media Studio API did not become ready. Check:"
  echo " - $API_LOG"
  exit 1
fi
if ! wait_for_url "$WEB_READY_URL" 90 1; then
  echo
  echo "The Media Studio web app did not become ready. Check:"
  echo " - $WEB_LOG"
  exit 1
fi

echo "Media Studio is ready."
echo "Opening your browser to $STUDIO_URL ..."
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
