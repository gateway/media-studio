from __future__ import annotations

import sys
from pathlib import Path
from functools import lru_cache
from typing import Any, Dict

from .settings import settings


def _maybe_add_kie_repo_to_path() -> None:
    if not settings.kie_api_repo_path:
        return
    for candidate in (settings.kie_api_repo_path / "src", settings.kie_api_repo_path):
        if candidate.exists():
            value = str(candidate)
            if value not in sys.path:
                sys.path.insert(0, value)


@lru_cache(maxsize=1)
def get_kie_module():
    try:
        import kie_api

        return kie_api
    except ImportError:
        _maybe_add_kie_repo_to_path()
        import kie_api

        return kie_api


@lru_cache(maxsize=1)
def get_registry():
    return get_kie_module().load_registry()


def _dump(value: Any) -> Dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return dict(value)


def list_models() -> list:
    registry = get_registry()
    items = []
    for spec in registry.iter_models():
        media_types = []
        for media_type, input_spec in spec.inputs.items():
            if (input_spec.required_max or 0) > 0 or input_spec.required_min > 0:
                media_types.append(media_type)
        items.append(
            {
                "key": spec.key,
                "label": spec.label,
                "provider_model": spec.provider_model,
                "task_modes": [mode.value for mode in spec.task_modes],
                "media_types": media_types,
                "supports_output_count": True,
                "raw": spec.model_dump(mode="json"),
            }
        )
    items.sort(key=lambda item: item["label"].lower())
    return items


def get_model(model_key: str) -> Dict[str, Any]:
    spec = get_registry().get_model(model_key)
    return {
        "key": spec.key,
        "label": spec.label,
        "provider_model": spec.provider_model,
        "task_modes": [mode.value for mode in spec.task_modes],
        "media_types": [key for key, input_spec in spec.inputs.items() if (input_spec.required_max or 0) > 0 or input_spec.required_min > 0],
        "supports_output_count": True,
        "raw": spec.model_dump(mode="json"),
    }


def pricing_snapshot() -> Dict[str, Any]:
    try:
        payload = _dump(get_kie_module().registry.loader.load_latest_pricing_snapshot())
        return {
            "refreshed_at": payload.get("released_on") or payload.get("refreshed_at"),
            "source": payload.get("source_kind", "registry_snapshot"),
            "entries": payload.get("rules") or [],
        }
    except Exception:
        return {"refreshed_at": None, "source": "unavailable", "entries": []}


def refresh_pricing_snapshot() -> Dict[str, Any]:
    return pricing_snapshot()


def get_credit_balance() -> Dict[str, Any]:
    if not settings.kie_api_key:
        return {"available_credits": None, "reason": "KIE_API_KEY not configured"}
    return _dump(get_kie_module().get_credit_balance())


def resolve_prompt_context(raw_request: Dict[str, Any]) -> Dict[str, Any]:
    return _dump(get_kie_module().resolve_prompt_context(get_kie_module().RawUserRequest(**raw_request), get_registry()))


def validate_request(raw_request: Dict[str, Any]) -> Dict[str, Any]:
    return _dump(get_kie_module().validate_request(get_kie_module().RawUserRequest(**raw_request), get_registry()))


def run_preflight(validation_or_request: Any) -> Dict[str, Any]:
    kie_api = get_kie_module()
    if isinstance(validation_or_request, dict):
        if "state" in validation_or_request:
            validation_or_request = kie_api.ValidationResult(**validation_or_request)
        else:
            validation_or_request = kie_api.RawUserRequest(**validation_or_request)
    return _dump(kie_api.run_preflight(validation_or_request, get_registry()))


def dry_run_prompt_enhancement(raw_request: Dict[str, Any]) -> Dict[str, Any]:
    return _dump(get_kie_module().dry_run_prompt_enhancement(get_kie_module().RawUserRequest(**raw_request), get_registry()))


def prepare_request_for_submission(raw_request: Dict[str, Any]) -> Dict[str, Any]:
    prepared = get_kie_module().prepare_request_for_submission(
        get_kie_module().RawUserRequest(**raw_request),
        get_registry(),
    )
    return _dump(prepared)


def submit_request(prepared_payload: Dict[str, Any]) -> Dict[str, Any]:
    if not settings.media_enable_live_submit or not settings.kie_api_key:
        raise RuntimeError("Live submit disabled or KIE_API_KEY not configured.")
    kie_api = get_kie_module()
    prepared = kie_api.PreparedRequest(**prepared_payload)
    return _dump(kie_api.submit_prepared_request(prepared, get_registry()))


def poll_task(task_id: str) -> Dict[str, Any]:
    kie_api = get_kie_module()
    client = kie_api.clients.status.StatusClient(kie_api.KieSettings())
    return _dump(client.get_status(task_id))


def download_output_file(source_url: str, destination_path: str) -> Dict[str, Any]:
    return _dump(get_kie_module().download_output_file(source_url, destination_path))


def create_run_artifact(request_payload: Dict[str, Any]) -> Dict[str, Any]:
    kie_api = get_kie_module()
    request = kie_api.RunArtifactCreateRequest(**request_payload)
    artifact = kie_api.create_run_artifact(request, output_root=settings.outputs_dir)
    return _dump(artifact)
