#!/usr/bin/env bash
set -euo pipefail

KIE_AFFILIATE_URL="https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
MEDIA_PREREQS_URL="https://github.com/gateway/media-studio/blob/main/docs/prerequisites.md"
DEFAULT_OPENROUTER_ENHANCEMENT_MODEL="qwen/qwen3.5-35b-a3b"
NANO_BANANA_ENHANCEMENT_SYSTEM_PROMPT="$(cat <<'EOF'
You are a prompt enhancer for Nano Banana Pro.

Your job is to transform the user’s raw request into one strong, production-ready Nano Banana Pro prompt that is clearer, more specific, and more visually controllable while staying faithful to the user’s actual intent.

Input placeholder:
{user_prompt}

Rules:
- Output ONLY the final enhanced prompt.
- Do not explain your reasoning.
- Do not add labels, bullets, headers, quotes, or markdown.
- Do not mention these instructions.
- Do not ask questions.
- Do not invent major story elements that change the user’s intent.
- Preserve all explicit user requirements exactly.
- If the user specifies text that must appear in the image, preserve it verbatim.
- If the user implies editing or preserving an existing image/reference, prioritize minimal necessary changes and strong preservation of identity, composition, style, branding, clothing, objects, and scene elements unless the user asks otherwise.
- When useful, rewrite vague asks into concrete visual directions.
- Keep the final prompt concise but rich enough to control output.

How to enhance:
1. Identify the core intent:
   - text-to-image
   - image edit
   - character consistency
   - product shot
   - typography / poster / infographic
   - UI / mockup
   - photoreal scene
   - illustration / stylized art
2. Rewrite the request into a clean visual brief using this priority:
   subject -> action/pose -> key objects -> environment/background -> composition/framing -> style/look -> lighting/color -> important constraints -> exact text/rendering instructions.
3. Add only useful specificity:
   - camera/framing for realistic scenes
   - layout/placement guidance for posters, infographics, covers, ads, and UI
   - preservation language for edits and references
   - material, texture, mood, and lighting cues when relevant
   - exact wording for any on-image text
4. Make the prompt unambiguous:
   - specify what should remain unchanged
   - specify what should be added, removed, or emphasized
   - avoid conflicting instructions
   - avoid filler words and hype
5. If the user request includes brand/logo/text accuracy needs, explicitly emphasize:
   - exact text rendering
   - correct spelling
   - clean layout
   - legible typography
   - no unwanted extra text
6. If the request is about editing an existing image, strongly prefer language like:
   - keep everything else the same
   - preserve original composition
   - preserve identity / outfit / pose / environment
   - make only the requested changes
7. If the request is about style consistency, explicitly anchor:
   - same character
   - same face
   - same outfit
   - same visual style
   - same overall design language
8. If the user is vague, choose sensible defaults without saying so:
   - visually clean
   - cohesive composition
   - high detail
   - intentional lighting
   - strong subject clarity

Output style:
- One single polished prompt paragraph.
- No preamble and no ending note.
- No negative prompt section unless the user explicitly asks for one.
- No parameter syntax unless the user explicitly requests parameters.

Now transform this user request into the best possible Nano Banana Pro prompt:
{user_prompt}
EOF
)"

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

