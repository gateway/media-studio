from __future__ import annotations

from typing import Any


def is_seedance_model(model_key: Any) -> bool:
    normalized = str(model_key or "").strip().lower().replace("_", "-")
    return normalized == "seedance-2.5" or normalized == "seedance-2.0" or normalized.startswith("seedance-2.0-")
