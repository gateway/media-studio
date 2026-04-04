#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
load_media_env "$MEDIA_ROOT"
KIE_ROOT="$(resolve_kie_root "$MEDIA_ROOT")"
VENV_PY="$KIE_ROOT/.venv/bin/python"
VENV_PIP="$KIE_ROOT/.venv/bin/pip"

if [[ ! -x "$VENV_PY" ]]; then
  echo "Shared kie-api venv not found at $VENV_PY"
  exit 1
fi

"$VENV_PIP" install -e "$KIE_ROOT"
"$VENV_PIP" install -e "$MEDIA_ROOT/apps/api"
"$VENV_PIP" install fastapi "uvicorn[standard]" python-multipart httpx "pytest-asyncio>=0.23,<1.0"

MEDIA_STUDIO_DB_PATH="${MEDIA_STUDIO_DB_PATH:-$MEDIA_ROOT/data/media-studio.db}" \
MEDIA_STUDIO_DATA_ROOT="${MEDIA_STUDIO_DATA_ROOT:-$MEDIA_ROOT/data}" \
MEDIA_STUDIO_KIE_API_REPO_PATH="${MEDIA_STUDIO_KIE_API_REPO_PATH:-$KIE_ROOT}" \
"$VENV_PY" - <<'PY'
import importlib.util
import os
import pathlib
import sys

print("python:", sys.executable)
print("kie_api:", bool(importlib.util.find_spec("kie_api")))
print("fastapi:", bool(importlib.util.find_spec("fastapi")))
db_path = pathlib.Path(os.environ["MEDIA_STUDIO_DB_PATH"])
data_root = pathlib.Path(os.environ["MEDIA_STUDIO_DATA_ROOT"])
data_root.mkdir(parents=True, exist_ok=True)
db_path.parent.mkdir(parents=True, exist_ok=True)
print("db_parent_writable:", os.access(str(db_path.parent), os.W_OK))
print("data_root_writable:", os.access(str(data_root), os.W_OK))
PY
