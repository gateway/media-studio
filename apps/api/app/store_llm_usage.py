from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .db import get_connection
from .store_support import (
    decode_row as _decode_row,
    get_table as _get_table,
    new_id,
    upsert_table as _upsert_table,
    utcnow_iso,
)


def get_prompt_recipe_drafting_config(config_key: str = "prompt_recipe_drafting") -> Optional[Dict[str, Any]]:
    return _get_table("media_prompt_recipe_drafting_configs", "config_key", config_key)


def create_or_update_prompt_recipe_drafting_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    resolved = payload.copy()
    resolved.setdefault("config_key", "prompt_recipe_drafting")
    return _upsert_table("media_prompt_recipe_drafting_configs", "config_key", resolved)


def _get_external_llm_usage_by_provider_response(provider_kind: str, provider_response_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM media_external_llm_usage
            WHERE provider_kind = ? AND provider_response_id = ?
            LIMIT 1
            """,
            (provider_kind, provider_response_id),
        ).fetchone()
    return _decode_row(row) if row else None


def create_external_llm_usage_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    resolved = payload.copy()
    provider_kind = str(resolved.get("provider_kind") or "").strip()
    provider_response_id = str(resolved.get("provider_response_id") or "").strip()
    now = utcnow_iso()
    existing = (
        _get_external_llm_usage_by_provider_response(provider_kind, provider_response_id)
        if provider_kind and provider_response_id
        else None
    )
    if existing:
        merged = existing.copy()
        merged.update({key: value for key, value in resolved.items() if value is not None})
        merged["updated_at"] = now
        return _upsert_table("media_external_llm_usage", "usage_event_id", merged)
    resolved.setdefault("usage_event_id", new_id("llmuse"))
    resolved.setdefault("usage_json", {})
    resolved.setdefault("metadata_json", {})
    resolved.setdefault("created_at", now)
    resolved["updated_at"] = now
    return _upsert_table("media_external_llm_usage", "usage_event_id", resolved)


def list_external_llm_usage(limit: int = 100, offset: int = 0, source_kind: Optional[str] = None) -> List[Dict[str, Any]]:
    clauses = ["1 = 1"]
    params: List[Any] = []
    if source_kind:
        clauses.append("source_kind = ?")
        params.append(source_kind)
    params.extend([limit, offset])
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM media_external_llm_usage
            WHERE %s
            ORDER BY created_at DESC, usage_event_id DESC
            LIMIT ? OFFSET ?
            """
            % " AND ".join(clauses),
            params,
        ).fetchall()
    return [_decode_row(row) for row in rows]


def count_external_llm_usage(source_kind: Optional[str] = None) -> int:
    clauses = ["1 = 1"]
    params: List[Any] = []
    if source_kind:
        clauses.append("source_kind = ?")
        params.append(source_kind)
    with get_connection() as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS total FROM media_external_llm_usage WHERE %s" % " AND ".join(clauses),
            params,
        ).fetchone()
    return int(row["total"] if row else 0)


def _aggregate_external_llm_usage(since: Optional[str] = None) -> Dict[str, Any]:
    clauses = ["1 = 1"]
    params: List[Any] = []
    if since:
        clauses.append("created_at >= ?")
        params.append(since)
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                COUNT(*) AS event_count,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
                COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
            FROM media_external_llm_usage
            WHERE %s
            """
            % " AND ".join(clauses),
            params,
        ).fetchone()
    return {
        "event_count": int(row["event_count"] if row else 0),
        "prompt_tokens": int(row["prompt_tokens"] if row else 0),
        "completion_tokens": int(row["completion_tokens"] if row else 0),
        "total_tokens": int(row["total_tokens"] if row else 0),
        "reasoning_tokens": int(row["reasoning_tokens"] if row else 0),
        "cached_tokens": int(row["cached_tokens"] if row else 0),
        "cache_write_tokens": int(row["cache_write_tokens"] if row else 0),
        "cost_usd": float(row["cost_usd"] if row else 0.0),
    }


def get_external_llm_usage_summary() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    start_of_today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    last_7d = now - timedelta(days=7)
    last_30d = now - timedelta(days=30)
    return {
        "provider_kind": "external_llm",
        "currency": "USD",
        "today": _aggregate_external_llm_usage(start_of_today.isoformat()),
        "last_7d": _aggregate_external_llm_usage(last_7d.isoformat()),
        "last_30d": _aggregate_external_llm_usage(last_30d.isoformat()),
        "lifetime": _aggregate_external_llm_usage(),
        "generated_at": now.isoformat(),
    }
