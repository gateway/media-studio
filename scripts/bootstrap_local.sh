#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
KIE_REPO_URL="${KIE_REPO_URL:-https://github.com/gateway/kie-api.git}"
KIE_ROOT="$(resolve_kie_root "$MEDIA_ROOT")"
VENV_PY="$KIE_ROOT/.venv/bin/python"
VENV_PIP="$KIE_ROOT/.venv/bin/pip"
UPDATE_EXISTING_KIE_API="${MEDIA_STUDIO_UPDATE_KIE_API:-ask}"

echo "Media Studio root: $MEDIA_ROOT"
echo "KIE repo path: $KIE_ROOT"

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

if [[ ! -d "$KIE_ROOT/.git" && ! -f "$KIE_ROOT/pyproject.toml" ]]; then
  echo "Cloning KIE API repo from $KIE_REPO_URL ..."
  git clone "$KIE_REPO_URL" "$KIE_ROOT"
fi

if kie_repo_is_git_checkout "$KIE_ROOT"; then
  if kie_repo_refresh_remote "$KIE_ROOT"; then
    declare -A KIE_STATUS=()
    while IFS='=' read -r key value; do
      [[ -n "$key" ]] || continue
      KIE_STATUS["$key"]="$value"
    done < <(kie_repo_status_summary "$KIE_ROOT")

    if [[ "${KIE_STATUS[state]:-}" == "ok" && "${KIE_STATUS[behind]:-0}" != "0" ]]; then
      echo "Existing kie-api checkout is behind ${KIE_STATUS[upstream]:-origin} by ${KIE_STATUS[behind]} commit(s)."
      if [[ "${KIE_STATUS[dirty]:-false}" == "true" ]]; then
        echo "Local kie-api changes are present, so bootstrap will not update it automatically."
        echo "Update it manually when ready:"
        echo "  git -C \"$KIE_ROOT\" fetch --prune origin && git -C \"$KIE_ROOT\" pull --ff-only"
      else
        should_update="false"
        case "$UPDATE_EXISTING_KIE_API" in
          true|yes|1)
            should_update="true"
            ;;
          false|no|0)
            should_update="false"
            ;;
          ask|*)
            if [[ -t 0 ]] && prompt_yes_no "Update existing kie-api checkout now?" "Y"; then
              should_update="true"
            fi
            ;;
        esac
        if [[ "$should_update" == "true" ]]; then
          echo "Updating kie-api checkout..."
          kie_repo_update_ff_only "$KIE_ROOT"
        else
          echo "Keeping the current kie-api checkout."
          echo "You can update it later with:"
          echo "  git -C \"$KIE_ROOT\" fetch --prune origin && git -C \"$KIE_ROOT\" pull --ff-only"
        fi
      fi
    fi
  else
    echo "Warning: unable to refresh the kie-api remote state. Reusing the current checkout as-is."
  fi
fi

if [[ ! -x "$VENV_PY" ]]; then
  echo "Creating shared KIE virtualenv ..."
  python3 -m venv "$KIE_ROOT/.venv"
fi

echo "Installing shared Python dependencies ..."
"$VENV_PIP" install --upgrade pip setuptools wheel
"$VENV_PIP" install -e "$KIE_ROOT"
"$VENV_PIP" install -e "$MEDIA_ROOT/apps/api"

echo "Installing web dependencies ..."
(cd "$MEDIA_ROOT" && npm install --workspace apps/web --include-workspace-root=false)

mkdir -p "$MEDIA_ROOT/data/uploads" "$MEDIA_ROOT/data/downloads" "$MEDIA_ROOT/data/outputs" "$MEDIA_ROOT/data/preset-thumbnails"

if [[ ! -f "$MEDIA_ROOT/.env" ]]; then
  LOCAL_CONTROL_TOKEN="$(generate_media_studio_local_control_token)"
  cat > "$MEDIA_ROOT/.env" <<EOF
MEDIA_STUDIO_APP_ENV=development
NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL=
MEDIA_STUDIO_CONTROL_API_BASE_URL=
MEDIA_STUDIO_CONTROL_API_TOKEN=$LOCAL_CONTROL_TOKEN
MEDIA_STUDIO_ADMIN_USERNAME=
MEDIA_STUDIO_ADMIN_PASSWORD=
MEDIA_STUDIO_API_HOST=127.0.0.1
MEDIA_STUDIO_API_PORT=8000
MEDIA_STUDIO_WEB_HOST=127.0.0.1
MEDIA_STUDIO_WEB_PORT=3000
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
  echo "Created .env with local defaults and a unique control token."
fi

ensure_media_env_control_token "$MEDIA_ROOT" >/dev/null

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
echo "Run the web with:  ./scripts/dev_web.sh"
