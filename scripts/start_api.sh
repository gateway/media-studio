#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_ROOT="${MEDIA_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
KIE_ROOT="${KIE_ROOT:-${MEDIA_STUDIO_KIE_API_REPO_PATH:-$MEDIA_ROOT/../kie-ai/kie_codex_bootstrap}}"

if [[ -f "$MEDIA_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$MEDIA_ROOT/.env"
  set +a
fi

export MEDIA_STUDIO_KIE_API_REPO_PATH="${MEDIA_STUDIO_KIE_API_REPO_PATH:-$KIE_ROOT}"
export MEDIA_STUDIO_DB_PATH="${MEDIA_STUDIO_DB_PATH:-$MEDIA_ROOT/data/media-studio.db}"
export MEDIA_STUDIO_DATA_ROOT="${MEDIA_STUDIO_DATA_ROOT:-$MEDIA_ROOT/data}"
export MEDIA_STUDIO_API_HOST="${MEDIA_STUDIO_API_HOST:-127.0.0.1}"
export MEDIA_STUDIO_API_PORT="${MEDIA_STUDIO_API_PORT:-8000}"
export MEDIA_STUDIO_SUPERVISOR="${MEDIA_STUDIO_SUPERVISOR:-manual}"

exec "$KIE_ROOT/.venv/bin/python" -m uvicorn \
  app.main:app \
  --app-dir "$MEDIA_ROOT/apps/api" \
  --host "$MEDIA_STUDIO_API_HOST" \
  --port "$MEDIA_STUDIO_API_PORT"
