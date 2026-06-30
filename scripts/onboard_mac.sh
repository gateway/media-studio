#!/usr/bin/env bash
set -euo pipefail

KIE_AFFILIATE_URL="https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
MEDIA_PREREQS_URL="https://github.com/gateway/media-studio/blob/main/docs/prerequisites.md"

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

normalize_secret_value() {
  python3 -c 'import sys; value = sys.stdin.read(); print(value.replace("\r", "").replace("\n", "").strip(), end="")'
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
  value="$(printf '%s' "$value" | normalize_secret_value)"
  if [[ -n "$value" ]]; then
    upsert_env "$key" "$value"
  fi
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

print_terminal_link() {
  local label="$1"
  local url="$2"
  printf '\033]8;;%s\033\\%s\033]8;;\033\\\n' "$url" "$label"
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
  echo "This onboarding flow is tuned for macOS. Use ./scripts/onboard_linux.sh on Linux or scripts/onboard_windows.ps1 on Windows." >&2
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
echo " - prepare the shared KIE dependency and Python runtime"
echo " - install runtime Python packages for kie-api and media-studio-api"
echo " - create or reuse .env, data folders, and the local database schema"
echo " - prompt for your KIE API key"
echo " - check whether Codex Local can be used as the default local AI provider"
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

echo
echo "Current setup summary"
echo " - KIE API key: $( [[ -n "$(env_value KIE_API_KEY)" ]] && echo Ready || echo "Not set up" )"
echo " - Live submit: $( [[ "$(env_value MEDIA_ENABLE_LIVE_SUBMIT)" == "true" ]] && echo Ready || echo "Not set up" )"
echo " - Codex Local: $( [[ "$(codex_local_status_label)" == "ready" ]] && echo Ready || ([[ "$(codex_local_status_label)" == "login needed" ]] && echo Connecting || echo "Not set up") )"
echo " - OpenRouter: Settings -> AI"
echo " - Local OpenAI-compatible: Settings -> AI"
echo
echo "Next steps"
echo " - Start later: Start Media Studio.command"
echo " - Stop later: Stop Media Studio.command"
echo " - Terminal launch: ./scripts/run_studio_mac.sh"
echo " - Configured Studio URL if the web port is free: http://127.0.0.1:$(web_port)/studio"
echo " - Configured settings URL if the web port is free: http://127.0.0.1:$(web_port)/settings"
echo " - Configured AI settings URL if the web port is free: http://127.0.0.1:$(web_port)/settings/llms"
echo " - Actual launch URL: printed by the launcher after it checks for free API and web ports"
echo
echo "For normal use, double-click Start Media Studio.command."
echo "It starts the API and web app together in one Terminal window in production mode."
echo "If ports 8000 or 3000 are busy, startup automatically selects temporary open ports for that launch."
echo "If your browser does not open automatically, use the actual Studio URL printed by the launcher."
echo

read -r -p "Launch Media Studio in this Terminal window now with automatic port selection? [y/N]: " launch_now
if [[ "$launch_now" =~ ^[Yy]$ ]]; then
  echo "Launching Media Studio in this Terminal window."
  echo "The launcher will check configured ports, select temporary open ports if needed, and print the actual Studio URL."
  "$SCRIPT_DIR/open_studio_mac.sh"
fi
