from __future__ import annotations

import json

from typing import Any, Dict, List, Optional

from .db import get_connection
from .store_support import (
    decode_row as _decode_row,
    insert_or_update as _insert_or_update,
    new_id,
    upsert_table as _upsert_table,
    utcnow_iso,
)


def _list_by_session(table: str, session_id: str, order_by: str = "created_at ASC") -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            f"SELECT * FROM {table} WHERE assistant_session_id = ? ORDER BY {order_by}",
            (session_id,),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def create_or_update_assistant_session(payload: Dict[str, Any]) -> Dict[str, Any]:
    item = payload.copy()
    now = utcnow_iso()
    item.setdefault("assistant_session_id", new_id("asst"))
    item.setdefault("owner_kind", "standalone")
    item.setdefault("status", "active")
    item.setdefault("summary_json", {})
    item.setdefault("state_snapshot_json", {})
    item.setdefault("created_at", now)
    item["updated_at"] = now
    return _upsert_table("assistant_sessions", "assistant_session_id", item)


def get_assistant_session(session_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM assistant_sessions WHERE assistant_session_id = ? LIMIT 1",
            (session_id,),
        ).fetchone()
    return _decode_row(row) if row else None


def list_assistant_sessions(owner_kind: Optional[str] = None, owner_id: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
    clauses = ["status != 'archived'"]
    params: list[Any] = []
    if owner_kind:
        clauses.append("owner_kind = ?")
        params.append(owner_kind)
    if owner_id:
        clauses.append("owner_id = ?")
        params.append(owner_id)
    params.append(limit)
    with get_connection() as connection:
        rows = connection.execute(
            f"SELECT * FROM assistant_sessions WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC LIMIT ?",
            tuple(params),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def archive_assistant_session(session_id: str) -> Dict[str, Any]:
    current = get_assistant_session(session_id)
    if not current:
        raise KeyError("assistant session not found")
    current["status"] = "archived"
    return create_or_update_assistant_session(current)


def create_assistant_message(payload: Dict[str, Any]) -> Dict[str, Any]:
    item = payload.copy()
    item.setdefault("assistant_message_id", new_id("asmsg"))
    item.setdefault("content_json", {})
    item.setdefault("created_at", utcnow_iso())
    with get_connection() as connection:
        _insert_or_update(connection, "assistant_messages", "assistant_message_id", item)
    return get_assistant_message(item["assistant_message_id"])  # type: ignore[arg-type]


def get_assistant_message(message_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM assistant_messages WHERE assistant_message_id = ? LIMIT 1",
            (message_id,),
        ).fetchone()
    return _decode_row(row) if row else None


def list_assistant_messages(session_id: str) -> List[Dict[str, Any]]:
    return _list_by_session("assistant_messages", session_id)



def recent_assistant_conversation(session_id: str, exclude_message_id: Optional[str] = None) -> List[Dict[str, str]]:
    """Six eligible messages, chronological with message-ID ordering for timestamp ties."""
    with get_connection() as connection:
        rows = connection.execute(
            """SELECT role, substr(COALESCE(content_text, ''), 1, 800) AS text
               FROM assistant_messages
               WHERE assistant_session_id = ? AND role IN ('user', 'assistant')
                 AND assistant_message_id != COALESCE(?, '')
               ORDER BY created_at DESC, assistant_message_id DESC LIMIT 6""",
            (session_id, exclude_message_id),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def latest_saved_assistant_artifact(session_id: str, exclude_message_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Read one valid saved-artifact object even when older than the recent-message window."""
    with get_connection() as connection:
        row = connection.execute(
            """SELECT json_extract(content_json, '$.saved_artifact') AS artifact
               FROM assistant_messages
               WHERE assistant_session_id = ? AND role = 'system_summary'
                 AND assistant_message_id != COALESCE(?, '')
                 AND CASE WHEN json_valid(content_json)
                          THEN json_type(content_json, '$.saved_artifact') END = 'object'
               ORDER BY created_at DESC, assistant_message_id DESC LIMIT 1""",
            (session_id, exclude_message_id),
        ).fetchone()
    return json.loads(row['artifact']) if row else None


def create_assistant_attachment(payload: Dict[str, Any]) -> Dict[str, Any]:
    item = payload.copy()
    item.setdefault("assistant_attachment_id", new_id("asatt"))
    item.setdefault("kind", "image")
    item.setdefault("metadata_json", {})
    item.setdefault("created_at", utcnow_iso())
    with get_connection() as connection:
        _insert_or_update(connection, "assistant_attachments", "assistant_attachment_id", item)
    return get_assistant_attachment(item["assistant_attachment_id"])  # type: ignore[arg-type]


def get_assistant_attachment(attachment_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM assistant_attachments WHERE assistant_attachment_id = ? LIMIT 1",
            (attachment_id,),
        ).fetchone()
    return _decode_row(row) if row else None


def list_assistant_attachments(session_id: str) -> List[Dict[str, Any]]:
    return _list_by_session("assistant_attachments", session_id)


def delete_assistant_attachment(session_id: str, attachment_id: str) -> None:
    with get_connection() as connection:
        connection.execute(
            "DELETE FROM assistant_attachments WHERE assistant_session_id = ? AND assistant_attachment_id = ?",
            (session_id, attachment_id),
        )


def create_or_update_assistant_plan(payload: Dict[str, Any]) -> Dict[str, Any]:
    item = payload.copy()
    now = utcnow_iso()
    item.setdefault("assistant_plan_id", new_id("asplan"))
    item.setdefault("status", "draft")
    item.setdefault("capability", "plan_graph")
    item.setdefault("plan_json", {})
    item.setdefault("validation_json", {})
    item.setdefault("pricing_json", {})
    item.setdefault("workflow_json", {})
    item.setdefault("created_at", now)
    item["updated_at"] = now
    return _upsert_table("assistant_plans", "assistant_plan_id", item)


def get_assistant_plan(plan_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM assistant_plans WHERE assistant_plan_id = ? LIMIT 1",
            (plan_id,),
        ).fetchone()
    return _decode_row(row) if row else None


def list_assistant_plans(session_id: str) -> List[Dict[str, Any]]:
    return _list_by_session("assistant_plans", session_id, order_by="created_at DESC")


def reject_validated_assistant_plans(session_id: str) -> None:
    for plan in list_assistant_plans(session_id):
        if str(plan.get("status") or "") != "validated":
            continue
        create_or_update_assistant_plan({**plan, "status": "rejected"})


def create_assistant_turn_usage(payload: Dict[str, Any]) -> Dict[str, Any]:
    item = payload.copy()
    item.setdefault("assistant_turn_usage_id", new_id("asuse"))
    item.setdefault("provider_kind", "codex_local")
    item.setdefault("image_count", 0)
    item.setdefault("cost_usd", 0.0)
    item.setdefault("usage_json", {})
    item.setdefault("created_at", utcnow_iso())
    with get_connection() as connection:
        _insert_or_update(connection, "assistant_turn_usage", "assistant_turn_usage_id", item)
    return get_assistant_turn_usage(item["assistant_turn_usage_id"])  # type: ignore[arg-type]


def get_assistant_turn_usage(turn_usage_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM assistant_turn_usage WHERE assistant_turn_usage_id = ? LIMIT 1",
            (turn_usage_id,),
        ).fetchone()
    return _decode_row(row) if row else None


def list_assistant_turn_usage(session_id: str) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM assistant_turn_usage
            WHERE assistant_session_id = ?
            ORDER BY created_at DESC
            """,
            (session_id,),
        ).fetchall()
    return [_decode_row(row) for row in rows]
