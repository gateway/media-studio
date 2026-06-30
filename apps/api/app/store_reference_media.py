from __future__ import annotations

from typing import Any, Dict, List, Optional

from .db import get_connection
from .store_support import (
    decode_row as _decode_row,
    get_table as _get_table,
    new_id,
    upsert_table as _upsert_table,
    utcnow_iso,
)


def _like_search_pattern(query: Optional[str]) -> Optional[str]:
    cleaned = " ".join(str(query or "").strip().lower().split())
    if not cleaned:
        return None
    return (
        "%"
        + cleaned.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        + "%"
    )


def list_project_references(project_id: str, *, kind: Optional[str] = None, status: str = "active") -> List[Dict[str, Any]]:
    clauses = ["mpr.project_id = ?"]
    params: List[Any] = [project_id]
    if status:
        clauses.append("rm.status = ?")
        params.append(status)
    if kind:
        clauses.append("rm.kind = ?")
        params.append(kind)
    query = """
        SELECT rm.*
        FROM media_project_references mpr
        INNER JOIN reference_media rm ON rm.reference_id = mpr.reference_id
        WHERE %s
        ORDER BY mpr.created_at DESC, rm.last_used_at DESC, rm.created_at DESC
    """ % " AND ".join(clauses)
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return _attach_project_ids_to_reference_records([_decode_row(row) for row in rows])


def attach_reference_to_project(project_id: str, reference_id: str) -> Dict[str, Any]:
    now = utcnow_iso()
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO media_project_references (project_id, reference_id, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(project_id, reference_id) DO NOTHING
            """,
            (project_id, reference_id, now),
        )
    record = get_reference_media(reference_id)
    if not record:
        raise KeyError("reference media not found")
    return record


def detach_reference_from_project(project_id: str, reference_id: str) -> Dict[str, Any]:
    with get_connection() as connection:
        connection.execute(
            "DELETE FROM media_project_references WHERE project_id = ? AND reference_id = ?",
            (project_id, reference_id),
        )
    record = get_reference_media(reference_id)
    if not record:
        raise KeyError("reference media not found")
    return record


def _reference_project_ids(connection, reference_ids: List[str]) -> Dict[str, List[str]]:
    if not reference_ids:
        return {}
    placeholders = ",".join("?" for _ in reference_ids)
    rows = connection.execute(
        f"""
        SELECT project_id, reference_id
        FROM media_project_references
        WHERE reference_id IN ({placeholders})
        ORDER BY created_at ASC
        """,
        reference_ids,
    ).fetchall()
    attached: Dict[str, List[str]] = {}
    for row in rows:
        reference_id = str(row["reference_id"])
        attached.setdefault(reference_id, []).append(str(row["project_id"]))
    return attached


def _attach_project_ids_to_reference_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not records:
        return records
    reference_ids = [str(record.get("reference_id") or "").strip() for record in records]
    reference_ids = [reference_id for reference_id in reference_ids if reference_id]
    if not reference_ids:
        return records
    with get_connection() as connection:
        attached = _reference_project_ids(connection, reference_ids)
    hydrated: List[Dict[str, Any]] = []
    for record in records:
        reference_id = str(record.get("reference_id") or "").strip()
        hydrated.append({**record, "attached_project_ids": attached.get(reference_id, [])})
    return hydrated


def list_reference_media(
    *,
    kind: Optional[str] = None,
    status: str = "active",
    limit: int = 100,
    offset: int = 0,
    project_id: Optional[str] = None,
    q: Optional[str] = None,
) -> List[Dict[str, Any]]:
    clauses = ["1 = 1"]
    params: List[Any] = []
    if status:
        clauses.append("rm.status = ?")
        params.append(status)
    if kind:
        clauses.append("rm.kind = ?")
        params.append(kind)
    join = ""
    if project_id:
        join = "INNER JOIN media_project_references mpr ON mpr.reference_id = rm.reference_id"
        clauses.append("mpr.project_id = ?")
        params.append(project_id)
    search_pattern = _like_search_pattern(q)
    if search_pattern:
        clauses.append(
            "("
            "LOWER(COALESCE(rm.reference_id, '')) LIKE ? ESCAPE '\\' OR "
            "LOWER(COALESCE(rm.original_filename, '')) LIKE ? ESCAPE '\\' OR "
            "LOWER(COALESCE(rm.stored_path, '')) LIKE ? ESCAPE '\\' OR "
            "LOWER(COALESCE(rm.sha256, '')) LIKE ? ESCAPE '\\' OR "
            "EXISTS ("
            "SELECT 1 FROM media_project_references mpr_search "
            "INNER JOIN media_projects mp_search ON mp_search.project_id = mpr_search.project_id "
            "WHERE mpr_search.reference_id = rm.reference_id "
            "AND LOWER(COALESCE(mp_search.name, '')) LIKE ? ESCAPE '\\'"
            ")"
            ")"
        )
        params.extend([search_pattern] * 5)
    query = "SELECT rm.* FROM reference_media rm %s WHERE %s ORDER BY rm.last_used_at DESC, rm.created_at DESC LIMIT ? OFFSET ?" % (
        join,
        " AND ".join(clauses),
    )
    params.extend([limit, offset])
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return _attach_project_ids_to_reference_records([_decode_row(row) for row in rows])


def get_reference_media(reference_id: str) -> Optional[Dict[str, Any]]:
    record = _get_table("reference_media", "reference_id", reference_id)
    if not record:
        return None
    return _attach_project_ids_to_reference_records([record])[0]


def get_reference_media_by_hash(kind: str, sha256: str, file_size_bytes: int) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM reference_media
            WHERE kind = ? AND sha256 = ? AND file_size_bytes = ?
            LIMIT 1
            """,
            (kind, sha256, file_size_bytes),
        ).fetchone()
    return _decode_row(row) if row else None


