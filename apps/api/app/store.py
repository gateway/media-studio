from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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


def _encode(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def _decode_row(row: sqlite3.Row) -> Dict[str, Any]:
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


def _connect_path(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def _bootstrap_schema(connection: sqlite3.Connection) -> None:
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
                generation_kind TEXT,
                favorited INTEGER NOT NULL DEFAULT 0,
                favorited_at TEXT,
                dismissed INTEGER NOT NULL DEFAULT 0,
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
                FOREIGN KEY(job_id) REFERENCES media_jobs(job_id)
            );

            CREATE INDEX IF NOT EXISTS idx_media_jobs_status_queue ON media_jobs(status, queue_position);
            CREATE INDEX IF NOT EXISTS idx_media_jobs_batch_id ON media_jobs(batch_id);
            CREATE INDEX IF NOT EXISTS idx_media_jobs_provider_task_id ON media_jobs(provider_task_id);
            CREATE INDEX IF NOT EXISTS idx_media_batches_status_created ON media_batches(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(created_at DESC);
        """
    )
    connection.execute(
        """
        INSERT INTO media_queue_settings (
            setting_id, max_concurrent_jobs, queue_enabled, default_poll_seconds, max_retry_attempts
        )
        VALUES (1, 2, 1, 6, 3)
        ON CONFLICT(setting_id) DO NOTHING
        """
    )
    _ensure_column(connection, "media_jobs", "dismissed", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(connection, "media_assets", "dismissed", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(connection, "media_presets", "source_kind", "TEXT NOT NULL DEFAULT 'custom'")
    _ensure_column(connection, "media_presets", "base_builtin_key", "TEXT")
    _ensure_column(connection, "media_presets", "applies_to_models_json", "TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(connection, "media_presets", "applies_to_task_modes_json", "TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(connection, "media_presets", "applies_to_input_patterns_json", "TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(connection, "media_presets", "system_prompt_template", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(connection, "media_presets", "system_prompt_ids_json", "TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(connection, "media_presets", "rules_json", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(connection, "media_presets", "notes", "TEXT")
    _ensure_column(connection, "media_presets", "version", "TEXT NOT NULL DEFAULT 'v1'")
    _ensure_column(connection, "media_presets", "priority", "INTEGER NOT NULL DEFAULT 100")
    _ensure_column(connection, "media_enhancement_configs", "provider_kind", "TEXT NOT NULL DEFAULT 'builtin'")
    _ensure_column(connection, "media_enhancement_configs", "provider_label", "TEXT")
    _ensure_column(connection, "media_enhancement_configs", "provider_model_id", "TEXT")
    _ensure_column(connection, "media_enhancement_configs", "provider_api_key", "TEXT")
    _ensure_column(connection, "media_enhancement_configs", "provider_base_url", "TEXT")
    _ensure_column(connection, "media_enhancement_configs", "provider_supports_images", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(connection, "media_enhancement_configs", "provider_status", "TEXT")
    _ensure_column(connection, "media_enhancement_configs", "provider_last_tested_at", "TEXT")
    _ensure_column(connection, "media_enhancement_configs", "provider_capabilities_json", "TEXT NOT NULL DEFAULT '{}'")
    _migrate_multi_model_seed_presets(connection)
    _seed_default_presets(connection)


def bootstrap_schema(db_path: Optional[Path] = None) -> None:
    if db_path is None:
        with get_connection() as connection:
            _bootstrap_schema(connection)
        return

    connection = _connect_path(Path(db_path))
    try:
        _bootstrap_schema(connection)
        connection.commit()
    finally:
        connection.close()


def _ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
    rows = connection.execute("PRAGMA table_info(%s)" % table_name).fetchall()
    existing = {row["name"] for row in rows}
    if column_name in existing:
        return
    connection.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table_name, column_name, definition))


def _table_columns(connection: sqlite3.Connection, table_name: str) -> set[str]:
    rows = connection.execute("PRAGMA table_info(%s)" % table_name).fetchall()
    return {row["name"] for row in rows}


def get_queue_settings() -> Dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT setting_id, max_concurrent_jobs, queue_enabled, default_poll_seconds, max_retry_attempts FROM media_queue_settings WHERE setting_id = 1"
        ).fetchone()
    if row is None:
        raise RuntimeError("queue settings row is missing")
    return _decode_row(row)


def update_queue_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    current = get_queue_settings()
    merged = current.copy()
    merged.update(dict((k, v) for k, v in payload.items() if v is not None))
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE media_queue_settings
            SET max_concurrent_jobs = ?, queue_enabled = ?, default_poll_seconds = ?, max_retry_attempts = ?, updated_at = ?
            WHERE setting_id = 1
            """,
            (
                merged["max_concurrent_jobs"],
                1 if merged["queue_enabled"] else 0,
                merged["default_poll_seconds"],
                merged["max_retry_attempts"],
                utcnow_iso(),
            ),
        )
    return get_queue_settings()


def list_model_queue_policies() -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT model_key, enabled, max_outputs_per_run, updated_at FROM media_model_queue_policies ORDER BY model_key ASC"
        ).fetchall()
    return [_decode_row(row) for row in rows]


