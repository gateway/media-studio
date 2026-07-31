from __future__ import annotations

from typing import Any, Dict, Optional

from . import kie_adapter
from .service_errors import ServiceError


def model_prompt_max_chars(model_key: str) -> Optional[int]:
    try:
        model = kie_adapter.get_model(model_key)
    except Exception:
        return None
    raw = model.get("raw") if isinstance(model, dict) else {}
    prompt = raw.get("prompt") if isinstance(raw, dict) else {}
    value = prompt.get("max_chars") if isinstance(prompt, dict) else None
    try:
        max_chars = int(value)
    except (TypeError, ValueError):
        return None
    return max_chars if max_chars > 0 else None


def prompt_budget_summary(model_key: str, prompt: str) -> Dict[str, Any]:
    max_chars = model_prompt_max_chars(model_key)
    current_chars = len(prompt or "")
    return {
        "model_key": model_key,
        "current_chars": current_chars,
        "max_chars": max_chars,
        "over_limit": bool(max_chars is not None and current_chars > max_chars),
    }


def enforce_prompt_budget(model_key: str, prompt: str) -> Dict[str, Any]:
    summary = prompt_budget_summary(model_key, prompt)
    max_chars = summary["max_chars"]
    current_chars = summary["current_chars"]
    if max_chars is not None and current_chars > max_chars:
        raise ServiceError(
            "Prompt is too long for %s: %s characters used, %s allowed."
            % (model_key, current_chars, max_chars)
        )
    return summary

