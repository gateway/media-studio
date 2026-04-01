from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .store import bootstrap_schema


def backup_database(source_path: Path, backup_dir: Path) -> Path:
    source = Path(source_path)
    if not source.exists():
        raise FileNotFoundError(f"database not found: {source}")

    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = source.suffix or ".sqlite"
    backup_path = backup_dir / f"{source.stem}-backup-{timestamp}{suffix}"

    source_connection = sqlite3.connect(source)
    backup_connection = sqlite3.connect(backup_path)
    try:
        source_connection.backup(backup_connection)
    finally:
        backup_connection.close()
        source_connection.close()

    return backup_path


def create_clean_database(target_path: Path, overwrite: bool = False) -> Path:
    target = Path(target_path)
    if target.exists():
        if not overwrite:
            raise FileExistsError(f"database already exists: {target}")
        target.unlink()

    bootstrap_schema(target)
    return target
