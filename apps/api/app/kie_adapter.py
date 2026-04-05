from __future__ import annotations

import importlib
import sys
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Dict, Iterable, Optional

from urllib.parse import urlparse

from .pricing import normalize_pricing_snapshot
from .settings import settings


_pricing_snapshot_cache: Optional[Dict[str, Any]] = None
_pricing_snapshot_cache_expires_at: Optional[datetime] = None


def _maybe_add_kie_repo_to_path() -> None:
    if not settings.kie_api_repo_path:
        return
    for candidate in (settings.kie_api_repo_path / "src", settings.kie_api_repo_path):
        if candidate.exists():
            value = str(candidate)
            if value not in sys.path:
                sys.path.insert(0, value)


def _configured_repo_prefixes() -> tuple[str, ...]:
    if not settings.kie_api_repo_path:
        return ()
    prefixes = []
    for candidate in (settings.kie_api_repo_path / "src", settings.kie_api_repo_path):
        if candidate.exists():
            prefixes.append(str(candidate.resolve()))
    return tuple(prefixes)


def _module_uses_configured_repo(module: Any) -> bool:
    module_file = getattr(module, "__file__", None)
    if not module_file:
        return False
    try:
        resolved = str(Path(module_file).resolve())
    except Exception:
        resolved = str(module_file)
    return any(resolved.startswith(prefix) for prefix in _configured_repo_prefixes())


def _drop_stale_kie_modules() -> None:
    for name in sorted([key for key in sys.modules if key == "kie_api" or key.startswith("kie_api.")], reverse=True):
        sys.modules.pop(name, None)
    importlib.invalidate_caches()


@lru_cache(maxsize=1)
def get_kie_module():
    _maybe_add_kie_repo_to_path()
    try:
        import kie_api
    except ImportError:
        _maybe_add_kie_repo_to_path()
        import kie_api
        return kie_api

    if settings.kie_api_repo_path and not _module_uses_configured_repo(kie_api):
        _drop_stale_kie_modules()
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


def pricing_snapshot(*, force_refresh: bool = False) -> Dict[str, Any]:
    global _pricing_snapshot_cache
    global _pricing_snapshot_cache_expires_at

    if (
        not force_refresh
        and _pricing_snapshot_cache is not None
        and _pricing_snapshot_cache_expires_at is not None
        and datetime.now(timezone.utc) < _pricing_snapshot_cache_expires_at
    ):
        return dict(_pricing_snapshot_cache)

    try:
        payload = _dump(get_kie_module().registry.loader.load_latest_pricing_snapshot())
        normalized = normalize_pricing_snapshot(payload, cache_status="resource_snapshot")
        _pricing_snapshot_cache = normalized
        _pricing_snapshot_cache_expires_at = _next_pricing_cache_expiry()
        return dict(normalized)
    except Exception:
        return normalize_pricing_snapshot(
            {"refreshed_at": None, "source_kind": "unavailable", "rules": []},
            cache_status="unavailable",
        )


def refresh_pricing_snapshot() -> Dict[str, Any]:
    global _pricing_snapshot_cache
    global _pricing_snapshot_cache_expires_at

    try:
        pricing_refresh = importlib.import_module("kie_api.services.pricing_refresh")
        capture = pricing_refresh.fetch_site_pricing_catalog()
        snapshot = pricing_refresh.build_supported_model_snapshot(capture)
        normalized = normalize_pricing_snapshot(
            _dump(snapshot),
            cache_status="refreshed_live",
        )
        _pricing_snapshot_cache = normalized
        _pricing_snapshot_cache_expires_at = _next_pricing_cache_expiry()
        return dict(normalized)
    except Exception as exc:
        fallback = pricing_snapshot(force_refresh=False)
        fallback["refresh_error"] = str(exc)
        fallback["cache_status"] = fallback.get("cache_status") or "resource_snapshot"
        notes = [str(note) for note in fallback.get("notes") or []]
        notes.append(f"Pricing refresh failed: {exc}")
        fallback["notes"] = notes
        return fallback


def get_credit_balance() -> Dict[str, Any]:
    if not settings.kie_api_key:
        return {"available_credits": None, "reason": "KIE_API_KEY not configured"}
    return _dump(get_kie_module().get_credit_balance())


def estimate_request_cost(raw_request: Dict[str, Any]) -> Dict[str, Any]:
    kie_api = get_kie_module()
    return _dump(
        kie_api.estimate_request_cost(
            kie_api.RawUserRequest(**raw_request),
            get_registry(),
        )
    )


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


def verify_callback_request(payload: Dict[str, Any], headers: Dict[str, Any]) -> Dict[str, Any]:
    _maybe_add_kie_repo_to_path()
    callbacks = importlib.import_module("kie_api.clients.callbacks")
    config = importlib.import_module("kie_api.config")
    kie_settings = config.KieSettings()
    secret = str(getattr(kie_settings, "webhook_secret", "") or "").strip()
    if not secret:
        raise RuntimeError("KIE callback verification is not configured.")
    verify_request = getattr(callbacks, "verify_callback_request", None)
    if callable(verify_request):
        event = verify_request(
            payload,
            headers,
            secret=secret,
            settings=kie_settings,
        )
        return _dump(event)

    verify_signature = getattr(callbacks, "verify_callback_signature", None)
    parse_event = getattr(callbacks, "parse_callback_event", None)
    if not callable(verify_signature) or not callable(parse_event):
        raise RuntimeError("KIE callback verification helpers are unavailable.")

    max_age_seconds = int(
        getattr(kie_settings, "callback_max_age_seconds", None)
        or getattr(settings, "kie_callback_max_age_seconds", 300)
        or 300
    )
    signature_ok = verify_signature(
        payload,
        headers,
        secret=secret,
        max_age_seconds=max_age_seconds,
    )
    if not signature_ok:
        raise RuntimeError("Callback signature validation failed.")

    event = parse_event(payload)
    event_payload = _dump(event)
    task_id = str(event_payload.get("task_id") or "").strip()
    if not task_id:
        raise RuntimeError("Callback payload does not contain a usable task id.")

    for url in _trusted_callback_output_urls(event_payload.get("output_urls")):
        if not _is_trusted_callback_output_url(kie_settings, url):
            raise RuntimeError(f"Callback output URL host is not trusted: {url!r}")
    return event_payload


def _next_pricing_cache_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(
        hours=max(1, settings.media_pricing_cache_hours)
    )


def _trusted_callback_output_urls(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        return [value]
    if not isinstance(value, (list, tuple)):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _is_trusted_callback_output_url(kie_settings: Any, value: str) -> bool:
    explicit = getattr(kie_settings, "is_trusted_callback_output_url", None)
    if callable(explicit):
        return bool(explicit(value))

    uploaded = getattr(kie_settings, "is_trusted_uploaded_url", None)
    if callable(uploaded) and uploaded(value):
        return True

    host = urlparse(value).hostname
    if not host:
        return False
    trusted_hosts = getattr(kie_settings, "callback_trusted_output_hosts", None)
    if not trusted_hosts:
        trusted_hosts = (
            "tempfile.redpandaai.co",
            "kieai.redpandaai.co",
            "tempfile.aiquickdraw.com",
        )
    return any(
        host == str(trusted_host) or host.endswith(f".{trusted_host}")
        for trusted_host in trusted_hosts
        if str(trusted_host).strip()
    )
