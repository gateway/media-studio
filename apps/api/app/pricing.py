from __future__ import annotations

from typing import Any, Dict, List, Optional


AUTHORITATIVE_PRICING_STATUSES = {
    "verified_provider",
    "provider_api",
    "verified_live_billing",
}

AUTHORITATIVE_SOURCE_KINDS = {
    "provider_api",
    "verified_provider",
    "live_billing",
}


def pricing_is_authoritative(source_kind: Optional[str], pricing_status: Optional[str]) -> bool:
    return bool(
        pricing_status in AUTHORITATIVE_PRICING_STATUSES
        or source_kind in AUTHORITATIVE_SOURCE_KINDS
    )


def normalize_pricing_snapshot(
    payload: Optional[Dict[str, Any]],
    *,
    cache_status: str = "snapshot",
    refresh_error: Optional[str] = None,
) -> Dict[str, Any]:
    resolved = dict(payload or {})
    rules = resolved.get("rules") or resolved.get("entries") or []
    normalized_rules = [dict(rule) for rule in rules if isinstance(rule, dict)]
    notes = [str(note) for note in resolved.get("notes") or []]
    if refresh_error:
        notes.append(f"Pricing refresh failed: {refresh_error}")
    source_kind = str(resolved.get("source_kind") or resolved.get("source") or "unavailable")
    pricing_statuses = {
        str(rule.get("pricing_status") or "unknown")
        for rule in normalized_rules
    }
    aggregate_status = (
        next(iter(pricing_statuses))
        if len(pricing_statuses) == 1
        else ("mixed" if pricing_statuses else "unknown")
    )
    is_authoritative = source_kind in AUTHORITATIVE_SOURCE_KINDS or any(
        pricing_is_authoritative(source_kind, str(rule.get("pricing_status") or "unknown"))
        for rule in normalized_rules
    )
    return {
        "version": resolved.get("version"),
        "label": resolved.get("label"),
        "released_on": resolved.get("released_on"),
        "refreshed_at": resolved.get("released_on") or resolved.get("refreshed_at"),
        "currency": resolved.get("currency") or "USD",
        "source": source_kind,
        "source_kind": source_kind,
        "source_url": resolved.get("source_url"),
        "notes": notes,
        "rules": normalized_rules,
        "cache_status": cache_status,
        "refresh_error": refresh_error,
        "is_authoritative": is_authoritative,
        "pricing_status": aggregate_status,
    }


def summarize_estimated_cost(
    estimated_cost: Optional[Dict[str, Any]],
    *,
    output_count: int = 1,
) -> Dict[str, Any]:
    resolved = dict(estimated_cost or {})
    resolved_output_count = max(1, int(output_count or 1))
    per_output_credits = _number_or_none(resolved.get("estimated_credits"))
    per_output_cost_usd = _number_or_none(resolved.get("estimated_cost_usd"))
    total_credits = (
        per_output_credits * resolved_output_count
        if per_output_credits is not None
        else None
    )
    total_cost_usd = (
        per_output_cost_usd * resolved_output_count
        if per_output_cost_usd is not None
        else None
    )
    pricing_source_kind = _string_or_none(resolved.get("pricing_source_kind"))
    pricing_status = _string_or_none(resolved.get("pricing_status"))
    return {
        "model_key": resolved.get("model_key"),
        "output_count": resolved_output_count,
        "currency": resolved.get("currency") or "USD",
        "billing_unit": resolved.get("billing_unit"),
        "pricing_version": resolved.get("pricing_version"),
        "pricing_source_kind": pricing_source_kind,
        "pricing_status": pricing_status,
        "is_known": bool(resolved.get("is_known")),
        "has_numeric_estimate": bool(
            resolved.get("has_numeric_estimate")
            or total_credits is not None
            or total_cost_usd is not None
        ),
        "is_authoritative": bool(resolved.get("is_authoritative"))
        or pricing_is_authoritative(pricing_source_kind, pricing_status),
        "per_output": {
            "estimated_credits": per_output_credits,
            "estimated_cost_usd": per_output_cost_usd,
        },
        "total": {
            "estimated_credits": total_credits,
            "estimated_cost_usd": total_cost_usd,
        },
        "applied_multipliers": _dict_copy(resolved.get("applied_multipliers")),
        "applied_adders_credits": _dict_copy(resolved.get("applied_adders_credits")),
        "applied_adders_cost_usd": _dict_copy(resolved.get("applied_adders_cost_usd")),
        "assumptions": [str(item) for item in resolved.get("assumptions") or []],
        "notes": [str(item) for item in resolved.get("notes") or []],
    }


def attach_pricing_summary(
    preflight: Optional[Dict[str, Any]],
    *,
    output_count: int = 1,
) -> Dict[str, Any]:
    resolved = dict(preflight or {})
    resolved["pricing_summary"] = summarize_estimated_cost(
        resolved.get("estimated_cost") if isinstance(resolved.get("estimated_cost"), dict) else None,
        output_count=output_count,
    )
    return resolved


def _dict_copy(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _number_or_none(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _string_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
