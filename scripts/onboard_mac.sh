#!/usr/bin/env bash
set -euo pipefail

KIE_AFFILIATE_URL="https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
MEDIA_PREREQS_URL="https://github.com/gateway/media-studio/blob/main/docs/prerequisites.md"
DEFAULT_LOCAL_OPENAI_BASE_URL="http://127.0.0.1:8080/v1"
DEFAULT_OPENROUTER_ENHANCEMENT_MODEL="qwen/qwen3.5-35b-a3b"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"
ENV_FILE="$MEDIA_ROOT/.env"
KIE_ROOT="$(resolve_kie_root "$MEDIA_ROOT")"
VENV_PY="$KIE_ROOT/.venv/bin/python"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    if [[ "$cmd" == "npm" ]]; then
      echo "Install Node.js LTS from https://nodejs.org, then reopen Terminal and rerun this script." >&2
      echo "See prerequisites: $MEDIA_PREREQS_URL" >&2
      exit 1
    fi
    if [[ "$cmd" == "git" ]]; then
      echo "On macOS, run: xcode-select --install" >&2
      echo "See prerequisites: $MEDIA_PREREQS_URL" >&2
      exit 1
    fi
    if [[ "$cmd" == "python3" ]]; then
      echo "Install Python 3, then reopen Terminal and rerun this script." >&2
      echo "See prerequisites: $MEDIA_PREREQS_URL" >&2
      exit 1
    fi
    echo "See prerequisites: $MEDIA_PREREQS_URL" >&2
    exit 1
  fi
}

env_value() {
  local key="$1"
  python3 - "$ENV_FILE" "$key" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]
prefix = f"{key}="
if not env_path.exists():
    raise SystemExit(0)
for line in env_path.read_text().splitlines():
    if line.startswith(prefix):
        print(line[len(prefix):])
        break
PY
}

upsert_env() {
  local key="$1"
  local value="$2"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
prefix = f"{key}="
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
  local key="$2"
  local current
  current="$(env_value "$key")"
  if [[ -n "$current" ]]; then
    echo "$label is already configured. Press Enter to keep it, or paste a new value."
  fi
  local value
  IFS= read -r -s -p "$label: " value
  echo
  if [[ -n "$value" ]]; then
    upsert_env "$key" "$value"
  fi
}

read_secret_or_blank() {
  local label="$1"
  local value=""
  IFS= read -r -s -p "$label: " value
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

print_terminal_link() {
  local label="$1"
  local url="$2"
  printf '\033]8;;%s\033\\%s\033]8;;\033\\\n' "$url" "$label"
}

verify_openrouter_key() {
  local api_key="$1"
  local base_url="${2:-}"
  local result
  if [[ ! -x "$VENV_PY" ]]; then
    echo "OpenRouter verification skipped because the shared Python runtime is not ready." >&2
    return 1
  fi
  if ! result="$(
    "$VENV_PY" - "$MEDIA_ROOT" "$api_key" "$base_url" "$DEFAULT_OPENROUTER_ENHANCEMENT_MODEL" <<'PY'
import sys
from pathlib import Path

media_root = Path(sys.argv[1]).resolve()
api_key = sys.argv[2]
base_url = sys.argv[3].strip()
model_id = sys.argv[4]
sys.path.insert(0, str(media_root / "apps" / "api"))

from app import service  # noqa: E402

payload = {
    "provider_kind": "openrouter",
    "api_key": api_key,
    "selected_model_id": model_id,
    "require_images": False,
}
if base_url:
    payload["base_url"] = base_url

bundle = service.probe_enhancement_provider(payload)
selected = bundle.get("selected_model") or {}
print(selected.get("id") or "")
PY
  )"; then
    return 1
  fi
  if [[ "$result" != "$DEFAULT_OPENROUTER_ENHANCEMENT_MODEL" ]]; then
    echo "OpenRouter connected, but the recommended model was not available: $DEFAULT_OPENROUTER_ENHANCEMENT_MODEL" >&2
    return 1
  fi
  return 0
}

