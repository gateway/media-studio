from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .db import get_connection


JSON_FIELDS = {
    "default_options_json",
    "rules_json",
    "input_schema_json",
    "input_slots_json",
    "choice_groups_json",
    "applies_to_models_json",
    "applies_to_task_modes_json",
    "applies_to_input_patterns_json",
    "system_prompt_ids_json",
    "request_summary_json",
    "selected_system_prompt_ids_json",
    "selected_system_prompts_json",
    "resolved_system_prompt_json",
    "resolved_options_json",
    "normalized_request_json",
    "prompt_context_json",
    "validation_json",
    "preflight_json",
    "prepared_json",
    "submit_response_json",
    "final_status_json",
    "artifact_json",
    "tags_json",
    "payload_json",
    "provider_capabilities_json",
}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return "%s_%s" % (prefix, uuid.uuid4().hex[:12])


def _json_default(column: str) -> Any:
    if column.endswith("_json"):
        if column in {
            "input_slots_json",
            "choice_groups_json",
            "applies_to_models_json",
            "applies_to_task_modes_json",
            "applies_to_input_patterns_json",
            "selected_system_prompt_ids_json",
            "selected_system_prompts_json",
            "tags_json",
        }:
            return []
        return {}
    return None


def encode_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def decode_row(row: sqlite3.Row) -> Dict[str, Any]:
    payload = {}
    for key in row.keys():
        value = row[key]
        if key in JSON_FIELDS:
            payload[key] = json.loads(value) if value else _json_default(key)
        elif key in {
            "queue_enabled",
            "enabled",
            "requires_image",
            "requires_video",
            "requires_audio",
            "supports_text_enhancement",
            "supports_image_analysis",
            "favorited",
            "dismissed",
        }:
            payload[key] = bool(value)
        else:
            payload[key] = value
    return payload


def connect_path(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
    rows = connection.execute("PRAGMA table_info(%s)" % table_name).fetchall()
    existing = {row["name"] for row in rows}
    if column_name in existing:
        return
    connection.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table_name, column_name, definition))


def table_columns(connection: sqlite3.Connection, table_name: str) -> set[str]:
    rows = connection.execute("PRAGMA table_info(%s)" % table_name).fetchall()
    return {row["name"] for row in rows}


def list_table(table: str, order_by: str = "created_at DESC") -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM %s ORDER BY %s" % (table, order_by)).fetchall()
    return [decode_row(row) for row in rows]


def get_table(table: str, pk_field: str, pk_value: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM %s WHERE %s = ?" % (table, pk_field),
            (pk_value,),
        ).fetchone()
    return decode_row(row) if row else None


def delete_table(table: str, pk_field: str, pk_value: str) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM %s WHERE %s = ?" % (table, pk_field), (pk_value,))


