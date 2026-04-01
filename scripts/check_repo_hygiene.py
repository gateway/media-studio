#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


BLOCKED_PATTERNS = (
    ".env",
    ".env.local",
    ".envrc",
    ".python-version",
    ".env.development.local",
    ".env.production.local",
    ".env.test.local",
)
BLOCKED_SUFFIXES = (
    ".db",
    ".sqlite",
    ".sqlite3",
    ".db-wal",
    ".db-shm",
    ".sqlite-wal",
    ".sqlite-shm",
    ".jsonl",
    ".log",
    ".pid",
    ".pid.lock",
    ".pem",
    ".key",
    ".crt",
    ".cer",
    ".p12",
)
BLOCKED_PREFIXES = (
    "data/uploads/",
    "data/downloads/",
    "data/outputs/",
    "data/backups/",
    "artifacts/",
    "logs/",
    "tmp/",
    "temp/",
    "output/",
)
ALLOWED_EXACT = {
    ".env.example",
}


def is_blocked(rel_path: str) -> bool:
    if rel_path in ALLOWED_EXACT:
        return False
    if rel_path in BLOCKED_PATTERNS:
        return True
    if rel_path.startswith(".env.") and rel_path != ".env.example":
        return True
    if any(rel_path.startswith(prefix) for prefix in BLOCKED_PREFIXES):
        return True
    if rel_path.startswith(".playwright-cli/"):
        return True
    if rel_path.endswith(BLOCKED_SUFFIXES):
        return True
    return False


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    tracked_files = (
        subprocess.check_output(["git", "-C", str(repo_root), "ls-files"], text=True)
        .splitlines()
    )
    violations = [path for path in tracked_files if is_blocked(path)]

    if violations:
        print("Tracked repo hygiene violations detected:", file=sys.stderr)
        for path in violations:
            print(f" - {path}", file=sys.stderr)
        print(
            "Remove these from Git history/index or update the hygiene policy intentionally.",
            file=sys.stderr,
        )
        return 1

    print("Repo hygiene check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
