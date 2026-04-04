#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
ENV_KIE_ROOT="${MEDIA_STUDIO_KIE_API_REPO_PATH:-}"
ENV_DB_PATH="${MEDIA_STUDIO_DB_PATH:-}"
ENV_DATA_ROOT="${MEDIA_STUDIO_DATA_ROOT:-}"
ENV_API_HOST="${MEDIA_STUDIO_API_HOST:-}"
ENV_API_PORT="${MEDIA_STUDIO_API_PORT:-}"
ENV_SUPERVISOR="${MEDIA_STUDIO_SUPERVISOR:-}"
load_media_env "$MEDIA_ROOT"
KIE_ROOT="$(resolve_kie_root "$MEDIA_ROOT")"

export MEDIA_STUDIO_KIE_API_REPO_PATH="${ENV_KIE_ROOT:-${MEDIA_STUDIO_KIE_API_REPO_PATH:-$KIE_ROOT}}"
export MEDIA_STUDIO_DB_PATH="${ENV_DB_PATH:-${MEDIA_STUDIO_DB_PATH:-$MEDIA_ROOT/data/media-studio.db}}"
export MEDIA_STUDIO_DATA_ROOT="${ENV_DATA_ROOT:-${MEDIA_STUDIO_DATA_ROOT:-$MEDIA_ROOT/data}}"
export MEDIA_STUDIO_API_HOST="${ENV_API_HOST:-${MEDIA_STUDIO_API_HOST:-127.0.0.1}}"
export MEDIA_STUDIO_API_PORT="${ENV_API_PORT:-${MEDIA_STUDIO_API_PORT:-8000}}"
export MEDIA_STUDIO_SUPERVISOR="${ENV_SUPERVISOR:-${MEDIA_STUDIO_SUPERVISOR:-manual}}"

exec "$KIE_ROOT/.venv/bin/python" -m uvicorn \
  app.main:app \
  --app-dir "$MEDIA_ROOT/apps/api" \
  --host "$MEDIA_STUDIO_API_HOST" \
  --port "$MEDIA_STUDIO_API_PORT"
