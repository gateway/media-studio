#!/usr/bin/env bash
set -euo pipefail

media_root_from_script() {
  local script_path="${1:?script_path required}"
  local script_dir
  script_dir="$(cd "$(dirname "$script_path")" && pwd)"
  cd "$script_dir/.." && pwd
}

resolve_kie_root() {
  local media_root="${1:?media_root required}"
  local default_kie_root="$media_root/../kie-api"
  local legacy_kie_root="$media_root/../kie-ai/kie_codex_bootstrap"

  if [[ -n "${KIE_ROOT:-}" ]]; then
    printf '%s\n' "$KIE_ROOT"
    return
  fi
  if [[ -n "${MEDIA_STUDIO_KIE_API_REPO_PATH:-}" ]]; then
    printf '%s\n' "$MEDIA_STUDIO_KIE_API_REPO_PATH"
    return
  fi
  if [[ -d "$default_kie_root" ]]; then
    printf '%s\n' "$default_kie_root"
    return
  fi
  if [[ -d "$legacy_kie_root" ]]; then
    printf '%s\n' "$legacy_kie_root"
    return
  fi
  printf '%s\n' "$default_kie_root"
}

load_media_env() {
  local media_root="${1:?media_root required}"
  local env_file="$media_root/.env"
  if [[ -f "$env_file" ]]; then
    local env_entries=""
    env_entries="$(python3 - "$env_file" <<'PY'
from pathlib import Path
import re
import sys

env_path = Path(sys.argv[1])
line_pattern = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")

for raw_line in env_path.read_text().splitlines():
    stripped = raw_line.strip()
    if not stripped or stripped.startswith("#"):
        continue
    match = line_pattern.match(raw_line)
    if not match:
        continue
    name, raw_value = match.groups()
    value = raw_value.strip()
    if value and value[0] in {'"', "'"} and value[-1:] == value[0]:
        value = value[1:-1]
    print(f"{name}={value}")
PY
)"
    while IFS='=' read -r name value; do
      [[ -n "$name" ]] || continue
      if declare -p "$name" >/dev/null 2>&1; then
        continue
      fi
      export "$name=$value"
    done <<< "$env_entries"
  fi
}

generate_media_studio_local_control_token() {
  python3 - <<'PY'
import secrets
print(f"media-studio-{secrets.token_hex(24)}")
PY
}

ensure_media_env_control_token() {
  local media_root="${1:?media_root required}"
  local env_file="$media_root/.env"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi
  python3 - "$env_file" <<'PY'
from pathlib import Path
import secrets
import sys

env_path = Path(sys.argv[1])
prefix = "MEDIA_STUDIO_CONTROL_API_TOKEN="
placeholder = "replace_with_a_unique_control_token"
lines = env_path.read_text().splitlines()
current = None

for line in lines:
    if line.startswith(prefix):
        current = line[len(prefix):].strip()
        break

if current and current != placeholder:
    print(current)
    raise SystemExit(0)

token = f"media-studio-{secrets.token_hex(24)}"
updated = False
for index, line in enumerate(lines):
    if line.startswith(prefix):
        lines[index] = prefix + token
        updated = True
        break

if not updated:
    lines.append(prefix + token)

env_path.write_text("\n".join(lines).rstrip("\n") + "\n")
print(token)
PY
}

media_runtime_access_host() {
  local host="${1:-127.0.0.1}"
  case "$host" in
    "" | "0.0.0.0")
      printf '%s\n' "127.0.0.1"
      ;;
    "::" | "[::]")
      printf '%s\n' "::1"
      ;;
    *)
      printf '%s\n' "$host"
      ;;
  esac
}

media_control_api_base_url() {
  local host
  host="$(media_runtime_access_host "${1:-127.0.0.1}")"
  local port="${2:-8000}"
  if [[ "$host" == *:* && "$host" != \[*\] ]]; then
    printf 'http://[%s]:%s\n' "$host" "$port"
  else
    printf 'http://%s:%s\n' "$host" "$port"
  fi
}
