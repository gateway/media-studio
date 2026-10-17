from __future__ import annotations

import sqlite3

from app.store_support import bootstrap_connection_schema, insert_or_update


def test_insert_or_update_ignores_additive_columns_missing_from_old_local_schema() -> None:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE graph_run_nodes (
            run_node_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            node_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued'
        )
        """
    )

    insert_or_update(
        connection,
        "graph_run_nodes",
        "run_node_id",
        {
            "run_node_id": "node_1",
            "run_id": "run_1",
            "node_id": "load",
            "node_type": "media.load_image",
            "status": "queued",
            "metrics_json": {},
        },
    )

    row = connection.execute("SELECT * FROM graph_run_nodes WHERE run_node_id = 'node_1'").fetchone()
    assert dict(row)["node_type"] == "media.load_image"


def test_graph_metrics_migration_updates_existing_graph_schema() -> None:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE schema_migrations (
            migration_id TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
        CREATE TABLE graph_runs (
            run_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            schema_version INTEGER NOT NULL DEFAULT 1,
            workflow_json TEXT NOT NULL DEFAULT '{}',
            compiled_graph_json TEXT NOT NULL DEFAULT '{}',
            output_snapshot_json TEXT NOT NULL DEFAULT '{}',
            error TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at TEXT,
            finished_at TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE graph_run_nodes (
            run_node_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            node_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            progress REAL,
            input_snapshot_json TEXT NOT NULL DEFAULT '{}',
            output_snapshot_json TEXT NOT NULL DEFAULT '{}',
            error TEXT,
            started_at TEXT,
            finished_at TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE media_presets (
            preset_id TEXT PRIMARY KEY,
            key TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            description TEXT,
            category TEXT NOT NULL DEFAULT 'general'
        );
        CREATE TABLE media_enhancement_configs (
            config_id TEXT PRIMARY KEY,
            model_key TEXT NOT NULL UNIQUE,
            provider_kind TEXT NOT NULL DEFAULT 'builtin',
            provider_api_key TEXT,
            provider_base_url TEXT
        );
        INSERT INTO media_enhancement_configs
            (config_id, model_key, provider_kind, provider_api_key, provider_base_url)
            VALUES ('legacy', '__studio_enhancement__', 'openrouter', 'test-legacy-key', 'https://example.test/v1');
        CREATE TABLE media_assets (
            asset_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    for version, migration_id in [
        (1, "20260419_001_tracked_baseline"),
        (2, "20260419_002_project_cover_references"),
        (3, "20260419_003_project_visibility_flags"),
        (4, "20260501_004_default_model_release_updates"),
        (5, "20260511_005_graph_studio"),
    ]:
        connection.execute(
            "INSERT INTO schema_migrations (migration_id, version, description, applied_at) VALUES (?, ?, ?, ?)",
            (migration_id, version, "already applied", "2026-05-11T00:00:00+00:00"),
        )

    bootstrap_connection_schema(connection)

    graph_run_columns = {row["name"] for row in connection.execute("PRAGMA table_info(graph_runs)").fetchall()}
    graph_run_node_columns = {row["name"] for row in connection.execute("PRAGMA table_info(graph_run_nodes)").fetchall()}
    assert "metrics_json" in graph_run_columns
    assert "metrics_json" in graph_run_node_columns

    legacy = dict(connection.execute("SELECT * FROM media_enhancement_configs WHERE config_id = 'legacy'").fetchone())
    assert legacy["provider_api_key"] == "test-legacy-key"
    assert legacy["provider_base_url"] == "https://example.test/v1"
    assert legacy["provider_overrides_json"] == "{}"
    assert connection.execute("SELECT count(*) FROM media_provider_connections").fetchone()[0] == 0
