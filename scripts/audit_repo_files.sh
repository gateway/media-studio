#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-files}"

RG_EXCLUDES=(
  -g '!node_modules/**'
  -g '!apps/web/node_modules/**'
  -g '!apps/web/.next/**'
  -g '!apps/api/*.egg-info/**'
  -g '!.pytest_cache/**'
)

case "$MODE" in
  files)
    rg --files "${RG_EXCLUDES[@]}"
    ;;
  line-count)
    rg --files -0 "${RG_EXCLUDES[@]}" | xargs -0 wc -l
    ;;
  *)
    echo "Usage: scripts/audit_repo_files.sh [files|line-count]" >&2
    exit 2
    ;;
esac