def upsert_table(table: str, pk_field: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    now = utcnow_iso()
    resolved = payload.copy()
    resolved.setdefault(pk_field, new_id(pk_field.replace("_id", "")))
    resolved.setdefault("created_at", now)
    with get_connection() as connection:
        existing_columns = table_columns(connection, table)
        if "updated_at" in existing_columns:
            resolved["updated_at"] = now
        resolved = {key: value for key, value in resolved.items() if key in existing_columns}
        columns = sorted(resolved.keys())
        placeholders = ", ".join(["?"] * len(columns))
        updates = ", ".join(
            ["%s = excluded.%s" % (column, column) for column in columns if column not in {pk_field, "created_at"}]
        )
        values = [encode_value(resolved[column]) for column in columns]
        connection.execute(
            "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s"
            % (table, ", ".join(columns), placeholders, pk_field, updates),
            values,
        )
    return get_table(table, pk_field, resolved[pk_field])  # type: ignore


def insert_or_update(connection: sqlite3.Connection, table: str, pk_field: str, payload: Dict[str, Any]) -> None:
    columns = sorted(payload.keys())
    placeholders = ", ".join(["?"] * len(columns))
    updates = ", ".join(
        ["%s = excluded.%s" % (column, column) for column in columns if column != pk_field]
    )
    connection.execute(
        "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s"
        % (table, ", ".join(columns), placeholders, pk_field, updates),
        [encode_value(payload[column]) for column in columns],
    )


def next_queue_position(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COALESCE(MAX(queue_position), 0) + 1 AS next_position FROM media_jobs").fetchone()
    return int(row["next_position"])


def _seed_default_presets(connection: sqlite3.Connection) -> None:
    existing_shared = connection.execute(
        "SELECT COUNT(*) AS count FROM media_presets WHERE preset_id IN (?, ?)",
        (
            "media-preset-3d-caricature-style-nano-banana-shared",
            "media-preset-selfie-with-movie-character-nano-banana-shared",
        ),
    ).fetchone()
    if existing_shared and int(existing_shared["count"] or 0) >= 2:
        return
    seed_rows = [
        {
            "preset_id": "media-preset-3d-caricature-style-nano-banana-shared",
            "key": "3d-caricature-style-nano-banana",
            "label": "3D Caricature Style",
            "description": "Turn a portrait photo into a polished 3D caricature with exaggerated features and recognizable likeness.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": json.dumps(["nano-banana-2", "nano-banana-pro"]),
            "applies_to_task_modes_json": json.dumps(["image_edit"]),
            "applies_to_input_patterns_json": json.dumps(["single_image", "image_edit"]),
            "prompt_template": "Create a polished 3D caricature portrait of {{subject_style}} using [[person]]. Keep the likeness recognizable, exaggerate the defining features in a flattering way, and preserve a premium cinematic render finish.",
            "system_prompt_template": "",
            "system_prompt_ids_json": json.dumps([]),
            "default_options_json": json.dumps({}),
            "rules_json": json.dumps({}),
            "requires_image": 1,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": json.dumps(
                [
                    {
                        "key": "subject_style",
                        "label": "Style Direction",
                        "placeholder": "Pixar-inspired studio lighting with premium skin detail",
                        "default_value": "Pixar-inspired studio lighting with premium skin detail",
                        "required": True,
                    }
                ]
            ),
            "input_slots_json": json.dumps(
                [
                    {
                        "key": "person",
                        "label": "Portrait",
                        "help_text": "Upload the reference portrait for the caricature.",
                        "required": True,
                        "max_files": 1,
                    }
                ]
            ),
            "choice_groups_json": json.dumps([]),
            "thumbnail_path": None,
            "thumbnail_url": None,
            "notes": "Built-in Nano Banana portrait workflow.",
            "version": "v1",
            "priority": 900,
            "created_at": utcnow_iso(),
            "updated_at": utcnow_iso(),
        },
        {
            "preset_id": "media-preset-selfie-with-movie-character-nano-banana-shared",
            "key": "selfie-with-movie-character-nano-banana",
            "label": "Selfie with Movie Character",
            "description": "Place your uploaded portrait into a polished selfie scene with a named movie character.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": json.dumps(["nano-banana-2", "nano-banana-pro"]),
            "applies_to_task_modes_json": json.dumps(["image_edit"]),
            "applies_to_input_patterns_json": json.dumps(["single_image", "image_edit"]),
            "prompt_template": "Create a premium selfie of [[person]] standing beside {{character_name}} from {{movie_name}}. Make the shot feel candid, cinematic, and believable with natural framing and polished lighting.",
            "system_prompt_template": "",
            "system_prompt_ids_json": json.dumps([]),
            "default_options_json": json.dumps({}),
            "rules_json": json.dumps({}),
            "requires_image": 1,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": json.dumps(
                [
                    {
                        "key": "character_name",
                        "label": "Character",
                        "placeholder": "John Wick",
                        "default_value": "",
                        "required": True,
                    },
                    {
                        "key": "movie_name",
                        "label": "Movie",
                        "placeholder": "John Wick Chapter 4",
                        "default_value": "",
                        "required": True,
                    },
                ]
            ),
            "input_slots_json": json.dumps(
                [
                    {
                        "key": "person",
                        "label": "Portrait",
                        "help_text": "Upload the portrait that should appear in the selfie.",
                        "required": True,
                        "max_files": 1,
                    }
                ]
            ),
            "choice_groups_json": json.dumps([]),
            "thumbnail_path": None,
            "thumbnail_url": None,
            "notes": "Built-in Nano Banana selfie composition workflow.",
            "version": "v1",
            "priority": 890,
            "created_at": utcnow_iso(),
            "updated_at": utcnow_iso(),
        },
    ]
    for row in seed_rows:
        insert_or_update(connection, "media_presets", "preset_id", row)


