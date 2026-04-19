from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .db_backup import backup_database
from .db import get_connection
from .settings import settings
from .store_support import (
    bootstrap_connection_schema,
    database_has_user_schema,
    connect_path,
    decode_row as _decode_row,
    delete_table as _delete_table,
    encode_value as _encode,
    schema_status as _schema_status,
    get_table as _get_table,
    insert_or_update as _insert_or_update,
    list_table as _list_table,
    list_pending_migrations,
    next_queue_position as _next_queue_position,
    new_id,
    upsert_table as _upsert_table,
    utcnow_iso,
)


def _bootstrap_schema(connection) -> None:
    bootstrap_connection_schema(connection)


def bootstrap_schema(db_path: Optional[Path] = None, backup_dir: Optional[Path] = None) -> Optional[Path]:
    target_path = Path(db_path) if db_path is not None else settings.db_path
    existing_before_bootstrap = target_path.exists()
    connection = connect_path(target_path)
    backup_path: Optional[Path] = None
    try:
        pending_migrations = list_pending_migrations(connection)
        if (
            existing_before_bootstrap
            and pending_migrations
            and settings.media_auto_backup_before_migration
            and database_has_user_schema(connection)
        ):
            resolved_backup_dir = Path(backup_dir) if backup_dir is not None else settings.backups_dir
            backup_path = backup_database(target_path, resolved_backup_dir)
        _bootstrap_schema(connection)
        connection.commit()
    finally:
        connection.close()
    return backup_path


def get_schema_status(db_path: Optional[Path] = None) -> Dict[str, Any]:
    target_path = Path(db_path) if db_path is not None else settings.db_path
    connection = connect_path(target_path)
    try:
        return _schema_status(connection)
    finally:
        connection.close()


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


def list_presets() -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM media_presets WHERE status != 'archived' ORDER BY priority DESC, updated_at DESC, key ASC"
        ).fetchall()
    return [_decode_row(row) for row in rows]


