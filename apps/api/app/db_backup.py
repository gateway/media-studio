from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


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
