#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
load_media_env "$MEDIA_ROOT"

WEB_HOST="${MEDIA_STUDIO_WEB_HOST:-127.0.0.1}"
export PORT="${MEDIA_STUDIO_WEB_PORT:-${PORT:-3000}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cd "$MEDIA_ROOT"
cd "$MEDIA_ROOT/apps/web"
exec npm run dev -- --hostname "$WEB_HOST" --port "$PORT"