def _migrate_multi_model_seed_presets(connection: sqlite3.Connection) -> None:
    duplicate_groups = [
        (
            "media-preset-3d-caricature-style-nano-banana-shared",
            "3d-caricature-style-nano-banana",
            (
                "media-preset-3d-caricature-style-nano-banana-2",
                "media-preset-3d-caricature-style-nano-banana-pro",
            ),
        ),
        (
            "media-preset-selfie-with-movie-character-nano-banana-shared",
            "selfie-with-movie-character-nano-banana",
            (
                "media-preset-selfie-with-movie-character-nano-banana-2",
                "media-preset-selfie-with-movie-character-nano-banana-pro",
            ),
        ),
    ]

    for shared_id, shared_key, legacy_ids in duplicate_groups:
        shared_row = connection.execute(
            "SELECT * FROM media_presets WHERE preset_id = ?",
            (shared_id,),
        ).fetchone()
        rows = connection.execute(
            f"SELECT * FROM media_presets WHERE preset_id IN ({', '.join(['?'] * len(legacy_ids))}) ORDER BY updated_at DESC",
            legacy_ids,
        ).fetchall()
        if len(rows) != len(legacy_ids):
            continue
        canonical = decode_row(shared_row) if shared_row else decode_row(rows[0])
        canonical["preset_id"] = shared_id
        canonical["key"] = shared_key
        canonical["model_key"] = "nano-banana-2"
        canonical["applies_to_models_json"] = ["nano-banana-2", "nano-banana-pro"]
        canonical["applies_to_task_modes_json"] = ["image_edit"]
        canonical["applies_to_input_patterns_json"] = ["single_image", "image_edit"]
        canonical["updated_at"] = utcnow_iso()
        insert_or_update(connection, "media_presets", "preset_id", canonical)
        connection.execute(
            f"DELETE FROM media_presets WHERE preset_id IN ({', '.join(['?'] * len(legacy_ids))})",
            legacy_ids,
        )


