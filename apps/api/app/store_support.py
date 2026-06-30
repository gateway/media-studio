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
    "output_contract_json",
    "input_schema_json",
    "input_variables_json",
    "custom_fields_json",
    "image_input_json",
    "validation_warnings_json",
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
    "metadata_json",
    "summary_json",
    "state_snapshot_json",
    "content_json",
    "plan_json",
    "pricing_json",
    "workflow_json",
    "compiled_graph_json",
    "definition_json",
    "definitions_json",
    "node_snapshot_json",
    "input_snapshot_json",
    "output_snapshot_json",
    "metrics_json",
    "error_json",
    "transform_params_json",
    "value_json",
    "usage_json",
}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return "%s_%s" % (prefix, uuid.uuid4().hex[:12])


def _json_default(column: str) -> Any:
    if column.endswith("_json"):
        if column in {
            "input_slots_json",
            "input_variables_json",
            "custom_fields_json",
            "validation_warnings_json",
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
            "hidden_from_dashboard",
            "hidden_from_global_gallery",
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


def table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (table_name,),
    ).fetchone()
    return row is not None


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
    existing_columns = table_columns(connection, table)
    resolved = {key: value for key, value in payload.items() if key in existing_columns}
    columns = sorted(resolved.keys())
    placeholders = ", ".join(["?"] * len(columns))
    updates = ", ".join(
        ["%s = excluded.%s" % (column, column) for column in columns if column != pk_field]
    )
    connection.execute(
        "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s"
        % (table, ", ".join(columns), placeholders, pk_field, updates),
        [encode_value(resolved[column]) for column in columns],
    )


def next_queue_position(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COALESCE(MAX(queue_position), 0) + 1 AS next_position FROM media_jobs").fetchone()
    return int(row["next_position"])



def database_has_user_schema(connection: sqlite3.Connection) -> bool:
    from .store_schema import database_has_user_schema as _database_has_user_schema

    return _database_has_user_schema(connection)


def list_pending_migrations(connection: sqlite3.Connection):
    from .store_schema import list_pending_migrations as _list_pending_migrations

    return _list_pending_migrations(connection)


def schema_status(connection: sqlite3.Connection) -> Dict[str, Any]:
    from .store_schema import schema_status as _schema_status

    return _schema_status(connection)


def bootstrap_connection_schema(connection: sqlite3.Connection) -> None:
    from .store_schema import bootstrap_connection_schema as _bootstrap_connection_schema

    _bootstrap_connection_schema(connection)
