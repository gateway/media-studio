#!/usr/bin/env bash
set -euo pipefail

KIE_AFFILIATE_URL="https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
DEFAULT_LOCAL_OPENAI_BASE_URL="http://127.0.0.1:8080/v1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_ROOT="${MEDIA_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="$MEDIA_ROOT/.env"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
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

open_terminal_command() {
  local command="$1"
  osascript <<OSA >/dev/null
tell application "Terminal"
  activate
  do script "cd \"$MEDIA_ROOT\"; $command"
end tell
OSA
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
echo "This script will:"
echo " - bootstrap the shared KIE API dependency"
echo " - create or reuse the shared Python runtime"
echo " - create .env and a clean local database"
echo " - prompt for your KIE API key and optional enhancement providers"
echo

"$SCRIPT_DIR/bootstrap_local.sh"

echo
echo "Live image and video generation requires a KIE API key."
echo "Get one here: $KIE_AFFILIATE_URL"
echo "Press Enter without a key if you want to stay in offline mode for now."
echo

prompt_secret "Paste your KIE API key" "KIE_API_KEY"

if [[ -n "$(env_value KIE_API_KEY)" ]]; then
  upsert_env "MEDIA_ENABLE_LIVE_SUBMIT" "true"
else
  upsert_env "MEDIA_ENABLE_LIVE_SUBMIT" "false"
fi

echo
echo "Optional prompt enhancement providers"
echo " - OpenRouter: hosted prompt enhancement"
echo " - Local OpenAI-compatible endpoint: local enhancement stack"
echo

prompt_secret "Optional OpenRouter API key" "OPENROUTER_API_KEY"

current_local_base="$(env_value MEDIA_LOCAL_OPENAI_BASE_URL)"
if [[ -z "$current_local_base" ]]; then
  current_local_base="$DEFAULT_LOCAL_OPENAI_BASE_URL"
fi
read -r -p "Local OpenAI-compatible base URL [$current_local_base]: " local_base
if [[ -n "$local_base" ]]; then
  upsert_env "MEDIA_LOCAL_OPENAI_BASE_URL" "$local_base"
fi

prompt_secret "Optional local OpenAI-compatible API key" "MEDIA_LOCAL_OPENAI_API_KEY"

echo
echo "Current setup summary"
echo " - KIE API key: $( [[ -n "$(env_value KIE_API_KEY)" ]] && echo configured || echo missing )"
echo " - Live submit: $( [[ "$(env_value MEDIA_ENABLE_LIVE_SUBMIT)" == "true" ]] && echo enabled || echo offline )"
echo " - OpenRouter: $( [[ -n "$(env_value OPENROUTER_API_KEY)" ]] && echo configured || echo skipped )"
echo " - Local OpenAI base URL: $(env_value MEDIA_LOCAL_OPENAI_BASE_URL)"
echo
echo "Next commands"
echo " - API: npm run dev:api"
echo " - Web: npm run dev:web"
echo " - Setup page: http://127.0.0.1:3000/setup"
echo

read -r -p "Open the API and web commands in new Terminal windows now? [y/N]: " launch_now
if [[ "$launch_now" =~ ^[Yy]$ ]]; then
  open_terminal_command "npm run dev:api"
  open_terminal_command "npm run dev:web"
  echo "Opening Terminal windows for the API and web app."
fi
