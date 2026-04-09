#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared_env.sh
. "$SCRIPT_DIR/shared_env.sh"
MEDIA_ROOT="${MEDIA_ROOT:-$(media_root_from_script "${BASH_SOURCE[0]}")}"

BUILD_ID_FILE="$MEDIA_ROOT/apps/web/.next/BUILD_ID"
NODE_MODULES_STAMP="$MEDIA_ROOT/node_modules/.package-lock.json"
JSZIP_PACKAGE="$MEDIA_ROOT/node_modules/jszip/package.json"

needs_build=false
needs_install=false

if [[ ! -d "$MEDIA_ROOT/node_modules" ]]; then
  needs_install=true
elif [[ ! -f "$NODE_MODULES_STAMP" ]]; then
  needs_install=true
elif [[ "$MEDIA_ROOT/package-lock.json" -nt "$NODE_MODULES_STAMP" ]]; then
  needs_install=true
elif [[ "$MEDIA_ROOT/package.json" -nt "$NODE_MODULES_STAMP" ]]; then
  needs_install=true
elif [[ "$MEDIA_ROOT/apps/web/package.json" -nt "$NODE_MODULES_STAMP" ]]; then
  needs_install=true
elif [[ ! -f "$JSZIP_PACKAGE" ]]; then
  needs_install=true
fi

if [[ "$needs_install" == true ]]; then
  echo "Refreshing Media Studio web dependencies..."
  cd "$MEDIA_ROOT"
  npm install
fi

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
