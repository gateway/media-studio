from __future__ import annotations

import json
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
    store = app_modules["store"]
    clean_db = tmp_path / "clean.sqlite"

    created_path = db_admin.create_clean_database(clean_db)

    assert created_path == clean_db
    assert clean_db.exists()
    assert _count_rows(clean_db, "media_jobs") == 0
    assert _count_rows(clean_db, "media_assets") == 0
    assert _count_rows(clean_db, "media_projects") == 0
    assert _count_rows(clean_db, "media_project_references") == 0
    assert _count_rows(clean_db, "media_queue_settings") == 1
    assert _count_rows(clean_db, "media_presets") >= 7
    assert _count_rows(clean_db, "prompt_recipes") >= 5
    connection = sqlite3.connect(clean_db)
    try:
        row = connection.execute(
            "SELECT enabled, max_outputs_per_run FROM media_model_queue_policies WHERE model_key = ?",
            ("seedance-2.0",),
        ).fetchone()
        preset_rows = connection.execute(
            """
            SELECT applies_to_models_json
            FROM media_presets
            WHERE preset_id IN (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "media-preset-2x2-pose-grid-shared",
                "media-preset-3d-caricature-style-nano-banana-shared",
                "media-preset-exploding-food-shared",
                "media-preset-food-recipe-infographic-shared",
                "media-preset-giant-animal-anywhere-shared",
                "media-preset-photo-restoration-shared",
                "media-preset-selfie-with-movie-character-nano-banana-shared",
            ),
        ).fetchall()
    finally:
        connection.close()
    assert row is not None
    assert int(row[0] or 0) == 1
    assert int(row[1] or 0) == 1

    status = store.get_schema_status(clean_db)
    assert len(preset_rows) == 7
    assert any("gpt-image-2-image-to-image" in json.loads(preset_row[0]) for preset_row in preset_rows)
    assert any("gpt-image-2-text-to-image" in json.loads(preset_row[0]) for preset_row in preset_rows)

    assert status["schema_version"] == status["latest_version"]
    assert status["latest_version"] == 16
    assert len(status["applied_migrations"]) == 16
    assert status["applied_migrations"][0]["migration_id"] == "20260419_001_tracked_baseline"
    assert status["applied_migrations"][1]["migration_id"] == "20260419_002_project_cover_references"
    assert status["applied_migrations"][2]["migration_id"] == "20260419_003_project_visibility_flags"
    assert status["applied_migrations"][3]["migration_id"] == "20260501_004_default_model_release_updates"
    assert status["applied_migrations"][4]["migration_id"] == "20260511_005_graph_studio"
    assert status["applied_migrations"][5]["migration_id"] == "20260512_006_graph_run_metrics"
    assert status["applied_migrations"][6]["migration_id"] == "20260512_007_graph_artifacts"
    assert status["applied_migrations"][7]["migration_id"] == "20260516_008_prompt_recipes"
    assert status["applied_migrations"][8]["migration_id"] == "20260516_009_prompt_recipe_validation_warnings"
    assert status["applied_migrations"][9]["migration_id"] == "20260516_010_prompt_recipe_drafting_config"
    assert status["applied_migrations"][10]["migration_id"] == "20260517_011_graph_prompt_recipe_seed_refresh"
    assert status["applied_migrations"][11]["migration_id"] == "20260517_012_prompt_recipe_graph_runtime_refresh"
    assert status["applied_migrations"][12]["migration_id"] == "20260517_013_prompt_recipe_smoke_template_provider_refresh"
    assert status["applied_migrations"][13]["migration_id"] == "20260517_014_external_llm_usage"
    assert status["applied_migrations"][14]["migration_id"] == "20260517_015_graph_rollout_hardening_cleanup"
    assert status["applied_migrations"][15]["migration_id"] == "20260519_016_prompt_recipe_drafting_enabled"
    assert status["pending_migrations"] == []


def test_bootstrap_schema_upgrades_legacy_seedance_default_policy(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    legacy_db = tmp_path / "legacy-seedance.sqlite"

    connection = sqlite3.connect(legacy_db)
    try:
        connection.executescript(
            """
            CREATE TABLE media_jobs (
                job_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE media_assets (
                asset_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE media_batches (
                batch_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE media_model_queue_policies (
                model_key TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                max_outputs_per_run INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT
            );
            INSERT INTO media_model_queue_policies (model_key, enabled, max_outputs_per_run, updated_at)
            VALUES ('seedance-2.0', 0, 1, '2026-04-01T00:00:00+00:00');
            """
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(legacy_db)

    connection = sqlite3.connect(legacy_db)
    try:
        row = connection.execute(
            "SELECT enabled, max_outputs_per_run FROM media_model_queue_policies WHERE model_key = ?",
            ("seedance-2.0",),
        ).fetchone()
    finally:
        connection.close()

    assert row is not None
    assert int(row[0] or 0) == 1
    assert int(row[1] or 0) == 1


def test_bootstrap_schema_updates_v3_default_model_release_settings(app_modules, tmp_path: Path) -> None:
    db_admin = app_modules["db_admin"]
    store = app_modules["store"]
    legacy_db = db_admin.create_clean_database(tmp_path / "legacy-defaults.sqlite")

    connection = sqlite3.connect(legacy_db)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (4,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("3", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260419_003_project_visibility_flags", "last_migration_id"),
        )
        connection.execute(
            """
            UPDATE media_presets
            SET applies_to_models_json = ?
            WHERE preset_id IN (?, ?)
            """,
            (
                json.dumps(["nano-banana-2", "nano-banana-pro"]),
                "media-preset-3d-caricature-style-nano-banana-shared",
                "media-preset-selfie-with-movie-character-nano-banana-shared",
            ),
        )
        connection.execute("DELETE FROM media_model_queue_policies WHERE model_key = ?", ("seedance-2.0",))
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(legacy_db)

    connection = sqlite3.connect(legacy_db)
    try:
        preset_rows = connection.execute(
            """
            SELECT applies_to_models_json
            FROM media_presets
            WHERE preset_id IN (?, ?)
            """,
            (
                "media-preset-3d-caricature-style-nano-banana-shared",
                "media-preset-selfie-with-movie-character-nano-banana-shared",
            ),
        ).fetchall()
        seedance_policy = connection.execute(
            "SELECT enabled, max_outputs_per_run FROM media_model_queue_policies WHERE model_key = ?",
            ("seedance-2.0",),
        ).fetchone()
    finally:
        connection.close()

    assert len(preset_rows) == 2
    for preset_row in preset_rows:
        assert sorted(json.loads(preset_row[0])) == [
            "gpt-image-2-image-to-image",
            "nano-banana-2",
            "nano-banana-pro",
        ]
    assert seedance_policy is not None
    assert int(seedance_policy[0] or 0) == 1
    assert int(seedance_policy[1] or 0) == 1
    status = store.get_schema_status(legacy_db)
    assert status["schema_version"] == status["latest_version"] == 15


def test_backup_database_copies_existing_database(app_modules, tmp_path: Path) -> None:
    db_admin = app_modules["db_admin"]
    source_db = db_admin.create_clean_database(tmp_path / "source.sqlite")

    backup_path = db_admin.backup_database(source_db, tmp_path / "backups")

    assert backup_path.exists()
    assert backup_path.parent == tmp_path / "backups"
    assert _count_rows(backup_path, "media_queue_settings") == 1
    assert _count_rows(backup_path, "media_presets") == _count_rows(source_db, "media_presets")
    assert _count_rows(backup_path, "prompt_recipes") == _count_rows(source_db, "prompt_recipes")


def test_bootstrap_schema_creates_backup_before_upgrading_existing_database(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    legacy_db = tmp_path / "legacy-upgrade.sqlite"
    backup_dir = tmp_path / "backups"

    connection = sqlite3.connect(legacy_db)
    try:
        connection.executescript(
            """
            CREATE TABLE media_jobs (
                job_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE media_assets (
                asset_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE media_batches (
                batch_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO media_jobs (job_id) VALUES ('job-1');
            """
        )
        connection.commit()
    finally:
        connection.close()

    backup_path = store.bootstrap_schema(legacy_db, backup_dir=backup_dir)

    assert backup_path is not None
    assert backup_path.exists()
    assert backup_path.parent == backup_dir
    assert _count_rows(backup_path, "media_jobs") == 1

    status = store.get_schema_status(legacy_db)
    assert status["schema_version"] == status["latest_version"] == 15
    assert status["pending_migrations"] == []
    assert status["applied_migrations"][0]["migration_id"] == "20260419_001_tracked_baseline"
    assert status["applied_migrations"][1]["migration_id"] == "20260419_002_project_cover_references"
    assert status["applied_migrations"][2]["migration_id"] == "20260419_003_project_visibility_flags"
    assert status["applied_migrations"][3]["migration_id"] == "20260501_004_default_model_release_updates"
    assert status["applied_migrations"][4]["migration_id"] == "20260511_005_graph_studio"


def test_rollout_cleanup_migration_archives_duplicate_prompt_recipe_smoke_workflows(app_modules, tmp_path: Path) -> None:
    db_admin = app_modules["db_admin"]
    store = app_modules["store"]
    legacy_db = db_admin.create_clean_database(tmp_path / "legacy-rollout-cleanup.sqlite")

    connection = sqlite3.connect(legacy_db)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (15,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("14", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260517_014_external_llm_usage", "last_migration_id"),
        )
        connection.executemany(
            """
            INSERT INTO graph_workflows (workflow_id, name, status, schema_version, workflow_json, created_at, updated_at)
            VALUES (?, ?, 'active', 1, ?, ?, ?)
            """,
            [
                (
                    "graphwf_text_old",
                    "Prompt Recipe - Text Single Prompt",
                    json.dumps({"schema_version": 1, "name": "Prompt Recipe - Text Single Prompt", "nodes": [], "edges": []}),
                    "2026-05-17T03:03:09.000000+00:00",
                    "2026-05-17T03:03:09.000000+00:00",
                ),
                (
                    "graphwf_text_new",
                    "Prompt Recipe - Text Single Prompt",
                    json.dumps({"schema_version": 1, "name": "Prompt Recipe - Text Single Prompt", "nodes": [], "edges": []}),
                    "2026-05-17T03:27:56.000000+00:00",
                    "2026-05-17T03:27:56.000000+00:00",
                ),
                (
                    "graphwf_copy_1",
                    "Prompt Recipe - Single Image Director Copy",
                    json.dumps({"schema_version": 1, "name": "Prompt Recipe - Single Image Director Copy", "nodes": [], "edges": []}),
                    "2026-05-17T05:24:54.000000+00:00",
                    "2026-05-17T05:24:54.000000+00:00",
                ),
                (
                    "graphwf_live_smoke_1",
                    "Live Prompt Recipe Smoke",
                    json.dumps({"schema_version": 1, "name": "Live Prompt Recipe Smoke", "nodes": [], "edges": []}),
                    "2026-05-17T03:06:19.000000+00:00",
                    "2026-05-17T03:06:19.000000+00:00",
                ),
            ],
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(legacy_db)

    connection = sqlite3.connect(legacy_db)
    try:
        rows = connection.execute(
            """
            SELECT workflow_id, name, status
            FROM graph_workflows
            WHERE workflow_id IN ('graphwf_text_old', 'graphwf_text_new', 'graphwf_copy_1', 'graphwf_live_smoke_1')
            ORDER BY workflow_id ASC
            """
        ).fetchall()
    finally:
        connection.close()

    row_map = {row[0]: {"name": row[1], "status": row[2]} for row in rows}
    assert row_map["graphwf_text_old"]["status"] == "archived"
    assert row_map["graphwf_text_new"]["status"] == "active"
    assert row_map["graphwf_copy_1"]["status"] == "archived"
    assert row_map["graphwf_live_smoke_1"]["status"] == "archived"

    status = store.get_schema_status(legacy_db)
    assert status["schema_version"] == status["latest_version"] == 15


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


def test_bootstrap_schema_adds_project_columns_and_tables_to_legacy_db(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    legacy_db = tmp_path / "legacy-projects.sqlite"

    connection = sqlite3.connect(legacy_db)
    try:
        connection.executescript(
            """
            CREATE TABLE media_jobs (
                job_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE media_assets (
                asset_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE media_batches (
                batch_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(legacy_db)

    connection = sqlite3.connect(legacy_db)
    try:
        table_names = {
            row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
        batch_columns = {row[1] for row in connection.execute("PRAGMA table_info(media_batches)").fetchall()}
        job_columns = {row[1] for row in connection.execute("PRAGMA table_info(media_jobs)").fetchall()}
        asset_columns = {row[1] for row in connection.execute("PRAGMA table_info(media_assets)").fetchall()}
    finally:
        connection.close()

    assert "media_projects" in table_names
    assert "media_project_references" in table_names
    assert "project_id" in batch_columns
    assert "project_id" in job_columns
    assert "project_id" in asset_columns
    connection = sqlite3.connect(legacy_db)
    try:
        project_columns = {row[1] for row in connection.execute("PRAGMA table_info(media_projects)").fetchall()}
    finally:
        connection.close()
    assert "cover_reference_id" in project_columns