def get_preset(preset_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_presets", "preset_id", preset_id)


def get_preset_by_key(key: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM media_presets WHERE key = ? LIMIT 1", (key,)).fetchone()
    return _decode_row(row) if row else None


def create_or_update_preset(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _upsert_table("media_presets", "preset_id", payload)


def delete_preset(preset_id: str) -> Dict[str, Any]:
    record = get_preset(preset_id)
    if record is None:
        raise FileNotFoundError("preset not found")
    record["status"] = "archived"
    return create_or_update_preset(record)


def list_projects(status: Optional[str] = "active") -> List[Dict[str, Any]]:
    clauses = ["1 = 1"]
    params: List[Any] = []
    if status and status != "all":
        clauses.append("status = ?")
        params.append(status)
    query = "SELECT * FROM media_projects WHERE %s ORDER BY updated_at DESC, name ASC" % " AND ".join(clauses)
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_decode_row(row) for row in rows]


def _visible_in_global_gallery_clause(table_name: str) -> str:
    return (
        f"({table_name}.project_id IS NULL OR {table_name}.project_id NOT IN ("
        "SELECT project_id FROM media_projects WHERE hidden_from_global_gallery = 1"
        "))"
    )


def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_projects", "project_id", project_id)


def create_or_update_project(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload.copy()
    payload.setdefault("project_id", new_id("project"))
    payload.setdefault("created_at", utcnow_iso())
    payload.setdefault("updated_at", utcnow_iso())
    payload.setdefault("status", "active")
    return _upsert_table("media_projects", "project_id", payload)


def archive_project(project_id: str) -> Dict[str, Any]:
    current = get_project(project_id)
    if not current:
        raise KeyError("project not found")
    current["status"] = "archived"
    current["updated_at"] = utcnow_iso()
    return create_or_update_project(current)


def unarchive_project(project_id: str) -> Dict[str, Any]:
    current = get_project(project_id)
    if not current:
        raise KeyError("project not found")
    current["status"] = "active"
    current["updated_at"] = utcnow_iso()
    return create_or_update_project(current)


def delete_project(project_id: str) -> None:
    with get_connection() as connection:
        connection.execute("UPDATE media_batches SET project_id = NULL WHERE project_id = ?", (project_id,))
        connection.execute("UPDATE media_jobs SET project_id = NULL WHERE project_id = ?", (project_id,))
        connection.execute("UPDATE media_assets SET project_id = NULL WHERE project_id = ?", (project_id,))
        connection.execute("DELETE FROM media_project_references WHERE project_id = ?", (project_id,))
        connection.execute("DELETE FROM media_projects WHERE project_id = ?", (project_id,))


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
            job.setdefault("project_id", batch.get("project_id"))
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


def get_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_batches", "batch_id", batch_id)


def count_batches(project_id: Optional[str] = None) -> int:
    query = "SELECT COUNT(*) AS total FROM media_batches"
    params: List[Any] = []
    if project_id:
        query += " WHERE project_id = ?"
        params.append(project_id)
    else:
        query += " WHERE " + _visible_in_global_gallery_clause("media_batches")
    with get_connection() as connection:
        row = connection.execute(query, params).fetchone()
    return int(row["total"] if row else 0)


def list_batches(limit: int = 100, offset: int = 0, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
    clauses = ["1 = 1"]
    params: List[Any] = []
    if project_id:
        clauses.append("project_id = ?")
        params.append(project_id)
    else:
        clauses.append(_visible_in_global_gallery_clause("media_batches"))
    params.extend([limit, offset])
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM media_batches WHERE %s ORDER BY created_at DESC LIMIT ? OFFSET ?" % " AND ".join(clauses),
            params,
        ).fetchall()
    return [_decode_row(row) for row in rows]


def _dashboard_visible_job_clause(job_alias: str = "media_jobs") -> str:
    return f"""
    NOT EXISTS (
        SELECT 1
        FROM media_assets dismissed_asset
        WHERE dismissed_asset.job_id = {job_alias}.job_id
          AND (dismissed_asset.dismissed = 1 OR dismissed_asset.hidden_from_dashboard = 1)
          AND NOT EXISTS (
              SELECT 1
              FROM media_assets visible_asset
              WHERE visible_asset.job_id = {job_alias}.job_id
                AND visible_asset.dismissed = 0
                AND visible_asset.hidden_from_dashboard = 0
          )
    )
    """


def list_jobs_for_batches(batch_ids: List[str], include_dismissed: bool = True) -> List[Dict[str, Any]]:
    if not batch_ids:
        return []
    placeholders = ",".join("?" for _ in batch_ids)
    clauses = [f"batch_id IN ({placeholders})"]
    params: List[Any] = list(batch_ids)
    if not include_dismissed:
        clauses.append("dismissed = 0")
        clauses.append(_dashboard_visible_job_clause())
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


def list_jobs(limit: int = 200, include_dismissed: bool = False, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
    query = "SELECT * FROM media_jobs %s ORDER BY created_at DESC LIMIT ?"
    clause = ""
    clauses: List[str] = []
    if not include_dismissed:
        clauses.extend(["dismissed = 0", _dashboard_visible_job_clause()])
    if project_id:
        clauses.append("project_id = ?")
    else:
        clauses.append(_visible_in_global_gallery_clause("media_jobs"))
    if clauses:
        clause = "WHERE " + " AND ".join(clauses)
    with get_connection() as connection:
        params: List[Any] = []
        if project_id:
            params.append(project_id)
        params.append(limit)
        rows = connection.execute(query % clause, params).fetchall()
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


def count_job_events(job_id: str, event_type: Optional[str] = None) -> int:
    with get_connection() as connection:
        if event_type:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM media_job_events WHERE job_id = ? AND event_type = ?",
                (job_id, event_type),
            ).fetchone()
        else:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM media_job_events WHERE job_id = ?",
                (job_id,),
            ).fetchone()
    return int(row["count"] if row else 0)


def list_assets(
    limit: int = 100,
    cursor: Optional[str] = None,
    favorites_only: bool = False,
    media_type: Optional[str] = None,
    model_key: Optional[str] = None,
    status: Optional[str] = None,
    preset_key: Optional[str] = None,
    project_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    clauses = ["dismissed = 0", "hidden_from_dashboard = 0"]
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
    if model_key:
        clauses.append("model_key = ?")
        params.append(model_key)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if preset_key:
        clauses.append("preset_key = ?")
        params.append(preset_key)
    if project_id:
        clauses.append("project_id = ?")
        params.append(project_id)
    else:
        clauses.append(_visible_in_global_gallery_clause("media_assets"))
    query = "SELECT * FROM media_assets WHERE %s ORDER BY created_at DESC LIMIT ?" % " AND ".join(clauses)
    params.append(limit)
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_decode_row(row) for row in rows]


def get_asset(asset_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("media_assets", "asset_id", asset_id)


def get_asset_by_job_id(job_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM media_assets WHERE job_id = ? ORDER BY created_at DESC LIMIT 1",
            (job_id,),
        ).fetchone()
    return _decode_row(row) if row else None


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
    asset = create_or_update_asset(dict(get_asset(asset_id) or {}, asset_id=asset_id, dismissed=True))
    job_id = str(asset.get("job_id") or "").strip()
    if job_id:
        try:
            update_job(job_id, {"dismissed": True})
        except KeyError:
            pass
    return asset


def mark_job_dismissed(job_id: str) -> Dict[str, Any]:
    return update_job(job_id, {"dismissed": True})


def deduplicate_assets_by_job_id() -> int:
    removed = 0
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT rowid, asset_id, job_id
            FROM media_assets
            WHERE job_id IS NOT NULL AND job_id != ''
            ORDER BY job_id ASC, created_at DESC, rowid DESC
            """
        ).fetchall()
        keep_by_job: Dict[str, int] = {}
        duplicate_rowids: List[int] = []
        for row in rows:
            job_id = str(row["job_id"])
            if job_id not in keep_by_job:
                keep_by_job[job_id] = int(row["rowid"])
                continue
            duplicate_rowids.append(int(row["rowid"]))
        for rowid in duplicate_rowids:
            connection.execute("DELETE FROM media_assets WHERE rowid = ?", (rowid,))
        removed = len(duplicate_rowids)
    return removed


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
        elif queued_count or running_count:
            status = "processing" if running_count else "queued"
        elif completed_count and failed_count:
            status = "partial_failure"
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