def _seed_default_model_queue_policies(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT OR IGNORE INTO media_model_queue_policies (model_key, enabled, max_outputs_per_run, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        ("seedance-2.0", 0, 1, utcnow_iso()),
    )


def bootstrap_connection_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
            CREATE TABLE IF NOT EXISTS media_system_prompts (
                prompt_id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                content TEXT NOT NULL,
                role_tag TEXT,
                applies_to_models_json TEXT NOT NULL DEFAULT '[]',
                applies_to_task_modes_json TEXT NOT NULL DEFAULT '[]',
                applies_to_input_patterns_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_presets (
                preset_id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                model_key TEXT,
                source_kind TEXT NOT NULL DEFAULT 'custom',
                base_builtin_key TEXT,
                applies_to_models_json TEXT NOT NULL DEFAULT '[]',
                applies_to_task_modes_json TEXT NOT NULL DEFAULT '[]',
                applies_to_input_patterns_json TEXT NOT NULL DEFAULT '[]',
                prompt_template TEXT NOT NULL DEFAULT '',
                system_prompt_template TEXT NOT NULL DEFAULT '',
                system_prompt_ids_json TEXT NOT NULL DEFAULT '[]',
                default_options_json TEXT NOT NULL DEFAULT '{}',
                rules_json TEXT NOT NULL DEFAULT '{}',
                requires_image INTEGER NOT NULL DEFAULT 0,
                requires_video INTEGER NOT NULL DEFAULT 0,
                requires_audio INTEGER NOT NULL DEFAULT 0,
                input_schema_json TEXT NOT NULL DEFAULT '[]',
                input_slots_json TEXT NOT NULL DEFAULT '[]',
                choice_groups_json TEXT NOT NULL DEFAULT '[]',
                thumbnail_path TEXT,
                thumbnail_url TEXT,
                notes TEXT,
                version TEXT NOT NULL DEFAULT 'v1',
                priority INTEGER NOT NULL DEFAULT 100,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_enhancement_configs (
                config_id TEXT PRIMARY KEY,
                model_key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                helper_profile TEXT,
                provider_kind TEXT NOT NULL DEFAULT 'builtin',
                provider_label TEXT,
                provider_model_id TEXT,
                provider_api_key TEXT,
                provider_base_url TEXT,
                provider_supports_images INTEGER NOT NULL DEFAULT 0,
                provider_status TEXT,
                provider_last_tested_at TEXT,
                provider_capabilities_json TEXT NOT NULL DEFAULT '{}',
                system_prompt TEXT,
                image_analysis_prompt TEXT,
                supports_text_enhancement INTEGER NOT NULL DEFAULT 1,
                supports_image_analysis INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_queue_settings (
                setting_id INTEGER PRIMARY KEY CHECK (setting_id = 1),
                max_concurrent_jobs INTEGER NOT NULL DEFAULT 2,
                queue_enabled INTEGER NOT NULL DEFAULT 1,
                default_poll_seconds INTEGER NOT NULL DEFAULT 6,
                max_retry_attempts INTEGER NOT NULL DEFAULT 3,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_model_queue_policies (
                model_key TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                max_outputs_per_run INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_batches (
                batch_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                model_key TEXT NOT NULL,
                task_mode TEXT,
                requested_outputs INTEGER NOT NULL DEFAULT 1,
                queued_count INTEGER NOT NULL DEFAULT 0,
                running_count INTEGER NOT NULL DEFAULT 0,
                completed_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                cancelled_count INTEGER NOT NULL DEFAULT 0,
                source_asset_id TEXT,
                requested_preset_key TEXT,
                resolved_preset_key TEXT,
                preset_source TEXT,
                request_summary_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_jobs (
                job_id TEXT PRIMARY KEY,
                batch_id TEXT NOT NULL,
                batch_index INTEGER NOT NULL DEFAULT 0,
                requested_outputs INTEGER NOT NULL DEFAULT 1,
                provider_task_id TEXT,
                status TEXT NOT NULL,
                queued_at TEXT,
                started_at TEXT,
                finished_at TEXT,
                scheduler_attempts INTEGER NOT NULL DEFAULT 0,
                last_polled_at TEXT,
                queue_position INTEGER,
                model_key TEXT NOT NULL,
                task_mode TEXT,
                source_asset_id TEXT,
                requested_preset_key TEXT,
                resolved_preset_key TEXT,
                preset_source TEXT,
                raw_prompt TEXT,
                enhanced_prompt TEXT,
                final_prompt_used TEXT,
                selected_system_prompt_ids_json TEXT NOT NULL DEFAULT '[]',
                selected_system_prompts_json TEXT NOT NULL DEFAULT '[]',
                resolved_system_prompt_json TEXT NOT NULL DEFAULT '{}',
                resolved_options_json TEXT NOT NULL DEFAULT '{}',
                normalized_request_json TEXT NOT NULL DEFAULT '{}',
                prompt_context_json TEXT NOT NULL DEFAULT '{}',
                validation_json TEXT NOT NULL DEFAULT '{}',
                preflight_json TEXT NOT NULL DEFAULT '{}',
                prepared_json TEXT NOT NULL DEFAULT '{}',
                submit_response_json TEXT NOT NULL DEFAULT '{}',
                final_status_json TEXT NOT NULL DEFAULT '{}',
                artifact_json TEXT NOT NULL DEFAULT '{}',
                remote_output_url TEXT,
                error TEXT,
                dismissed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(batch_id) REFERENCES media_batches(batch_id)
            );

            CREATE TABLE IF NOT EXISTS media_job_events (
                event_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(job_id) REFERENCES media_jobs(job_id)
            );

            CREATE TABLE IF NOT EXISTS media_assets (
                asset_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                provider_task_id TEXT,
                run_id TEXT,
                source_asset_id TEXT,
                model_key TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'completed',
                task_mode TEXT,
                generation_kind TEXT NOT NULL DEFAULT 'image',
                prompt_summary TEXT,
                artifact_run_dir TEXT,
                manifest_path TEXT,
                run_json_path TEXT,
                source_path TEXT,
                hero_original_path TEXT,
                hero_web_path TEXT,
                hero_thumb_path TEXT,
                hero_poster_path TEXT,
                hero_original_url TEXT,
                hero_web_url TEXT,
                hero_thumb_url TEXT,
                hero_poster_url TEXT,
                remote_output_url TEXT,
                hidden_from_dashboard INTEGER NOT NULL DEFAULT 0,
                favorited INTEGER NOT NULL DEFAULT 0,
                favorited_at TEXT,
                dismissed INTEGER NOT NULL DEFAULT 0,
                preset_key TEXT,
                preset_source TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]',
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(job_id) REFERENCES media_jobs(job_id)
            );
        """
    )
    connection.execute(
        """
        INSERT OR IGNORE INTO media_queue_settings (setting_id, max_concurrent_jobs, queue_enabled, default_poll_seconds, max_retry_attempts)
        VALUES (1, 2, 1, 6, 3)
        """
    )
    ensure_column(connection, "media_system_prompts", "role_tag", "TEXT")
    ensure_column(connection, "media_system_prompts", "applies_to_models_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_system_prompts", "applies_to_task_modes_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_system_prompts", "applies_to_input_patterns_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "source_kind", "TEXT NOT NULL DEFAULT 'custom'")
    ensure_column(connection, "media_presets", "base_builtin_key", "TEXT")
    ensure_column(connection, "media_presets", "applies_to_models_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "applies_to_task_modes_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "applies_to_input_patterns_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "system_prompt_template", "TEXT NOT NULL DEFAULT ''")
    ensure_column(connection, "media_presets", "system_prompt_ids_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "input_slots_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "choice_groups_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "thumbnail_path", "TEXT")
    ensure_column(connection, "media_presets", "thumbnail_url", "TEXT")
    ensure_column(connection, "media_presets", "notes", "TEXT")
    ensure_column(connection, "media_presets", "version", "TEXT NOT NULL DEFAULT 'v1'")
    ensure_column(connection, "media_presets", "priority", "INTEGER NOT NULL DEFAULT 100")
    ensure_column(connection, "media_enhancement_configs", "provider_kind", "TEXT NOT NULL DEFAULT 'builtin'")
    ensure_column(connection, "media_enhancement_configs", "provider_label", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_model_id", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_api_key", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_base_url", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_supports_images", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(connection, "media_enhancement_configs", "provider_status", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_last_tested_at", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_capabilities_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "media_jobs", "remote_output_url", "TEXT")
    ensure_column(connection, "media_assets", "provider_task_id", "TEXT")
    ensure_column(connection, "media_assets", "run_id", "TEXT")
    ensure_column(connection, "media_assets", "source_asset_id", "TEXT")
    ensure_column(connection, "media_assets", "status", "TEXT NOT NULL DEFAULT 'completed'")
    ensure_column(connection, "media_assets", "task_mode", "TEXT")
    ensure_column(connection, "media_assets", "artifact_run_dir", "TEXT")
    ensure_column(connection, "media_assets", "manifest_path", "TEXT")
    ensure_column(connection, "media_assets", "run_json_path", "TEXT")
    ensure_column(connection, "media_assets", "hidden_from_dashboard", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(connection, "media_assets", "preset_key", "TEXT")
    ensure_column(connection, "media_assets", "preset_source", "TEXT")
    ensure_column(connection, "media_assets", "tags_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_assets", "payload_json", "TEXT NOT NULL DEFAULT '{}'")
    _migrate_multi_model_seed_presets(connection)
    _seed_default_presets(connection)
    _seed_default_model_queue_policies(connection)
