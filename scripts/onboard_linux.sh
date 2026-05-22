#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
ENV_FILE="$MEDIA_ROOT/.env"
KIE_AFFILIATE_URL="https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
DEFAULT_LOCAL_OPENAI_BASE_URL="http://127.0.0.1:8080/v1"

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

configure_local_openai_provider() {
  local current_local_base
  current_local_base="$(env_value MEDIA_LOCAL_OPENAI_BASE_URL)"
  if [[ -z "$current_local_base" ]]; then
    current_local_base="$DEFAULT_LOCAL_OPENAI_BASE_URL"
  fi
  local local_base=""
  read -r -p "Local OpenAI-compatible base URL [$current_local_base]: " local_base
  if [[ -n "$local_base" ]]; then
    set_env_value "MEDIA_LOCAL_OPENAI_BASE_URL" "$local_base"
  elif [[ -z "$(env_value MEDIA_LOCAL_OPENAI_BASE_URL)" ]]; then
    set_env_value "MEDIA_LOCAL_OPENAI_BASE_URL" "$current_local_base"
  fi

  local local_api_key=""
  local_api_key="$(prompt_secret "Optional local OpenAI-compatible API key")"
  if [[ -n "$local_api_key" ]]; then
    set_env_value "MEDIA_LOCAL_OPENAI_API_KEY" "$local_api_key"
  fi
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
echo " - prompt for KIE, OpenRouter, and Local OpenAI setup"
echo " - check whether Codex Local is already ready on this machine"
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
echo "Optional LLM providers"
echo " - Codex Local: $(codex_local_status_label) (powers Enhance, recipe drafts, and graph prompt nodes)"
echo " - OpenRouter: hosted prompt enhancement and drafting"
echo " - Local OpenAI-compatible endpoint: self-hosted enhancement and drafting"
echo

if prompt_yes_no "Configure OpenRouter now? This is optional and can be set up later in Settings." "N"; then
  openrouter_key="$(prompt_secret "Optional OpenRouter API key")"
  if [[ -n "$openrouter_key" ]]; then
    set_env_value "OPENROUTER_API_KEY" "$openrouter_key"
  fi
else
  echo "Skipping OpenRouter setup. You can enable it later in Settings."
fi

if prompt_yes_no "Configure a local OpenAI-compatible endpoint now? This is optional and can be set up later in Settings." "N"; then
  configure_local_openai_provider
else
  echo "Skipping local OpenAI-compatible setup. You can enable it later in Settings."
fi

kie_status="missing"
if [[ -n "$(env_value KIE_API_KEY)" ]]; then
  kie_status="configured"
fi
live_status="offline"
if [[ "$(env_value MEDIA_ENABLE_LIVE_SUBMIT)" == "true" ]]; then
  live_status="enabled"
fi
openrouter_status="skipped"
if [[ -n "$(env_value OPENROUTER_API_KEY)" ]]; then
  openrouter_status="configured"
fi

echo
echo "Current setup summary"
echo " - KIE API key: $( [[ \"$kie_status\" == \"configured\" ]] && echo Ready || echo "Not set up" )"
echo " - Live submit: $( [[ \"$live_status\" == \"enabled\" ]] && echo Ready || echo "Not set up" )"
echo " - Codex Local: $( [[ \"$(codex_local_status_label)\" == \"ready\" ]] && echo Ready || ([[ \"$(codex_local_status_label)\" == \"login needed\" ]] && echo Connecting || echo "Not set up") )"
echo " - OpenRouter: $( [[ \"$openrouter_status\" == \"configured\" ]] && echo Ready || echo "Not set up" )"
echo " - Local OpenAI-compatible: $( [[ -n "$(env_value MEDIA_LOCAL_OPENAI_BASE_URL)" ]] && echo Connecting || echo "Not set up" )"
echo " - Local OpenAI base URL: $(env_value MEDIA_LOCAL_OPENAI_BASE_URL)"
echo
echo "Next commands"
echo " - Studio: ./scripts/run_studio_linux.sh"
echo " - Stop later: ./scripts/stop_studio_linux.sh"
echo " - Setup page: http://127.0.0.1:3000/setup"
echo " - AI settings: http://127.0.0.1:3000/settings/llms"
echo

if prompt_yes_no "Start Media Studio now in this terminal?" "N"; then
  cd "$MEDIA_ROOT"
  exec ./scripts/run_studio_linux.sh
fi