def get_reference_media_by_stored_path(stored_path: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM reference_media WHERE stored_path = ? LIMIT 1",
            (stored_path,),
        ).fetchone()
    return _decode_row(row) if row else None


def create_or_update_reference_media(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload.copy()
    payload.setdefault("reference_id", new_id("ref"))
    payload.setdefault("created_at", utcnow_iso())
    payload.setdefault("updated_at", utcnow_iso())
    payload.setdefault("status", "active")
    payload.setdefault("usage_count", 0)
    payload.setdefault("metadata_json", {})
    return _upsert_table("reference_media", "reference_id", payload)


def create_or_reuse_reference_media(payload: Dict[str, Any], *, increment_usage: bool = True) -> Dict[str, Any]:
    kind = str(payload.get("kind") or "").strip()
    sha256 = str(payload.get("sha256") or "").strip()
    file_size_bytes = int(payload.get("file_size_bytes") or 0)
    if kind and sha256 and file_size_bytes > 0:
        existing = get_reference_media_by_hash(kind, sha256, file_size_bytes)
        if existing:
            updates: Dict[str, Any] = {"updated_at": utcnow_iso()}
            if increment_usage:
                updates["usage_count"] = int(existing.get("usage_count") or 0) + 1
                updates["last_used_at"] = utcnow_iso()
            return create_or_update_reference_media({**existing, **updates})
    next_payload = payload.copy()
    if increment_usage:
        next_payload["usage_count"] = max(1, int(next_payload.get("usage_count") or 0))
        next_payload["last_used_at"] = next_payload.get("last_used_at") or utcnow_iso()
    return create_or_update_reference_media(next_payload)


def mark_reference_media_used(reference_id: str, increment: int = 1) -> Dict[str, Any]:
    current = get_reference_media(reference_id)
    if not current:
        raise KeyError("reference media not found")
    current["usage_count"] = max(0, int(current.get("usage_count") or 0) + increment)
    current["last_used_at"] = utcnow_iso()
    return create_or_update_reference_media(current)


def hide_reference_media(reference_id: str) -> Dict[str, Any]:
    current = get_reference_media(reference_id)
    if not current:
        raise KeyError("reference media not found")
    current["status"] = "hidden"
    current["updated_at"] = utcnow_iso()
    return create_or_update_reference_media(current)
