from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from .. import store
from ..settings import settings
from .schemas import GraphOutputRef


def _safe_data_path(relative_path: str) -> Path:
    candidate = (settings.data_root / relative_path).resolve()
    data_root = settings.data_root.resolve()
    if candidate != data_root and data_root not in candidate.parents:
        raise ValueError("Graph media path is outside the Media Studio data root.")
    return candidate


def graph_ref_record(ref: GraphOutputRef) -> Optional[Dict[str, Any]]:
    if ref.reference_id:
        return store.get_reference_media(str(ref.reference_id))
    if ref.asset_id:
        return store.get_asset(str(ref.asset_id))
    return None


def graph_ref_path(ref: GraphOutputRef, *, expected_media_type: Optional[str] = None) -> Path:
    if ref.reference_id:
        record = store.get_reference_media(str(ref.reference_id))
        if not record:
            raise ValueError("Referenced graph media does not exist.")
        if expected_media_type and str(record.get("kind") or "") != expected_media_type:
            raise ValueError(f"Expected {expected_media_type} media.")
        stored_path = str(record.get("stored_path") or "")
        if not stored_path:
            raise ValueError("Reference media has no stored path.")
        path = _safe_data_path(stored_path)
        if not path.exists():
            raise ValueError("Reference media file is missing.")
        return path

    if ref.asset_id:
        record = store.get_asset(str(ref.asset_id))
        if not record:
            raise ValueError("Referenced graph asset does not exist.")
        if expected_media_type and str(record.get("generation_kind") or "") != expected_media_type:
            raise ValueError(f"Expected {expected_media_type} asset.")
        for key in ("hero_original_path", "hero_web_path", "hero_poster_path", "hero_thumb_path"):
            value = str(record.get(key) or "")
            if not value:
                continue
            path = _safe_data_path(value)
            if path.exists():
                return path
        raise ValueError("Asset has no readable media file.")

    raise ValueError("Graph media reference does not point to a stored asset or reference media.")


def graph_ref_metadata(ref: GraphOutputRef) -> Dict[str, Any]:
    record = graph_ref_record(ref) or {}
    if ref.reference_id:
        return {
            "reference_id": ref.reference_id,
            "kind": record.get("kind"),
            "width": record.get("width"),
            "height": record.get("height"),
            "duration_seconds": record.get("duration_seconds"),
            "mime_type": record.get("mime_type"),
            "stored_path": record.get("stored_path"),
            "metadata": record.get("metadata_json") or {},
        }
    if ref.asset_id:
        return {
            "asset_id": ref.asset_id,
            "job_id": record.get("job_id"),
            "model_key": record.get("model_key"),
            "media_type": record.get("generation_kind"),
            "hero_original_path": record.get("hero_original_path"),
            "hero_web_path": record.get("hero_web_path"),
            "duration_seconds": ((record.get("payload_json") or {}).get("outputs") or [{}])[0].get("duration_seconds")
            if isinstance(record.get("payload_json"), dict)
            else None,
        }
    return {}
