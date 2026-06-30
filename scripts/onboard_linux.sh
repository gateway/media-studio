#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
ENV_FILE="$MEDIA_ROOT/.env"
KIE_AFFILIATE_URL="https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
KIE_ROOT="$(resolve_kie_root "$MEDIA_ROOT")"
VENV_PY="$KIE_ROOT/.venv/bin/python"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

set_env_value() {
  local key="$1"
  local value="$2"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
prefix = key + "="
lines = env_path.read_text().splitlines() if env_path.exists() else []
for index, line in enumerate(lines):
    if line.startswith(prefix):
        lines[index] = prefix + value
        break
else:
    lines.append(prefix + value)
env_path.write_text("\n".join(lines).rstrip("\n") + "\n")
PY
}

prompt_secret() {
  local label="$1"
  local value=""
  read -r -s -p "$label: " value
  echo
  printf '%s' "$value"
}

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

codex_auth_path() {
  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  printf '%s/auth.json' "$codex_home"
}

codex_local_status_label() {
  if ! command -v codex >/dev/null 2>&1; then
    printf 'not installed'
    return
  fi
  if [[ -f "$(codex_auth_path)" ]]; then
    printf 'ready'
    return
  fi
  printf 'login needed'
}

configure_codex_local_defaults() {
  if [[ ! -x "$VENV_PY" ]]; then
    echo "Codex Local defaults skipped because the shared Python runtime is not ready." >&2
    return 1
  fi
  MEDIA_STUDIO_DB_PATH="$(env_value MEDIA_STUDIO_DB_PATH)" \
    MEDIA_STUDIO_DATA_ROOT="$(env_value MEDIA_STUDIO_DATA_ROOT)" \
    MEDIA_STUDIO_KIE_API_REPO_PATH="${MEDIA_STUDIO_KIE_API_REPO_PATH:-$KIE_ROOT}" \
    "$VENV_PY" "$SCRIPT_DIR/configure_codex_local_defaults.py" "$MEDIA_ROOT"
}

require_command git
require_command python3
require_command npm

echo
echo "Media Studio Linux onboarding"
echo "Workspace: $MEDIA_ROOT"
echo
echo "This script will:"
echo " - prepare the shared KIE dependency and Python runtime"
echo " - create or reuse .env, data folders, and the local database schema"
echo " - prompt for your KIE API key"
echo " - check whether Codex Local can be used as the default local AI provider"
echo

"$SCRIPT_DIR/bootstrap_local.sh"

echo
echo "Live image and video generation requires a KIE API key."
echo "Get one here: $KIE_AFFILIATE_URL"
echo "Press Enter without a key if you want to stay in offline mode for now."
echo

kie_key="$(prompt_secret "Paste your KIE API key")"
if [[ -n "$kie_key" ]]; then
  set_env_value "KIE_API_KEY" "$kie_key"
  set_env_value "MEDIA_ENABLE_LIVE_SUBMIT" "true"
elif [[ -z "$(env_value KIE_API_KEY)" ]]; then
  set_env_value "MEDIA_ENABLE_LIVE_SUBMIT" "false"
fi

echo
echo "Local AI provider"
echo "Codex Local powers prompt enhancement, Prompt Recipe drafting, Media Assistant, and graph prompt nodes when it is ready."
echo "Codex Local status: $(codex_local_status_label)"
if command -v codex >/dev/null 2>&1; then
  if [[ -f "$(codex_auth_path)" ]]; then
    echo " - Codex Local is ready on this machine."
  else
    echo " - Codex is installed, but you still need to run: codex login"
  fi
else
  echo " - Codex is not installed or not on PATH."
fi
echo

if [[ "$(codex_local_status_label)" == "ready" ]]; then
  if prompt_yes_no "Use Codex Local as the default AI provider now?" "Y"; then
    configure_codex_local_defaults
  else
    echo "Leaving AI provider defaults unchanged. You can choose a provider later in Settings -> AI."
  fi
else
  echo "Codex Local is not ready yet. Run 'codex login' after installing Codex, then open Settings -> AI."
fi
echo "OpenRouter and local OpenAI-compatible providers are optional advanced setup paths in Settings -> AI after launch."

kie_status="missing"
if [[ -n "$(env_value KIE_API_KEY)" ]]; then
  kie_status="configured"
fi
live_status="offline"
if [[ "$(env_value MEDIA_ENABLE_LIVE_SUBMIT)" == "true" ]]; then
  live_status="enabled"
fi

echo
echo "Current setup summary"
echo " - KIE API key: $( [[ "$kie_status" == "configured" ]] && echo Ready || echo "Not set up" )"
echo " - Live submit: $( [[ "$live_status" == "enabled" ]] && echo Ready || echo "Not set up" )"
codex_status="$(codex_local_status_label)"
echo " - Codex Local: $( [[ "$codex_status" == "ready" ]] && echo Ready || ([[ "$codex_status" == "login needed" ]] && echo Connecting || echo "Not set up") )"
echo " - OpenRouter: Settings -> AI"
echo " - Local OpenAI-compatible: Settings -> AI"
echo
echo "Next commands"
summary_web_port="$(env_value MEDIA_STUDIO_WEB_PORT)"
if [[ -z "$summary_web_port" ]]; then
  summary_web_port="3000"
fi
echo " - Studio: ./scripts/run_studio_linux.sh"
echo " - Stop later: ./scripts/stop_studio_linux.sh"
echo " - Configured setup page if the web port is free: http://127.0.0.1:$summary_web_port/setup"
echo " - Configured AI settings if the web port is free: http://127.0.0.1:$summary_web_port/settings/llms"
echo " - Actual launch URL: printed by the launcher after it checks for free API and web ports"
echo "If ports 8000 or 3000 are busy, startup automatically selects temporary open ports for that launch."
echo

if prompt_yes_no "Start Media Studio now in this terminal with automatic port selection?" "N"; then
  cd "$MEDIA_ROOT"
  exec ./scripts/run_studio_linux.sh
fi
