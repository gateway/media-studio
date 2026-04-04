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

    from app.db_admin import backup_database  # noqa: E402
    from app.settings import settings  # noqa: E402

    parser = argparse.ArgumentParser(description="Back up the local Media Studio SQLite database.")
    parser.add_argument(
        "--source",
        type=Path,
        default=settings.db_path,
        help="Path to the source SQLite database. Defaults to MEDIA_STUDIO_DB_PATH.",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=repo_root / "data" / "backups",
        help="Directory where ignored backup copies should be written.",
    )
    args = parser.parse_args()

    backup_path = backup_database(args.source, args.backup_dir)
    print(f"Backed up database to: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
