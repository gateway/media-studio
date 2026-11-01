from __future__ import annotations

from typing import Iterable


def content_project_ids(connection, table: str, record_id: str) -> set[str]:
    if table == "media_assets":
        rows = connection.execute("SELECT project_id FROM media_assets WHERE asset_id = ?", (record_id,)).fetchall()
    elif table == "reference_media":
        rows = connection.execute(
            "SELECT project_id FROM media_project_references WHERE reference_id = ?", (record_id,)
        ).fetchall()
    else:
        return set()
    return {row["project_id"] for row in rows if row["project_id"]}


def touch_projects(connection, project_ids: Iterable[str], activity_at: str) -> None:
    # Retain activity after content is moved/detached, without changing names,
    # status, created_at or other project metadata. Use the caller's transaction.
    for project_id in set(project_ids):
        connection.execute(
            "UPDATE media_projects SET updated_at = ? WHERE project_id = ? "
            "AND (updated_at IS NULL OR julianday(updated_at) < julianday(?))",
            (activity_at, project_id, activity_at),
        )
