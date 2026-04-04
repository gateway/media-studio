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
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
}
