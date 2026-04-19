#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET_BRANCH="${1:-}"

usage() {
  cat <<'EOF'
Usage: ./scripts/safe_sync_repo.sh [branch]

Safely sync this Media Studio checkout to origin/<branch> without touching ./data.
This script intentionally does not run git clean.
EOF
}

if [[ "${TARGET_BRANCH:-}" == "--help" || "${TARGET_BRANCH:-}" == "-h" ]]; then
  usage
  exit 0
fi

cd "$REPO_ROOT"

if [[ -z "$TARGET_BRANCH" ]]; then
  TARGET_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi

if [[ -z "$TARGET_BRANCH" || "$TARGET_BRANCH" == "HEAD" ]]; then
  echo "Unable to determine the target branch." >&2
  echo "Pass the branch explicitly, for example: ./scripts/safe_sync_repo.sh main" >&2
  exit 1
fi

echo "Safe-syncing Media Studio to origin/$TARGET_BRANCH"
echo "Repo: $REPO_ROOT"
echo "Persistent local data under ./data will be preserved."
echo

git fetch --prune origin
git checkout "$TARGET_BRANCH"
git reset --hard "origin/$TARGET_BRANCH"

echo
echo "Sync complete."
echo "No untracked files were deleted."
echo "This script intentionally does not run 'git clean'."
