from __future__ import annotations

from typing import Any, Dict, Optional

from . import store

PERSISTED_PROVIDER_KINDS = {"openrouter", "codex_local"}


def _number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _integer(value: Any) -> Optional[int]:
    number = _number(value)
    if number is None:
        return None
    return int(number)


def summarize_usage_payload(usage: Dict[str, Any] | None) -> Dict[str, Any]:
    usage = usage if isinstance(usage, dict) else {}
    prompt_details = usage.get("prompt_tokens_details") if isinstance(usage.get("prompt_tokens_details"), dict) else {}
    completion_details = (
        usage.get("completion_tokens_details")
        if isinstance(usage.get("completion_tokens_details"), dict)
        else {}
    )
    return {
        "prompt_tokens": _integer(usage.get("prompt_tokens")),
        "completion_tokens": _integer(usage.get("completion_tokens")),
        "total_tokens": _integer(usage.get("total_tokens")),
        "reasoning_tokens": _integer(completion_details.get("reasoning_tokens")),
        "cached_tokens": _integer(prompt_details.get("cached_tokens")),
        "cache_write_tokens": _integer(prompt_details.get("cache_write_tokens")),
        "cost_usd": _number(usage.get("cost")),
    }


def record_external_llm_usage(
    *,
    provider_kind: str,
    provider_model_id: str,
    provider_response_id: Optional[str],
    usage: Dict[str, Any] | None,
    source_kind: str,
    workflow_id: Optional[str] = None,
    run_id: Optional[str] = None,
    node_id: Optional[str] = None,
    recipe_id: Optional[str] = None,
    model_key: Optional[str] = None,
    task_mode: Optional[str] = None,
    metadata_json: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    normalized_provider_kind = str(provider_kind or "").strip()
    if normalized_provider_kind not in PERSISTED_PROVIDER_KINDS:
        return None
    normalized_usage = usage if isinstance(usage, dict) else {}
    if not normalized_usage:
        return None
    summary = summarize_usage_payload(normalized_usage)
    if not any(summary.get(key) is not None for key in ("prompt_tokens", "completion_tokens", "total_tokens", "cost_usd")):
        return None
    return store.create_external_llm_usage_event(
        {
            "provider_kind": provider_kind,
            "provider_model_id": provider_model_id,
            "provider_response_id": provider_response_id,
            "source_kind": source_kind,
            "workflow_id": workflow_id,
            "run_id": run_id,
            "node_id": node_id,
            "recipe_id": recipe_id,
            "model_key": model_key,
            "task_mode": task_mode,
            "usage_json": normalized_usage,
            "prompt_tokens": summary["prompt_tokens"],
            "completion_tokens": summary["completion_tokens"],
            "total_tokens": summary["total_tokens"],
            "reasoning_tokens": summary["reasoning_tokens"],
            "cached_tokens": summary["cached_tokens"],
            "cache_write_tokens": summary["cache_write_tokens"],
            "cost_usd": 0.0 if normalized_provider_kind == "codex_local" and summary["cost_usd"] is None else summary["cost_usd"],
            "metadata_json": metadata_json or {},
        }
    )
