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


def test_deduplicate_assets_by_job_id_keeps_latest_asset(app_modules) -> None:
    store = app_modules["store"]
    store.bootstrap_schema()
    older = store.create_or_update_asset(
        {
            "asset_id": "asset-old",
            "job_id": "job-1",
            "created_at": "2026-04-03T00:00:00+00:00",
            "model_key": "nano-banana-2",
            "status": "completed",
            "generation_kind": "image",
            "prompt_summary": "older",
        }
    )
    newer = store.create_or_update_asset(
        {
            "asset_id": "asset-new",
            "job_id": "job-1",
            "created_at": "2026-04-03T00:01:00+00:00",
            "model_key": "nano-banana-2",
            "status": "completed",
            "generation_kind": "image",
            "prompt_summary": "newer",
        }
    )

    removed = store.deduplicate_assets_by_job_id()

    assert older["asset_id"] != newer["asset_id"]
    assert removed == 1
    assert store.get_asset("asset-old") is None
    assert store.get_asset("asset-new")["prompt_summary"] == "newer"


def test_bootstrap_schema_adds_hidden_from_dashboard_to_legacy_assets_table(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    legacy_db = tmp_path / "legacy.sqlite"

    connection = sqlite3.connect(legacy_db)
    try:
        connection.execute(
            """
            CREATE TABLE media_assets (
                asset_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                provider_task_id TEXT,
                run_id TEXT,
                source_asset_id TEXT,
                generation_kind TEXT,
                favorited INTEGER NOT NULL DEFAULT 0,
                favorited_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                model_key TEXT NOT NULL,
                status TEXT NOT NULL,
                task_mode TEXT,
                prompt_summary TEXT,
                artifact_run_dir TEXT,
                manifest_path TEXT,
                run_json_path TEXT,
                hero_original_path TEXT,
                hero_web_path TEXT,
                hero_thumb_path TEXT,
                hero_poster_path TEXT,
                remote_output_url TEXT,
                preset_key TEXT,
                preset_source TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]',
                payload_json TEXT NOT NULL DEFAULT '{}',
                dismissed INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(legacy_db)

    connection = sqlite3.connect(legacy_db)
    try:
        columns = {
            row[1]: row[4]
            for row in connection.execute("PRAGMA table_info(media_assets)").fetchall()
        }
    finally:
        connection.close()

    assert "hidden_from_dashboard" in columns
    assert columns["hidden_from_dashboard"] == "0"
