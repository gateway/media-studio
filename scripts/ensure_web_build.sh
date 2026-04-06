#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"

BUILD_ID_FILE="$MEDIA_ROOT/apps/web/.next/BUILD_ID"

needs_build=false

if [[ ! -f "$BUILD_ID_FILE" ]]; then
  needs_build=true
else
  while IFS= read -r -d '' path; do
    if [[ "$path" -nt "$BUILD_ID_FILE" ]]; then
      needs_build=true
      break
    fi
  done < <(
    find \
      "$MEDIA_ROOT/apps/web/app" \
      "$MEDIA_ROOT/apps/web/components" \
      "$MEDIA_ROOT/apps/web/hooks" \
      "$MEDIA_ROOT/apps/web/lib" \
      "$MEDIA_ROOT/apps/web/package.json" \
      "$MEDIA_ROOT/apps/web/next.config.ts" \
      "$MEDIA_ROOT/apps/web/tsconfig.json" \
      "$MEDIA_ROOT/package.json" \
      "$MEDIA_ROOT/package-lock.json" \
      -type f -print0
  )
fi

if [[ "$needs_build" != true ]]; then
  echo "Using existing production web build."
  exit 0
fi

echo "Building Media Studio web app for production..."
cd "$MEDIA_ROOT"
npm run build:web
