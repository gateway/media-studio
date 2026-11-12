"""Check whether an explicit startup mode can use the existing installation."""

import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
import sys


def check_startup(connection: sqlite3.Connection, mode: str) -> None:
    from app.store_schema import schema_status
    from app.store_support import pending_generation_exists

    status = schema_status(connection)
    if not status["user_schema_present"]:
        raise ValueError("The existing Media Studio database has no application schema.")
    if status["pending_migrations"]:
        raise ValueError("Pending database migrations need separate approval before startup.")
    if mode == "live" and pending_generation_exists(connection):
        raise ValueError("Pending media jobs or Graph runs need separate approval before enabling processing.")


def readonly_database_uri(db_path: Path) -> str:
    resolved = db_path.resolve(strict=True)
    with resolved.open("rb") as db_file:
        header = db_file.read(20)
    # SQLite header bytes 18 and 19 are the write and read format versions.
    # A read-only connection to a WAL database can still touch WAL/SHM sidecars.
    if not header.startswith(b"SQLite format 3\x00") or header[18:20] != b"\x01\x01":
        raise ValueError("Startup preflight requires an existing SQLite database in rollback journal mode; WAL is unsupported.")
    return resolved.as_uri() + "?mode=ro"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--mode", choices=("verification", "live"), required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

    # Read the current SQLite state without bootstrapping or applying migrations.
    try:
        with closing(sqlite3.connect(readonly_database_uri(args.db), uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            check_startup(connection, args.mode)
    except (OSError, sqlite3.Error, ValueError) as exc:
        parser.exit(1, f"Startup preflight blocked: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
