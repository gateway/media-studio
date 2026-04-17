#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
CLI_WEB_HOST=""
CLI_WEB_PORT=""
CLI_API_HOST=""
CLI_API_PORT=""
CLI_CONTROL_API_BASE_URL=""

usage() {
  cat <<'EOF'
Usage: ./scripts/dev_web.sh [--host HOST] [--port PORT] [--api-host HOST] [--api-port PORT] [--control-api-base-url URL]
EOF
}

while (($# > 0)); do
  case "$1" in
    --host)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --host" >&2; exit 1; }
      CLI_WEB_HOST="$1"
      ;;
    --port)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --port" >&2; exit 1; }
      CLI_WEB_PORT="$1"
      ;;
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
    --control-api-base-url)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --control-api-base-url" >&2; exit 1; }
      CLI_CONTROL_API_BASE_URL="$1"
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

load_media_env "$MEDIA_ROOT"

WEB_HOST="${CLI_WEB_HOST:-${MEDIA_STUDIO_WEB_HOST:-127.0.0.1}}"
WEB_PORT="${CLI_WEB_PORT:-${MEDIA_STUDIO_WEB_PORT:-${PORT:-3000}}}"
API_HOST="${CLI_API_HOST:-${MEDIA_STUDIO_API_HOST:-127.0.0.1}}"
API_PORT="${CLI_API_PORT:-${MEDIA_STUDIO_API_PORT:-8000}}"
DERIVED_CONTROL_API_BASE_URL="$(media_control_api_base_url "$API_HOST" "$API_PORT")"
CONFIGURED_CONTROL_API_BASE_URL="${CLI_CONTROL_API_BASE_URL:-${MEDIA_STUDIO_CONTROL_API_BASE_URL:-${NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL:-}}}"
if [[ -z "$CONFIGURED_CONTROL_API_BASE_URL" || "$CONFIGURED_CONTROL_API_BASE_URL" == "http://127.0.0.1:8000" || "$CONFIGURED_CONTROL_API_BASE_URL" == "http://localhost:8000" ]]; then
  CONTROL_API_BASE_URL="$DERIVED_CONTROL_API_BASE_URL"
else
  CONTROL_API_BASE_URL="$CONFIGURED_CONTROL_API_BASE_URL"
fi

export MEDIA_STUDIO_WEB_HOST="$WEB_HOST"
export MEDIA_STUDIO_WEB_PORT="$WEB_PORT"
export MEDIA_STUDIO_API_HOST="$API_HOST"
export MEDIA_STUDIO_API_PORT="$API_PORT"
export MEDIA_STUDIO_CONTROL_API_BASE_URL="$CONTROL_API_BASE_URL"
export NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL="$CONTROL_API_BASE_URL"
export PORT="$WEB_PORT"
export NPM_CONFIG_FUND="${NPM_CONFIG_FUND:-false}"
export NPM_CONFIG_AUDIT="${NPM_CONFIG_AUDIT:-false}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cd "$MEDIA_ROOT"
cd "$MEDIA_ROOT/apps/web"
exec npm run dev -- --hostname "$WEB_HOST" --port "$WEB_PORT"
