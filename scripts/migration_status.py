#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from _shared_runtime import ensure_shared_python, repo_root_for


def main() -> int:
    repo_root = repo_root_for(__file__)
    ensure_shared_python(repo_root, __file__, sys.argv[1:])
    sys.path.insert(0, str(repo_root / "apps" / "api"))

    from app import store  # noqa: E402
    from app.settings import settings  # noqa: E402

    parser = argparse.ArgumentParser(description="Show Media Studio schema migration status.")
    parser.add_argument(
        "--db",
        type=Path,
        default=settings.db_path,
        help="Path to the SQLite database. Defaults to MEDIA_STUDIO_DB_PATH.",
    )
    args = parser.parse_args()

    status = store.get_schema_status(args.db)
    print(json.dumps(status, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
