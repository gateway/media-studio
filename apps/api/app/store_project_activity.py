from __future__ import annotations

from typing import Any, Dict, List, Optional

from .db import get_connection
from .store_support import decode_row


# Project metadata and recorded content share one effective activity date. Derive
# it on reads as well, so pre-existing stale projects need no timestamp migration.
_PROJECT_ACTIVITY_QUERY = """
    SELECT p.*, (
        SELECT activity_at FROM (
            SELECT p.updated_at AS activity_at
            UNION ALL SELECT p.created_at
            UNION ALL SELECT created_at FROM media_assets WHERE project_id = p.project_id
            UNION ALL SELECT updated_at FROM media_assets WHERE project_id = p.project_id
            UNION ALL SELECT created_at FROM media_project_references WHERE project_id = p.project_id
            UNION ALL SELECT rm.updated_at
                FROM media_project_references pr
                JOIN reference_media rm ON rm.reference_id = pr.reference_id
                WHERE pr.project_id = p.project_id
        )
        WHERE julianday(activity_at) IS NOT NULL
        ORDER BY julianday(activity_at) DESC, activity_at DESC LIMIT 1
    ) AS activity_at
    FROM media_projects p
"""


def _project_record(row) -> Dict[str, Any]:
    record = decode_row(row)
    record["updated_at"] = record.pop("activity_at") or record.get("updated_at")
    return record


def list_projects(status: Optional[str] = "active") -> List[Dict[str, Any]]:
    params = []
    query = _PROJECT_ACTIVITY_QUERY
    if status and status != "all":
        query += " WHERE p.status = ?"
        params.append(status)
    query += " ORDER BY julianday(activity_at) DESC, p.name ASC, p.project_id ASC"
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_project_record(row) for row in rows]


def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(_PROJECT_ACTIVITY_QUERY + " WHERE p.project_id = ?", (project_id,)).fetchone()
    return _project_record(row) if row else None
