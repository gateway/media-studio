#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_ROOT="${MEDIA_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
KIE_REPO_URL="${KIE_REPO_URL:-https://github.com/gateway/kie-api.git}"
DEFAULT_KIE_ROOT="$MEDIA_ROOT/../kie-api"
LEGACY_KIE_ROOT="$MEDIA_ROOT/../kie-ai/kie_codex_bootstrap"
if [[ -d "$DEFAULT_KIE_ROOT" ]]; then
  KIE_ROOT="${KIE_ROOT:-${MEDIA_STUDIO_KIE_API_REPO_PATH:-$DEFAULT_KIE_ROOT}}"
elif [[ -d "$LEGACY_KIE_ROOT" ]]; then
  KIE_ROOT="${KIE_ROOT:-${MEDIA_STUDIO_KIE_API_REPO_PATH:-$LEGACY_KIE_ROOT}}"
else
  KIE_ROOT="${KIE_ROOT:-${MEDIA_STUDIO_KIE_API_REPO_PATH:-$DEFAULT_KIE_ROOT}}"
fi
VENV_PY="$KIE_ROOT/.venv/bin/python"
VENV_PIP="$KIE_ROOT/.venv/bin/pip"

echo "Media Studio root: $MEDIA_ROOT"
echo "KIE repo path: $KIE_ROOT"

if [[ ! -d "$KIE_ROOT/.git" && ! -f "$KIE_ROOT/pyproject.toml" ]]; then
  echo "Cloning KIE API repo from $KIE_REPO_URL ..."
  git clone "$KIE_REPO_URL" "$KIE_ROOT"
fi

if [[ ! -x "$VENV_PY" ]]; then
  echo "Creating shared KIE virtualenv ..."
  python3 -m venv "$KIE_ROOT/.venv"
fi

echo "Installing shared Python dependencies ..."
"$VENV_PIP" install --upgrade pip setuptools wheel
"$VENV_PIP" install -e "$KIE_ROOT"
"$VENV_PIP" install -e "$MEDIA_ROOT/apps/api"
"$VENV_PIP" install fastapi "uvicorn[standard]" python-multipart httpx "pytest-asyncio>=0.23,<1.0"

echo "Installing web dependencies ..."
(cd "$MEDIA_ROOT" && npm install)

mkdir -p "$MEDIA_ROOT/data/uploads" "$MEDIA_ROOT/data/downloads" "$MEDIA_ROOT/data/outputs" "$MEDIA_ROOT/data/preset-thumbnails"

if [[ ! -f "$MEDIA_ROOT/.env" ]]; then
  cat > "$MEDIA_ROOT/.env" <<EOF
NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL=http://127.0.0.1:8000
MEDIA_STUDIO_CONTROL_API_BASE_URL=http://127.0.0.1:8000
MEDIA_STUDIO_CONTROL_API_TOKEN=media-studio-local-control-token
MEDIA_STUDIO_ADMIN_USERNAME=
MEDIA_STUDIO_ADMIN_PASSWORD=
MEDIA_STUDIO_API_HOST=127.0.0.1
MEDIA_STUDIO_API_PORT=8000
MEDIA_STUDIO_DB_PATH=$MEDIA_ROOT/data/media-studio.db
MEDIA_STUDIO_DATA_ROOT=$MEDIA_ROOT/data
MEDIA_STUDIO_KIE_API_REPO_PATH=$KIE_ROOT
MEDIA_STUDIO_SUPERVISOR=manual
MEDIA_ENABLE_LIVE_SUBMIT=false
MEDIA_BACKGROUND_POLL_ENABLED=true
MEDIA_POLL_SECONDS=6
MEDIA_PRICING_CACHE_HOURS=6
KIE_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
MEDIA_LOCAL_OPENAI_BASE_URL=http://127.0.0.1:8080/v1
MEDIA_LOCAL_OPENAI_API_KEY=
EOF
  echo "Created .env with local defaults."
fi

echo "Bootstrapping empty Media Studio schema ..."
MEDIA_STUDIO_DB_PATH="${MEDIA_STUDIO_DB_PATH:-$MEDIA_ROOT/data/media-studio.db}" \
MEDIA_STUDIO_DATA_ROOT="${MEDIA_STUDIO_DATA_ROOT:-$MEDIA_ROOT/data}" \
MEDIA_STUDIO_KIE_API_REPO_PATH="${MEDIA_STUDIO_KIE_API_REPO_PATH:-$KIE_ROOT}" \
"$VENV_PY" - <<'PY'
import os
import sys
from pathlib import Path

media_root = Path(os.environ["MEDIA_STUDIO_DATA_ROOT"]).resolve().parents[0]
repo_root = media_root.parent
sys.path.insert(0, str(repo_root / "apps" / "api"))

from app import store  # noqa: E402

store.bootstrap_schema()
print("Schema ready at:", os.environ["MEDIA_STUDIO_DB_PATH"])
PY

echo
echo "Bootstrap complete."
echo "Run the API with:  npm run dev:api"
echo "Run the web with:  npm run dev:web"
