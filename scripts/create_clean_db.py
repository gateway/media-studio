#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from _shared_runtime import ensure_shared_python, repo_root_for


def main() -> int:
    repo_root = repo_root_for(__file__)
    ensure_shared_python(repo_root, __file__, sys.argv[1:])
    sys.path.insert(0, str(repo_root / "apps" / "api"))

    from app.db_admin import create_clean_database  # noqa: E402

    parser = argparse.ArgumentParser(description="Create a clean Media Studio SQLite database with schema and defaults only.")
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Target SQLite file path for the clean database.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace the target file if it already exists.",
    )
    args = parser.parse_args()

    db_path = create_clean_database(args.output, overwrite=args.overwrite)
    print(f"Created clean database at: {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
