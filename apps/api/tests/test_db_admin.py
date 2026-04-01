from __future__ import annotations

import sqlite3
from pathlib import Path


def _count_rows(db_path: Path, table: str) -> int:
    connection = sqlite3.connect(db_path)
    try:
        row = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    finally:
        connection.close()
    return int(row[0] or 0)


def test_create_clean_database_bootstraps_schema_and_defaults(app_modules, tmp_path: Path) -> None:
    db_admin = app_modules["db_admin"]
    clean_db = tmp_path / "clean.sqlite"

    created_path = db_admin.create_clean_database(clean_db)

    assert created_path == clean_db
    assert clean_db.exists()
    assert _count_rows(clean_db, "media_jobs") == 0
    assert _count_rows(clean_db, "media_assets") == 0
    assert _count_rows(clean_db, "media_queue_settings") == 1
    assert _count_rows(clean_db, "media_presets") >= 2


def test_backup_database_copies_existing_database(app_modules, tmp_path: Path) -> None:
    db_admin = app_modules["db_admin"]
    source_db = db_admin.create_clean_database(tmp_path / "source.sqlite")

    backup_path = db_admin.backup_database(source_db, tmp_path / "backups")

    assert backup_path.exists()
    assert backup_path.parent == tmp_path / "backups"
    assert _count_rows(backup_path, "media_queue_settings") == 1
    assert _count_rows(backup_path, "media_presets") == _count_rows(source_db, "media_presets")
