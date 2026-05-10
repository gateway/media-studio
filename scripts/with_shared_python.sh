#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
load_media_env "$MEDIA_ROOT"
KIE_ROOT="$(resolve_kie_root "$MEDIA_ROOT")"

VENV_PY="$KIE_ROOT/.venv/bin/python"

if [[ ! -x "$VENV_PY" ]]; then
  echo "Shared Media Studio Python runtime not found at $VENV_PY" >&2
  echo "Run ./scripts/onboard_mac.sh, ./scripts/onboard_linux.sh, or scripts/onboard_windows.ps1 first." >&2
  exit 1
fi

exec "$VENV_PY" "$@"