open_terminal_command() {
  local command="$1"
  osascript <<OSA >/dev/null
tell application "Terminal"
  activate
  do script "cd \"$MEDIA_ROOT\"; $command"
end tell
OSA
}

web_port() {
  local value
  value="$(env_value MEDIA_STUDIO_WEB_PORT)"
  if [[ -n "$value" ]]; then
    echo "$value"
  else
    echo "3000"
  fi
}

api_host() {
  local value
  value="$(env_value MEDIA_STUDIO_API_HOST)"
  if [[ -n "$value" ]]; then
    echo "$value"
  else
    echo "127.0.0.1"
  fi
}

api_port() {
  local value
  value="$(env_value MEDIA_STUDIO_API_PORT)"
  if [[ -n "$value" ]]; then
    echo "$value"
  else
    echo "8000"
  fi
}

port_available() {
  local host="$1"
  local port="$2"
  python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    sock.bind((host, port))
except OSError:
    raise SystemExit(1)
finally:
    sock.close()
PY
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This onboarding flow is tuned for macOS. Use ./scripts/bootstrap_local.sh on other platforms." >&2
  exit 1
fi

require_command git
require_command python3
require_command npm

echo
echo "Media Studio macOS onboarding"
echo "Workspace: $MEDIA_ROOT"
echo
echo "Prerequisites:"
echo " - Git"
echo " - Python 3"
echo " - Node.js LTS (includes npm)"
echo
echo "If you need help installing those first, see:"
print_terminal_link "Media Studio prerequisites" "$MEDIA_PREREQS_URL"
echo " - $MEDIA_PREREQS_URL"
echo
echo "This script will:"
echo " - bootstrap the shared KIE API dependency"
echo " - create or reuse the shared Python virtualenv"
echo " - install runtime Python packages for kie-api and media-studio-api"
echo " - create .env and a clean local database"
echo " - prompt for your Kie AI key and optional prompt enhancement"
echo

"$SCRIPT_DIR/bootstrap_local.sh"

echo
echo "Live image and video generation requires a Kie AI API key."
echo "Get one here:"
print_terminal_link "Kie.ai API Key" "$KIE_AFFILIATE_URL"
echo "If your Terminal does not make links clickable, copy this URL:"
echo " - $KIE_AFFILIATE_URL"
echo "Press Enter without a key if you want to stay in offline mode for now."
echo

prompt_secret "Paste your Kie AI API key" "KIE_API_KEY"

if [[ -n "$(env_value KIE_API_KEY)" ]]; then
  upsert_env "MEDIA_ENABLE_LIVE_SUBMIT" "true"
else
  upsert_env "MEDIA_ENABLE_LIVE_SUBMIT" "false"
fi

echo
echo "Optional prompt enhancement (you can set this up later in Settings)"
echo "Prompt enhancement rewrites or improves your text prompt before generation."
echo "You can skip this now and enable it later in Settings."
echo "Recommended hosted model: $DEFAULT_OPENROUTER_ENHANCEMENT_MODEL"
echo

if prompt_yes_no "Enable prompt enhancement now? This is optional and can be set up later in Settings." "N"; then
  echo "OpenRouter is used only for prompt enhancement. It is not required for image or video generation."
  echo "You can still skip this and enable it later in Settings."
  echo
  current_openrouter_key="$(env_value OPENROUTER_API_KEY)"
  openrouter_base_url="$(env_value OPENROUTER_BASE_URL)"
  if [[ -z "$openrouter_base_url" ]]; then
    openrouter_base_url="https://openrouter.ai/api/v1"
  fi
  while true; do
    local_prompt="Paste your OpenRouter API key"
    if [[ -n "$current_openrouter_key" ]]; then
      echo "An OpenRouter API key is already configured. Press Enter to keep it, or paste a new one."
      local_prompt="Paste a new OpenRouter API key"
    fi
    openrouter_key="$(read_secret_or_blank "$local_prompt")"
    if [[ -z "$openrouter_key" ]]; then
      if [[ -n "$current_openrouter_key" ]]; then
        echo "Keeping the existing OpenRouter API key."
      else
        echo "Skipping OpenRouter setup. You can enable it later in Settings."
      fi
      break
    fi
    echo "Verifying OpenRouter key against $DEFAULT_OPENROUTER_ENHANCEMENT_MODEL ..."
    if verify_openrouter_key "$openrouter_key" "$openrouter_base_url"; then
      upsert_env "OPENROUTER_API_KEY" "$openrouter_key"
      echo "OpenRouter key verified."
      echo "When you open Settings, the recommended hosted enhancement model is $DEFAULT_OPENROUTER_ENHANCEMENT_MODEL."
      break
    fi
    echo "OpenRouter verification failed."
    if ! prompt_yes_no "Try a different OpenRouter API key?" "Y"; then
      echo "Skipping OpenRouter setup. You can enable it later in Settings."
      break
    fi
  done
  current_local_base="$(env_value MEDIA_LOCAL_OPENAI_BASE_URL)"
  if [[ -z "$current_local_base" ]]; then
    current_local_base="$DEFAULT_LOCAL_OPENAI_BASE_URL"
  fi
  if prompt_yes_no "Configure a local OpenAI-compatible enhancement endpoint now?" "N"; then
    read -r -p "Local OpenAI-compatible base URL [$current_local_base]: " local_base
    if [[ -n "$local_base" ]]; then
      upsert_env "MEDIA_LOCAL_OPENAI_BASE_URL" "$local_base"
    fi
    prompt_secret "Optional local OpenAI-compatible API key" "MEDIA_LOCAL_OPENAI_API_KEY"
  else
    echo "Skipping local enhancement provider setup. You can add it later in Settings."
  fi
else
  echo "Skipping prompt enhancement setup. You can enable it later in Settings."
fi

echo
echo "Current setup summary"
echo " - KIE API key: $( [[ -n "$(env_value KIE_API_KEY)" ]] && echo configured || echo missing )"
echo " - Live submit: $( [[ "$(env_value MEDIA_ENABLE_LIVE_SUBMIT)" == "true" ]] && echo enabled || echo offline )"
echo " - OpenRouter: $( [[ -n "$(env_value OPENROUTER_API_KEY)" ]] && echo configured || echo skipped )"
echo " - Local OpenAI base URL: $(env_value MEDIA_LOCAL_OPENAI_BASE_URL)"
echo
echo "Next commands"
echo " - API: npm run dev:api"
echo " - Web: ./scripts/dev_web.sh"
echo " - App: http://127.0.0.1:$(web_port)/"
echo
echo "The launcher opens two Terminal windows because the API and the Next.js web app run as separate processes during local development."
echo

read -r -p "Open the API and web commands in new Terminal windows now? [y/N]: " launch_now
if [[ "$launch_now" =~ ^[Yy]$ ]]; then
  api_host_value="$(api_host)"
  api_port_value="$(api_port)"
  web_port_value="$(web_port)"
  api_can_start=true
  web_can_start=true

  if ! port_available "$api_host_value" "$api_port_value"; then
    api_can_start=false
    echo "API port $api_port_value on $api_host_value is already in use."
  fi
  if ! port_available "127.0.0.1" "$web_port_value"; then
    web_can_start=false
    echo "Web port $web_port_value is already in use."
  fi

  if [[ "$api_can_start" != true || "$web_can_start" != true ]]; then
    echo "Close the process using that port, or change MEDIA_STUDIO_API_PORT / MEDIA_STUDIO_WEB_PORT in .env, then rerun the launcher."
    exit 1
  fi

  open_terminal_command "npm run dev:api"
  open_terminal_command "./scripts/dev_web.sh"
  echo "Opening Terminal windows for the API and web app."
fi
