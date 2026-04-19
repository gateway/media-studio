from __future__ import annotations

from pathlib import Path

from .db_backup import backup_database
from .store import bootstrap_schema


def create_clean_database(target_path: Path, overwrite: bool = False) -> Path:
    target = Path(target_path)
    if target.exists():
        if not overwrite:
            raise FileExistsError(f"database already exists: {target}")
        target.unlink()

    bootstrap_schema(target)
    return target
