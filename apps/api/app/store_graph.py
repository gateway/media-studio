from __future__ import annotations

from typing import Any, Dict, List, Optional

from .db import get_connection
from .store_support import (
    decode_row as _decode_row,
    encode_value as _encode,
    get_table as _get_table,
    insert_or_update as _insert_or_update,
    new_id,
    upsert_table as _upsert_table,
    utcnow_iso,
)


def list_graph_workflows() -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM graph_workflows WHERE status != 'archived' ORDER BY updated_at DESC, name ASC"
        ).fetchall()
    return [_decode_row(row) for row in rows]


def get_graph_workflow(workflow_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("graph_workflows", "workflow_id", workflow_id)


def create_or_update_graph_workflow(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload.copy()
    if not payload.get("workflow_id"):
        payload["workflow_id"] = new_id("graphwf")
    workflow_json = payload.get("workflow_json")
    if isinstance(workflow_json, dict):
        payload["workflow_json"] = {
            **workflow_json,
            "workflow_id": payload["workflow_id"],
            "name": payload.get("name") or workflow_json.get("name") or "Untitled Graph",
            "description": payload.get("description") if payload.get("description") is not None else workflow_json.get("description"),
        }
    payload.setdefault("schema_version", 1)
    payload.setdefault("status", "active")
    record = _upsert_table("graph_workflows", "workflow_id", payload)
    version_count = count_graph_workflow_versions(record["workflow_id"])
    create_graph_workflow_version(
        {
            "workflow_id": record["workflow_id"],
            "version_number": version_count + 1,
            "workflow_json": record.get("workflow_json") or {},
        }
    )
    return record


def archive_graph_workflow(workflow_id: str) -> Dict[str, Any]:
    record = get_graph_workflow(workflow_id)
    if record is None:
        raise KeyError("workflow not found")
    record["status"] = "archived"
    return create_or_update_graph_workflow(record)


def count_graph_workflow_versions(workflow_id: str) -> int:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS count FROM graph_workflow_versions WHERE workflow_id = ?",
            (workflow_id,),
        ).fetchone()
    return int(row["count"] if row else 0)


def create_graph_workflow_version(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload.copy()
    payload.setdefault("version_id", new_id("graphver"))
    payload.setdefault("created_at", utcnow_iso())
    return _upsert_table("graph_workflow_versions", "version_id", payload)


def list_graph_templates() -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM graph_templates WHERE status != 'archived' ORDER BY updated_at DESC, name ASC"
        ).fetchall()
    return [_decode_row(row) for row in rows]


def get_graph_template(template_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("graph_templates", "template_id", template_id)


def create_or_update_graph_template(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload.copy()
    if not payload.get("template_id"):
        payload["template_id"] = new_id("graphtpl")
    payload.setdefault("status", "active")
    payload.setdefault("tags_json", [])
    return _upsert_table("graph_templates", "template_id", payload)


def archive_graph_template(template_id: str) -> Dict[str, Any]:
    record = get_graph_template(template_id)
    if record is None:
        raise KeyError("template not found")
    record["status"] = "archived"
    return create_or_update_graph_template(record)


def create_graph_run(payload: Dict[str, Any], node_payloads: List[Dict[str, Any]]) -> Dict[str, Any]:
    now = utcnow_iso()
    run = payload.copy()
    run.setdefault("run_id", new_id("grun"))
    run.setdefault("status", "queued")
    run.setdefault("schema_version", 1)
    run.setdefault("created_at", now)
    run.setdefault("metrics_json", {})
    run["updated_at"] = now
    run = _upsert_table("graph_runs", "run_id", run)
    with get_connection() as connection:
        for item in node_payloads:
            node = item.copy()
            node.setdefault("run_node_id", new_id("grnode"))
            node["run_id"] = run["run_id"]
            node.setdefault("status", "queued")
            node.setdefault("input_snapshot_json", {})
            node.setdefault("output_snapshot_json", {})
            node.setdefault("metrics_json", {})
            node["updated_at"] = now
            _insert_or_update(connection, "graph_run_nodes", "run_node_id", node)
    return get_graph_run(run["run_id"])  # type: ignore


def list_graph_runs(limit: int = 100) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM graph_runs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_decode_row(row) for row in rows]


GRAPH_RUN_SUMMARY_SELECT = """
SELECT
  graph_runs.run_id,
  graph_runs.workflow_id,
  graph_runs.status,
  graph_runs.schema_version,
  graph_runs.metrics_json,
  graph_runs.error,
  graph_runs.created_at,
  graph_runs.started_at,
  graph_runs.finished_at,
  graph_runs.updated_at,
  (SELECT COUNT(*) FROM graph_run_nodes WHERE graph_run_nodes.run_id = graph_runs.run_id) AS node_count,
  (SELECT COUNT(*) FROM graph_artifacts WHERE graph_artifacts.run_id = graph_runs.run_id) AS artifact_count
FROM graph_runs
"""


def _list_graph_run_summaries(*, limit: int, workflow_id: str | None = None) -> List[Dict[str, Any]]:
    where_clause = "WHERE workflow_id = ?" if workflow_id else ""
    params: tuple[Any, ...] = (workflow_id, limit) if workflow_id else (limit,)
    with get_connection() as connection:
        rows = connection.execute(
            f"{GRAPH_RUN_SUMMARY_SELECT} {where_clause} ORDER BY created_at DESC LIMIT ?",
            params,
        ).fetchall()
    return [_decode_row(row) for row in rows]


def list_graph_run_summaries(limit: int = 100) -> List[Dict[str, Any]]:
    return _list_graph_run_summaries(limit=limit)


def list_graph_runs_for_workflow(workflow_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM graph_runs
            WHERE workflow_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (workflow_id, limit),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def list_graph_run_summaries_for_workflow(workflow_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    return _list_graph_run_summaries(limit=limit, workflow_id=workflow_id)


def get_graph_run(run_id: str) -> Optional[Dict[str, Any]]:
    return _get_table("graph_runs", "run_id", run_id)


def update_graph_run(run_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    current = get_graph_run(run_id)
    if not current:
        raise KeyError("graph run not found")
    current.update(payload)
    current["updated_at"] = utcnow_iso()
    return _upsert_table("graph_runs", "run_id", current)


def mark_interrupted_graph_runs() -> int:
    now = utcnow_iso()
    message = "Graph run was interrupted before completion. Start a new run to retry."
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM graph_runs WHERE status IN ('queued', 'running', 'cancelling')"
        ).fetchall()
        run_ids = []
        for row in rows:
            decoded = _decode_row(row)
            metrics = decoded.get("metrics_json") if isinstance(decoded.get("metrics_json"), dict) else {}
            if metrics.get("recovered_from_interruption") is True:
                continue
            run_ids.append(str(decoded["run_id"]))
        for run_id in run_ids:
            connection.execute(
                """
                UPDATE graph_runs
                SET status = 'failed',
                    error = COALESCE(NULLIF(error, ''), ?),
                    finished_at = COALESCE(finished_at, ?),
                    updated_at = ?
                WHERE run_id = ?
                """,
                (message, now, now, run_id),
            )
            connection.execute(
                """
                UPDATE graph_run_nodes
                SET status = 'failed',
                    error = COALESCE(NULLIF(error, ''), ?),
                    finished_at = COALESCE(finished_at, ?),
                    updated_at = ?
                WHERE run_id = ?
                  AND status IN ('queued', 'running', 'cancelling')
                """,
                (message, now, now, run_id),
            )
            connection.execute(
                """
                INSERT INTO graph_run_events (event_id, run_id, event_type, payload_json, created_at)
                VALUES (?, ?, 'run.failed', ?, ?)
                """,
                (new_id("grevent"), run_id, _encode({"error": message, "interrupted": True}), now),
            )
    return len(run_ids)


def list_graph_run_nodes(run_id: str) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM graph_run_nodes WHERE run_id = ? ORDER BY rowid ASC",
            (run_id,),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def get_graph_run_node(run_id: str, node_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM graph_run_nodes WHERE run_id = ? AND node_id = ? LIMIT 1",
            (run_id, node_id),
        ).fetchone()
    return _decode_row(row) if row else None


def update_graph_run_node(run_id: str, node_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    current = get_graph_run_node(run_id, node_id)
    if not current:
        raise KeyError("graph run node not found")
    current.update(payload)
    current["updated_at"] = utcnow_iso()
    return _upsert_table("graph_run_nodes", "run_node_id", current)


def append_graph_run_event(run_id: str, event_type: str, payload: Dict[str, Any], node_id: Optional[str] = None) -> Dict[str, Any]:
    event_payload = {
        "event_id": new_id("grevent"),
        "run_id": run_id,
        "node_id": node_id,
        "event_type": event_type,
        "payload_json": payload,
        "created_at": utcnow_iso(),
    }
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO graph_run_events (event_id, run_id, node_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_payload["event_id"],
                event_payload["run_id"],
                event_payload["node_id"],
                event_payload["event_type"],
                _encode(event_payload["payload_json"]),
                event_payload["created_at"],
            ),
        )
    return event_payload


def list_graph_run_events(run_id: str, after_event_id: Optional[str] = None) -> List[Dict[str, Any]]:
    params: List[Any] = [run_id]
    clause = "run_id = ?"
    if after_event_id:
        with get_connection() as connection:
            marker = connection.execute(
                "SELECT rowid FROM graph_run_events WHERE event_id = ? AND run_id = ?",
                (after_event_id, run_id),
            ).fetchone()
        if marker:
            clause += " AND rowid > ?"
            params.append(marker["rowid"])
    with get_connection() as connection:
        rows = connection.execute(
            f"SELECT * FROM graph_run_events WHERE {clause} ORDER BY rowid ASC",
            params,
        ).fetchall()
    return [_decode_row(row) for row in rows]


def latest_graph_run_event_id(run_id: str) -> Optional[str]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT event_id
            FROM graph_run_events
            WHERE run_id = ?
            ORDER BY rowid DESC
            LIMIT 1
            """,
            (run_id,),
        ).fetchone()
    return str(row["event_id"]) if row and row["event_id"] else None


def create_graph_artifact(payload: Dict[str, Any]) -> Dict[str, Any]:
    artifact = payload.copy()
    artifact.setdefault("artifact_id", new_id("gartifact"))
    artifact.setdefault("created_at", utcnow_iso())
    artifact.setdefault("metadata_json", {})
    artifact.setdefault("transform_params_json", {})
    artifact.setdefault("value_json", {})
    return _upsert_table("graph_artifacts", "artifact_id", artifact)


def list_graph_artifacts_for_run(run_id: str) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM graph_artifacts
            WHERE run_id = ?
            ORDER BY created_at ASC, node_id ASC, output_port ASC, output_index ASC
            """,
            (run_id,),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def list_graph_artifacts_for_node_run(run_id: str, node_id: str) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM graph_artifacts
            WHERE run_id = ? AND node_id = ?
            ORDER BY output_port ASC, output_index ASC, created_at ASC
            """,
            (run_id, node_id),
        ).fetchall()
    return [_decode_row(row) for row in rows]


def latest_completed_graph_run_node_output(workflow_id: str, node_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT grn.*
            FROM graph_run_nodes grn
            INNER JOIN graph_runs gr ON gr.run_id = grn.run_id
            WHERE gr.workflow_id = ?
              AND grn.node_id = ?
              AND gr.status = 'completed'
              AND grn.status = 'completed'
              AND grn.output_snapshot_json IS NOT NULL
              AND grn.output_snapshot_json != '{}'
            ORDER BY COALESCE(gr.finished_at, gr.updated_at, gr.created_at) DESC
            LIMIT 1
            """,
            (workflow_id, node_id),
        ).fetchone()
    return _decode_row(row) if row else None


def cache_graph_node_definitions(source_fingerprint: str, definitions: List[Dict[str, Any]]) -> Dict[str, Any]:
    payload = {
        "cache_id": "default",
        "source_fingerprint": source_fingerprint,
        "definitions_json": definitions,
        "updated_at": utcnow_iso(),
    }
    return _upsert_table("graph_node_definitions_cache", "cache_id", payload)
