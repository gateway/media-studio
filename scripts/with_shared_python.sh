#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_ROOT="${MEDIA_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DEFAULT_KIE_ROOT="$MEDIA_ROOT/../kie-api"
LEGACY_KIE_ROOT="$MEDIA_ROOT/../kie-ai/kie_codex_bootstrap"

if [[ -d "$DEFAULT_KIE_ROOT" ]]; then
  KIE_ROOT="${KIE_ROOT:-${MEDIA_STUDIO_KIE_API_REPO_PATH:-$DEFAULT_KIE_ROOT}}"
else
  KIE_ROOT="${KIE_ROOT:-${MEDIA_STUDIO_KIE_API_REPO_PATH:-$LEGACY_KIE_ROOT}}"
fi

VENV_PY="$KIE_ROOT/.venv/bin/python"

if [[ ! -x "$VENV_PY" ]]; then
  echo "Shared Media Studio Python runtime not found at $VENV_PY" >&2
  echo "Run ./scripts/bootstrap_local.sh first." >&2
  exit 1
fi

exec "$VENV_PY" "$@"