read_secret_or_blank() {
  local label="$1"
  local value=""
  IFS= read -r -s -p "$label: " value
  printf '\n' >&2
  printf '%s' "$value" | normalize_secret_value
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

seed_default_openrouter_enhancement_configs() {
  local openrouter_base_url="$1"
  local db_path
  db_path="$(env_value MEDIA_STUDIO_DB_PATH)"
  if [[ -z "$db_path" || ! -x "$VENV_PY" ]]; then
    return 1
  fi

  MEDIA_STUDIO_DB_PATH="$db_path" "$VENV_PY" - "$db_path" "$openrouter_base_url" "$DEFAULT_OPENROUTER_ENHANCEMENT_MODEL" "$NANO_BANANA_ENHANCEMENT_SYSTEM_PROMPT" <<'PY'
from __future__ import annotations

import sqlite3
import sys
from datetime import datetime, timezone

db_path, base_url, model_id, system_prompt = sys.argv[1:5]


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_existing(connection: sqlite3.Connection, model_key: str):
    return connection.execute(
        "SELECT * FROM media_enhancement_configs WHERE model_key = ?",
        (model_key,),
    ).fetchone()


def upsert_config(connection: sqlite3.Connection, payload: dict[str, object]) -> None:
    columns = [
        "config_id",
        "model_key",
        "label",
        "helper_profile",
        "provider_kind",
        "provider_label",
        "provider_model_id",
        "provider_api_key",
        "provider_base_url",
        "provider_supports_images",
        "provider_status",
        "provider_last_tested_at",
        "provider_capabilities_json",
        "system_prompt",
        "image_analysis_prompt",
        "supports_text_enhancement",
        "supports_image_analysis",
        "created_at",
        "updated_at",
    ]
    placeholders = ", ".join("?" for _ in columns)
    assignments = ", ".join(f"{column} = excluded.{column}" for column in columns[2:])
    connection.execute(
        f"""
        INSERT INTO media_enhancement_configs ({", ".join(columns)})
        VALUES ({placeholders})
        ON CONFLICT(model_key) DO UPDATE SET {assignments}
        """,
        tuple(payload[column] for column in columns),
    )


connection = sqlite3.connect(db_path)
connection.row_factory = sqlite3.Row
now = utcnow_iso()

global_key = "__studio_enhancement__"
global_row = fetch_existing(connection, global_key)
global_created_at = global_row["created_at"] if global_row and global_row["created_at"] else now
global_payload = {
    "config_id": (global_row["config_id"] if global_row and global_row["config_id"] else "cfg-__studio_enhancement__"),
    "model_key": global_key,
    "label": (global_row["label"] if global_row and global_row["label"] else "Studio enhancement"),
    "helper_profile": (
        global_row["helper_profile"]
        if global_row and global_row["helper_profile"]
        else "midctx-64k-no-thinking-q3-prefill"
    ),
    "provider_kind": "openrouter",
    "provider_label": "OpenRouter.ai",
    "provider_model_id": model_id,
    "provider_api_key": global_row["provider_api_key"] if global_row and global_row["provider_api_key"] else None,
    "provider_base_url": base_url,
    "provider_supports_images": 0,
    "provider_status": "active",
    "provider_last_tested_at": now,
    "provider_capabilities_json": (
        global_row["provider_capabilities_json"]
        if global_row and global_row["provider_capabilities_json"]
        else "{}"
    ),
    "system_prompt": global_row["system_prompt"] if global_row and global_row["system_prompt"] else None,
    "image_analysis_prompt": (
        global_row["image_analysis_prompt"]
        if global_row and global_row["image_analysis_prompt"]
        else None
    ),
    "supports_text_enhancement": 1,
    "supports_image_analysis": 0,
    "created_at": global_created_at,
    "updated_at": now,
}
upsert_config(connection, global_payload)

for model_key, label in (
    ("nano-banana-2", "Nano Banana 2 enhancement"),
    ("nano-banana-pro", "Nano Banana Pro enhancement"),
):
    row = fetch_existing(connection, model_key)
    created_at = row["created_at"] if row and row["created_at"] else now
    payload = {
        "config_id": (row["config_id"] if row and row["config_id"] else f"cfg-{model_key}"),
        "model_key": model_key,
        "label": (row["label"] if row and row["label"] else label),
        "helper_profile": (
            row["helper_profile"] if row and row["helper_profile"] else "midctx-64k-no-thinking-q3-prefill"
        ),
        "provider_kind": row["provider_kind"] if row and row["provider_kind"] else "builtin",
        "provider_label": row["provider_label"] if row and row["provider_label"] else None,
        "provider_model_id": row["provider_model_id"] if row and row["provider_model_id"] else None,
        "provider_api_key": row["provider_api_key"] if row and row["provider_api_key"] else None,
        "provider_base_url": row["provider_base_url"] if row and row["provider_base_url"] else None,
        "provider_supports_images": row["provider_supports_images"] if row else 0,
        "provider_status": row["provider_status"] if row and row["provider_status"] else None,
        "provider_last_tested_at": row["provider_last_tested_at"] if row and row["provider_last_tested_at"] else None,
        "provider_capabilities_json": (
            row["provider_capabilities_json"] if row and row["provider_capabilities_json"] else "{}"
        ),
        "system_prompt": row["system_prompt"] if row and row["system_prompt"] else system_prompt,
        "image_analysis_prompt": row["image_analysis_prompt"] if row and row["image_analysis_prompt"] else None,
        "supports_text_enhancement": 1,
        "supports_image_analysis": 0,
        "created_at": created_at,
        "updated_at": now,
    }
    upsert_config(connection, payload)

connection.commit()
connection.close()
PY
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
  echo "You can still skip this and enable or change it later in Settings."
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
      seed_default_openrouter_enhancement_configs "$openrouter_base_url" >/dev/null 2>&1 || true
      echo "OpenRouter key verified."
      echo "Studio saved the recommended OpenRouter prompt enhancement setup."
      break
    fi
    echo "OpenRouter verification failed."
    if ! prompt_yes_no "Try a different OpenRouter API key?" "Y"; then
      echo "Skipping OpenRouter setup. You can enable it later in Settings."
      break
    fi
  done
  echo "If you ever want to switch to a local OpenAI-compatible prompt enhancer, add it later in Settings."
else
  echo "Skipping prompt enhancement setup. You can enable it later in Settings."
fi

echo
echo "Current setup summary"
echo " - KIE API key: $( [[ -n "$(env_value KIE_API_KEY)" ]] && echo configured || echo missing )"
echo " - Live submit: $( [[ "$(env_value MEDIA_ENABLE_LIVE_SUBMIT)" == "true" ]] && echo enabled || echo offline )"
echo " - OpenRouter: $( [[ -n "$(env_value OPENROUTER_API_KEY)" ]] && echo configured || echo skipped )"
echo
echo "Next steps"
echo " - Start later: Start Media Studio.command"
echo " - Stop later: Stop Media Studio.command"
echo " - Terminal launch: ./scripts/run_studio_mac.sh"
echo " - Studio: http://127.0.0.1:$(web_port)/studio"
echo " - Settings: http://127.0.0.1:$(web_port)/settings"
echo
echo "For normal use, double-click Start Media Studio.command."
echo "It starts the API and web app together in one Terminal window in production mode."
echo "If your browser does not open automatically, point it to the Studio URL above."
echo

read -r -p "Launch Media Studio in this Terminal window now? [y/N]: " launch_now
if [[ "$launch_now" =~ ^[Yy]$ ]]; then
  echo "Launching Media Studio in this Terminal window."
  echo "The launcher will start or recover the local app and open your browser to Studio when it is ready."
  "$SCRIPT_DIR/open_studio_mac.sh"
fi