def upsert_model_queue_policy(model_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    current = get_model_queue_policy(model_key) or {
        "model_key": model_key,
        "enabled": True,
        "max_outputs_per_run": 1,
    }
    current.update(dict((k, v) for k, v in payload.items() if v is not None))
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO media_model_queue_policies (model_key, enabled, max_outputs_per_run, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(model_key) DO UPDATE SET enabled = excluded.enabled, max_outputs_per_run = excluded.max_outputs_per_run, updated_at = excluded.updated_at
            """,
            (
                model_key,
                1 if current["enabled"] else 0,
                current["max_outputs_per_run"],
                utcnow_iso(),
            ),
        )
    return get_model_queue_policy(model_key)  # type: ignore


def get_model_queue_policy(model_key: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT model_key, enabled, max_outputs_per_run, updated_at FROM media_model_queue_policies WHERE model_key = ?",
            (model_key,),
        ).fetchone()
    return _decode_row(row) if row else None


def _list_table(table: str, order_by: str = "created_at DESC") -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM %s ORDER BY %s" % (table, order_by)).fetchall()
    return [_decode_row(row) for row in rows]


def _get_table(table: str, pk_field: str, pk_value: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM %s WHERE %s = ?" % (table, pk_field),
            (pk_value,),
        ).fetchone()
    return _decode_row(row) if row else None


def _delete_table(table: str, pk_field: str, pk_value: str) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM %s WHERE %s = ?" % (table, pk_field), (pk_value,))


def _upsert_table(table: str, pk_field: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    now = utcnow_iso()
    resolved = payload.copy()
    resolved.setdefault(pk_field, new_id(pk_field.replace("_id", "")))
    resolved.setdefault("created_at", now)
    with get_connection() as connection:
        existing_columns = _table_columns(connection, table)
        if "updated_at" in existing_columns:
            resolved["updated_at"] = now
        resolved = {key: value for key, value in resolved.items() if key in existing_columns}
        columns = sorted(resolved.keys())
        placeholders = ", ".join(["?"] * len(columns))
        updates = ", ".join(
            ["%s = excluded.%s" % (column, column) for column in columns if column not in {pk_field, "created_at"}]
        )
        values = [_encode(resolved[column]) for column in columns]
        connection.execute(
            "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s"
            % (table, ", ".join(columns), placeholders, pk_field, updates),
            values,
        )
    return _get_table(table, pk_field, resolved[pk_field])  # type: ignore


def list_presets() -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM media_presets WHERE status != 'archived' ORDER BY priority DESC, updated_at DESC, key ASC"
        ).fetchall()
    return [_decode_row(row) for row in rows]


def get_preset(preset_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_presets", "preset_id", preset_id)


def create_or_update_preset(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _upsert_table("media_presets", "preset_id", payload)


def delete_preset(preset_id: str) -> Dict[str, Any]:
    record = get_preset(preset_id)
    if record is None:
        raise FileNotFoundError("preset not found")
    record["status"] = "archived"
    return create_or_update_preset(record)


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
            "applies_to_models_json": ["nano-banana-2", "nano-banana-pro"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": "Create a polished high-quality 3D caricature portrait of the person in [[person]], transforming them into a smaller, stylized, exaggerated version of themselves while preserving clear identity and recognizable resemblance. Emphasize their most distinctive facial traits in a playful caricature way, with an oversized head, expressive features, smooth sculpted forms, detailed facial rendering, soft studio lighting, and a premium animated collectible look. caricature style.",
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": True,
            "requires_video": False,
            "requires_audio": False,
            "input_schema_json": [],
            "input_slots_json": [{"key": "person", "label": "Photo of You", "help_text": "Upload a clear portrait photo to turn into a 3D caricature.", "required": True, "max_files": 1}],
            "choice_groups_json": [],
            "thumbnail_path": None,
            "thumbnail_url": None,
            "notes": None,
            "version": "v1",
            "priority": 100,
            "created_at": "2026-03-29 10:09:00",
            "updated_at": "2026-03-29 10:09:00",
        },
        {
            "preset_id": "media-preset-selfie-with-movie-character-nano-banana-shared",
            "key": "selfie-with-movie-character-nano-banana",
            "label": "Selfie with Movie Character",
            "description": "Take a selfie with a movie character while preserving your features. Add the movie star name and movie in the fields.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["nano-banana-2", "nano-banana-pro"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": "Use [[yourphoto]] as the base person taking a selfie with {{actor}} on the set of {{movie}}\\n\\nKeep the person exactly as shown in the reference image with 100% identical facial features, bone structure, skin tone, facial expression, pose, and appearance. ratio, 4K detail.",
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": True,
            "requires_video": False,
            "requires_audio": False,
            "input_schema_json": [{"key": "actor", "label": "Movie Actor", "placeholder": "Leonardo DiCaprio", "default_value": "", "required": True}, {"key": "movie", "label": "Movie Name", "placeholder": "The Revenant", "default_value": "", "required": True}],
            "input_slots_json": [{"key": "yourphoto", "label": "Your Photo", "help_text": "A close up photo of yourself.", "required": True, "max_files": 1}],
            "choice_groups_json": [],
            "thumbnail_path": None,
            "thumbnail_url": None,
            "notes": None,
            "version": "v1",
            "priority": 100,
            "created_at": "2026-03-29 10:09:00",
            "updated_at": "2026-03-29 10:09:00",
        },
    ]
    for row in seed_rows:
        resolved = {key: _encode(value) for key, value in row.items()}
        columns = list(resolved.keys())
        placeholders = ", ".join(["?"] * len(columns))
        connection.execute(
            f"INSERT INTO media_presets ({', '.join(columns)}) VALUES ({placeholders}) ON CONFLICT(preset_id) DO NOTHING",
            [resolved[column] for column in columns],
        )


def _migrate_multi_model_seed_presets(connection: sqlite3.Connection) -> None:
    duplicate_groups = [
        (
            "media-preset-3d-caricature-style-nano-banana-shared",
            "3d-caricature-style-nano-banana",
            [
                "media-preset-3d-caricature-style-nano-banana-2",
                "media-preset-3d-caricature-style-nano-banana-pro",
            ],
        ),
        (
            "media-preset-selfie-with-movie-character-nano-banana-shared",
            "selfie-with-movie-character-nano-banana",
            [
                "media-preset-selfie-with-movie-character-nano-banana-2",
                "media-preset-selfie-with-movie-character-nano-banana-pro",
            ],
        ),
    ]
    for shared_id, shared_key, legacy_ids in duplicate_groups:
        existing_shared = connection.execute(
            "SELECT preset_id FROM media_presets WHERE preset_id = ? OR key = ?",
            (shared_id, shared_key),
        ).fetchone()
        if existing_shared:
            continue
        rows = connection.execute(
            f"SELECT * FROM media_presets WHERE preset_id IN ({', '.join(['?'] * len(legacy_ids))}) ORDER BY updated_at DESC",
            legacy_ids,
        ).fetchall()
        if len(rows) != len(legacy_ids):
            continue
        decoded_rows = [_decode_row(row) for row in rows]
        if any(row.get("status") != "active" for row in decoded_rows):
            continue
        base = decoded_rows[0]
        second = decoded_rows[1]
        compare_keys = [
            "label",
            "description",
            "source_kind",
            "base_builtin_key",
            "prompt_template",
            "system_prompt_template",
            "system_prompt_ids_json",
            "default_options_json",
            "rules_json",
            "requires_image",
            "requires_video",
            "requires_audio",
            "input_schema_json",
            "input_slots_json",
            "choice_groups_json",
            "thumbnail_path",
            "thumbnail_url",
            "notes",
            "version",
            "priority",
        ]
        if any(base.get(key) != second.get(key) for key in compare_keys):
            continue
        merged = dict(base)
        merged["preset_id"] = shared_id
        merged["key"] = shared_key
        merged["model_key"] = "nano-banana-2"
        merged["applies_to_models_json"] = ["nano-banana-2", "nano-banana-pro"]
        columns = [column for column in sorted(merged.keys()) if column in _table_columns(connection, "media_presets")]
        values = [_encode(merged[column]) for column in columns]
        placeholders = ", ".join(["?"] * len(columns))
        connection.execute(
            f"INSERT INTO media_presets ({', '.join(columns)}) VALUES ({placeholders})",
            values,
        )
        connection.execute(
            f"DELETE FROM media_presets WHERE preset_id IN ({', '.join(['?'] * len(legacy_ids))})",
            legacy_ids,
        )


def list_system_prompts() -> List[Dict[str, Any]]:
    return _list_table("media_system_prompts", "created_at DESC, label ASC")


def get_system_prompt(prompt_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_system_prompts", "prompt_id", prompt_id)


def create_or_update_system_prompt(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _upsert_table("media_system_prompts", "prompt_id", payload)


def delete_system_prompt(prompt_id: str) -> None:
    _delete_table("media_system_prompts", "prompt_id", prompt_id)


def list_enhancement_configs() -> List[Dict[str, Any]]:
    return _list_table("media_enhancement_configs", "model_key ASC")


def get_enhancement_config(model_key: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_enhancement_configs", "model_key", model_key)


def create_or_update_enhancement_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    if "config_id" not in payload:
        payload = payload.copy()
        payload["config_id"] = payload.get("model_key") or new_id("cfg")
    return _upsert_table("media_enhancement_configs", "model_key", payload)


def delete_enhancement_config(model_key: str) -> None:
    _delete_table("media_enhancement_configs", "model_key", model_key)


def create_batch_and_jobs(batch_payload: Dict[str, Any], jobs_payloads: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    now = utcnow_iso()
    batch = batch_payload.copy()
    batch.setdefault("batch_id", new_id("batch"))
    batch.setdefault("status", "queued")
    batch.setdefault("created_at", now)
    batch["updated_at"] = now
    batch = _upsert_table("media_batches", "batch_id", batch)
    created_jobs = []
    with get_connection() as connection:
        next_position = _next_queue_position(connection)
        for index, payload in enumerate(jobs_payloads):
            job = payload.copy()
            job.setdefault("job_id", new_id("job"))
            job["batch_id"] = batch["batch_id"]
            job.setdefault("batch_index", index)
            job.setdefault("requested_outputs", 1)
            job.setdefault("status", "queued")
            job.setdefault("queue_position", next_position)
            job.setdefault("queued_at", now)
            job.setdefault("created_at", now)
            job["updated_at"] = now
            _insert_or_update(connection, "media_jobs", "job_id", job)
            created_jobs.append(job["job_id"])
            next_position += 1
    recompute_batch_counts(batch["batch_id"])
    return get_batch(batch["batch_id"]), [get_job(job_id) for job_id in created_jobs]  # type: ignore


def _insert_or_update(connection: sqlite3.Connection, table: str, pk_field: str, payload: Dict[str, Any]) -> None:
    columns = sorted(payload.keys())
    placeholders = ", ".join(["?"] * len(columns))
    updates = ", ".join(
        ["%s = excluded.%s" % (column, column) for column in columns if column != pk_field]
    )
    connection.execute(
        "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s"
        % (table, ", ".join(columns), placeholders, pk_field, updates),
        [_encode(payload[column]) for column in columns],
    )


def _next_queue_position(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COALESCE(MAX(queue_position), 0) + 1 AS next_position FROM media_jobs").fetchone()
    return int(row["next_position"])


def get_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_batches", "batch_id", batch_id)


def count_batches() -> int:
    with get_connection() as connection:
        row = connection.execute("SELECT COUNT(*) AS total FROM media_batches").fetchone()
    return int(row["total"] if row else 0)


def list_batches(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM media_batches ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def list_jobs_for_batches(batch_ids: List[str], include_dismissed: bool = True) -> List[Dict[str, Any]]:
    if not batch_ids:
        return []
    placeholders = ",".join("?" for _ in batch_ids)
    clauses = [f"batch_id IN ({placeholders})"]
    params: List[Any] = list(batch_ids)
    if not include_dismissed:
        clauses.append("dismissed = 0")
    query = f"SELECT * FROM media_jobs WHERE {' AND '.join(clauses)} ORDER BY created_at DESC"
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_decode_row(row) for row in rows]


def update_batch(batch_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    current = get_batch(batch_id)
    if not current:
        raise KeyError("batch not found")
    current.update(payload)
    current["updated_at"] = utcnow_iso()
    return _upsert_table("media_batches", "batch_id", current)


def list_jobs(limit: int = 200, include_dismissed: bool = False) -> List[Dict[str, Any]]:
    query = "SELECT * FROM media_jobs %s ORDER BY created_at DESC LIMIT ?"
    clause = "" if include_dismissed else "WHERE dismissed = 0"
    with get_connection() as connection:
        rows = connection.execute(query % clause, (limit,)).fetchall()
    return [_decode_row(row) for row in rows]


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_jobs", "job_id", job_id)


def update_job(job_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    current = get_job(job_id)
    if not current:
        raise KeyError("job not found")
    current.update(payload)
    current["updated_at"] = utcnow_iso()
    return _upsert_table("media_jobs", "job_id", current)


def append_job_event(job_id: str, event_type: str, payload: Dict[str, Any]) -> None:
    event_payload = {
        "event_id": new_id("event"),
        "job_id": job_id,
        "event_type": event_type,
        "payload_json": payload,
        "created_at": utcnow_iso(),
    }
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO media_job_events (event_id, job_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                event_payload["event_id"],
                event_payload["job_id"],
                event_payload["event_type"],
                _encode(event_payload["payload_json"]),
                event_payload["created_at"],
            ),
        )


def list_job_events(job_id: str) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM media_job_events WHERE job_id = ? ORDER BY created_at ASC",
            (job_id,),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def list_assets(limit: int = 100, cursor: Optional[str] = None, favorites_only: bool = False, media_type: Optional[str] = None) -> List[Dict[str, Any]]:
    clauses = ["dismissed = 0"]
    params: List[Any] = []
    if cursor:
        clauses.append("created_at < ?")
        params.append(cursor)
    if favorites_only:
        clauses.append("favorited = 1")
    if media_type == "image":
        clauses.append("hero_thumb_path IS NOT NULL")
    if media_type == "video":
        clauses.append("hero_poster_path IS NOT NULL")
    query = "SELECT * FROM media_assets WHERE %s ORDER BY created_at DESC LIMIT ?" % " AND ".join(clauses)
    params.append(limit)
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_decode_row(row) for row in rows]


def get_asset(asset_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_assets", "asset_id", asset_id)


def create_or_update_asset(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload.copy()
    payload.setdefault("asset_id", new_id("asset"))
    payload.setdefault("created_at", utcnow_iso())
    return _upsert_table("media_assets", "asset_id", payload)


def mark_asset_favorite(asset_id: str, favorited: bool) -> Dict[str, Any]:
    return create_or_update_asset(
        dict(get_asset(asset_id) or {}, asset_id=asset_id, favorited=favorited, favorited_at=utcnow_iso() if favorited else None)
    )


def mark_asset_dismissed(asset_id: str) -> Dict[str, Any]:
    return create_or_update_asset(dict(get_asset(asset_id) or {}, asset_id=asset_id, dismissed=True))


def mark_job_dismissed(job_id: str) -> Dict[str, Any]:
    return update_job(job_id, {"dismissed": True})


def queued_jobs(limit: int) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM media_jobs WHERE status = 'queued' AND dismissed = 0 ORDER BY queue_position ASC, created_at ASC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def active_jobs() -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM media_jobs WHERE status IN ('submitted', 'running') ORDER BY updated_at ASC"
        ).fetchall()
    return [_decode_row(row) for row in rows]


def queued_job_count() -> int:
    with get_connection() as connection:
        row = connection.execute("SELECT COUNT(*) AS count FROM media_jobs WHERE status = 'queued' AND dismissed = 0").fetchone()
    return int(row["count"])


def running_job_count() -> int:
    with get_connection() as connection:
        row = connection.execute("SELECT COUNT(*) AS count FROM media_jobs WHERE status IN ('submitted', 'running')").fetchone()
    return int(row["count"])


def recompute_batch_counts(batch_id: str) -> Dict[str, Any]:
    with get_connection() as connection:
        rows = connection.execute("SELECT status FROM media_jobs WHERE batch_id = ?", (batch_id,)).fetchall()
        statuses = [row["status"] for row in rows]
        queued_count = len([s for s in statuses if s == "queued"])
        running_count = len([s for s in statuses if s in ("submitted", "running")])
        completed_count = len([s for s in statuses if s == "completed"])
        failed_count = len([s for s in statuses if s == "failed"])
        cancelled_count = len([s for s in statuses if s == "cancelled"])
        if not statuses:
            status = "queued"
        elif completed_count == len(statuses):
            status = "completed"
        elif failed_count == len(statuses):
            status = "failed"
        elif cancelled_count == len(statuses):
            status = "cancelled"
        elif completed_count and failed_count:
            status = "partial_failure"
        elif queued_count or running_count:
            status = "processing" if running_count else "queued"
        else:
            status = "processing"
        connection.execute(
            """
            UPDATE media_batches
            SET status = ?, queued_count = ?, running_count = ?, completed_count = ?, failed_count = ?, cancelled_count = ?, updated_at = ?
            WHERE batch_id = ?
            """,
            (status, queued_count, running_count, completed_count, failed_count, cancelled_count, utcnow_iso(), batch_id),
        )
    return get_batch(batch_id)  # type: ignore


def repair_queue_positions() -> int:
    jobs = queued_jobs(100000)
    repaired = 0
    with get_connection() as connection:
        for index, job in enumerate(jobs, start=1):
            if job.get("queue_position") != index:
                repaired += 1
                connection.execute(
                    "UPDATE media_jobs SET queue_position = ?, updated_at = ? WHERE job_id = ?",
                    (index, utcnow_iso(), job["job_id"]),
                )
    return repaired


def reset_invalid_active_jobs() -> int:
    jobs = active_jobs()
    repaired = 0
    with get_connection() as connection:
        next_position = _next_queue_position(connection)
        for job in jobs:
            if job["status"] in {"submitted", "running"} and not job.get("provider_task_id"):
                repaired += 1
                connection.execute(
                    """
                    UPDATE media_jobs
                    SET status = 'queued', queue_position = ?, started_at = NULL, error = NULL, updated_at = ?
                    WHERE job_id = ?
                    """,
                    (next_position, utcnow_iso(), job["job_id"]),
                )
                next_position += 1
    return repaired


def open_batch_ids() -> List[str]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT batch_id FROM media_batches WHERE status IN ('queued', 'processing', 'partial_failure')"
        ).fetchall()
    return [row["batch_id"] for row in rows]
