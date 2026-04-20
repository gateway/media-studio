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

kie_repo_is_git_checkout() {
  local repo_root="${1:?repo_root required}"
  [[ -d "$repo_root/.git" ]]
}

kie_repo_current_branch() {
  local repo_root="${1:?repo_root required}"
  git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true
}

kie_repo_has_uncommitted_changes() {
  local repo_root="${1:?repo_root required}"
  [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no 2>/dev/null)" ]]
}

kie_repo_upstream_ref() {
  local repo_root="${1:?repo_root required}"
  local upstream=""
  upstream="$(git -C "$repo_root" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [[ -n "$upstream" ]]; then
    printf '%s\n' "$upstream"
    return
  fi
  local branch=""
  branch="$(kie_repo_current_branch "$repo_root")"
  if [[ -n "$branch" && "$branch" != "HEAD" ]] && git -C "$repo_root" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    printf 'origin/%s\n' "$branch"
  fi
}

kie_repo_refresh_remote() {
  local repo_root="${1:?repo_root required}"
  if ! kie_repo_is_git_checkout "$repo_root"; then
    return 1
  fi
  git -C "$repo_root" fetch --quiet --prune origin >/dev/null 2>&1
}

kie_repo_ahead_behind_counts() {
  local repo_root="${1:?repo_root required}"
  local upstream="${2:?upstream required}"
  git -C "$repo_root" rev-list --left-right --count "$upstream"...HEAD 2>/dev/null || true
}

kie_repo_status_summary() {
  local repo_root="${1:?repo_root required}"
  if ! kie_repo_is_git_checkout "$repo_root"; then
    printf 'state=not_git\n'
    return
  fi

  local branch upstream counts behind ahead dirty
  branch="$(kie_repo_current_branch "$repo_root")"
  upstream="$(kie_repo_upstream_ref "$repo_root")"
  dirty="false"
  if kie_repo_has_uncommitted_changes "$repo_root"; then
    dirty="true"
  fi
  if [[ -z "$upstream" ]]; then
    printf 'state=no_upstream\nbranch=%s\ndirty=%s\n' "$branch" "$dirty"
    return
  fi

  counts="$(kie_repo_ahead_behind_counts "$repo_root" "$upstream")"
  behind="$(awk '{print $1}' <<< "$counts")"
  ahead="$(awk '{print $2}' <<< "$counts")"
  behind="${behind:-0}"
  ahead="${ahead:-0}"
  printf 'state=ok\nbranch=%s\nupstream=%s\nbehind=%s\nahead=%s\ndirty=%s\n' "$branch" "$upstream" "$behind" "$ahead" "$dirty"
}

kie_repo_update_ff_only() {
  local repo_root="${1:?repo_root required}"
  if ! kie_repo_is_git_checkout "$repo_root"; then
    echo "KIE repo is not a git checkout: $repo_root" >&2
    return 1
  fi
  if kie_repo_has_uncommitted_changes "$repo_root"; then
    echo "KIE repo has local changes and cannot be updated automatically: $repo_root" >&2
    return 1
  fi
  local branch upstream
  branch="$(kie_repo_current_branch "$repo_root")"
  upstream="$(kie_repo_upstream_ref "$repo_root")"
  if [[ -z "$branch" || "$branch" == "HEAD" || -z "$upstream" ]]; then
    echo "KIE repo does not have a normal tracked branch and cannot be auto-updated: $repo_root" >&2
    return 1
  fi
  if ! kie_repo_refresh_remote "$repo_root"; then
    echo "Unable to refresh remote refs for KIE repo: $repo_root" >&2
    return 1
  fi
  git -C "$repo_root" pull --ff-only origin "$branch"
}
