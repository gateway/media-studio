from __future__ import annotations

import base64
import binascii
import json
import os
import select
import shutil
import struct
import subprocess
import tempfile
import time
import zlib
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any, Dict, List, Optional, Tuple


CODEX_APP_SERVER_TIMEOUT_SECONDS = 300
CODEX_LOCAL_CATALOG_CACHE_TTL_SECONDS = 300
CODEX_LOCAL_SKILL_SESSION_TTL_SECONDS = 900
CODEX_LOCAL_SKILL_SESSION_REAP_SECONDS = 60
CODEX_LOCAL_COMPACTION_TRIGGER_RATIO = 0.70
CODEX_LOCAL_COMPACTION_HYSTERESIS_RATIO = 0.10
CODEX_LOCAL_DEFAULT_MODEL = "gpt-5.6-sol"
CODEX_LOCAL_PROVIDER_BASE_URL = "codex://app-server"
CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE = "codex_local_login"
CODEX_LOCAL_JSON_OBJECT_INSTRUCTION = (
    "Return exactly one valid JSON object and nothing else. "
    "Do not wrap the response in markdown fences. "
    "Do not include commentary before or after the JSON object."
)
_APP_SERVER_CLIENT_INFO = {
    "name": "media-studio",
    "version": "1.0.0",
}
_APP_SERVER_OPT_OUT_NOTIFICATIONS = [
    "deprecationNotice",
    "mcpServer/startupStatus/updated",
    "remoteControl/status/changed",
]
_CODEX_LOCAL_CATALOG_CACHE: Dict[str, Any] = {
    "account": None,
    "catalog": None,
    "fetched_at": 0.0,
}
_CODEX_LOCAL_SKILL_SESSIONS: Dict[str, "_ManagedCodexLocalSession"] = {}
_CODEX_LOCAL_SKILL_SESSIONS_LOCK = Lock()
_CODEX_LOCAL_MODEL_REASONING: Dict[str, Tuple[Tuple[str, ...], Optional[str]]] = {}
_CODEX_LOCAL_MODEL_REASONING_LOCK = Lock()
_CODEX_LOCAL_SKILL_SESSION_REAPER_LOCK = Lock()
_CODEX_LOCAL_HOME_LOCK = Lock()
_CODEX_LOCAL_SKILL_SESSION_REAPER_STOP = Event()
_CODEX_LOCAL_SKILL_SESSION_REAPER: Thread | None = None


class CodexLocalProviderError(Exception):
    pass


class CodexLocalProviderCancelled(CodexLocalProviderError):
    pass


def codex_command_path() -> Optional[str]:
    return shutil.which("codex")


def codex_local_status() -> Dict[str, Any]:
    command_path = codex_command_path()
    auth_path = _source_codex_home() / "auth.json"
    command_available = bool(command_path)
    login_configured = auth_path.exists()
    return {
        "command_path": command_path,
        "command_available": command_available,
        "login_configured": login_configured,
        "ready": command_available and login_configured,
    }


def _mime_extension(mime_type: str) -> str:
    normalized = str(mime_type or "").strip().lower()
    if normalized == "image/jpeg":
        return ".jpg"
    if normalized == "image/webp":
        return ".webp"
    if normalized == "image/gif":
        return ".gif"
    return ".png"


def _data_url_to_path(data_url: str, temp_root: Path, index: int) -> Path:
    if not data_url.startswith("data:") or ";base64," not in data_url:
        raise CodexLocalProviderError("Codex Local image content must be a data URL.")
    header, encoded = data_url.split(",", 1)
    mime_type = header[5:].split(";", 1)[0].strip() or "image/png"
    try:
        payload = base64.b64decode(encoded)
    except Exception as exc:  # pragma: no cover - base64 internals
        raise CodexLocalProviderError("Codex Local image content could not be decoded.") from exc
    path = temp_root / f"image-{index}{_mime_extension(mime_type)}"
    path.write_bytes(payload)
    return path


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + chunk_type
        + payload
        + struct.pack(">I", binascii.crc32(chunk_type + payload) & 0xFFFFFFFF)
    )


def _probe_png_bytes() -> bytes:
    width = 4
    height = 4
    rgba_pixel = bytes([255, 255, 255, 255])
    raw_rows = b"".join(b"\x00" + (rgba_pixel * width) for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(raw_rows))
        + _png_chunk(b"IEND", b"")
    )


def _create_probe_image(temp_root: Path) -> Path:
    path = temp_root / "probe.png"
    path.write_bytes(_probe_png_bytes())
    return path


def _normalize_strict_json_schema(value: Any) -> Any:
    if isinstance(value, list):
        return [_normalize_strict_json_schema(item) for item in value]
    if not isinstance(value, dict):
        return value

    normalized = {key: _normalize_strict_json_schema(item) for key, item in value.items()}

    properties = normalized.get("properties")
    if isinstance(properties, dict):
        normalized["properties"] = {str(key): _normalize_strict_json_schema(item) for key, item in properties.items()}
    for defs_key in ("$defs", "definitions"):
        defs = normalized.get(defs_key)
        if isinstance(defs, dict):
            normalized[defs_key] = {str(key): _normalize_strict_json_schema(item) for key, item in defs.items()}
    items = normalized.get("items")
    if isinstance(items, (dict, list)):
        normalized["items"] = _normalize_strict_json_schema(items)
    for composite_key in ("anyOf", "oneOf", "allOf"):
        composite = normalized.get(composite_key)
        if isinstance(composite, list):
            normalized[composite_key] = [_normalize_strict_json_schema(item) for item in composite]

    schema_type = normalized.get("type")
    is_object_schema = schema_type == "object" or isinstance(normalized.get("properties"), dict)
    if is_object_schema:
        normalized["type"] = "object"
        normalized["additionalProperties"] = False
        properties = normalized.get("properties")
        if isinstance(properties, dict):
            normalized["required"] = list(properties.keys())
        else:
            normalized.setdefault("properties", {})
            normalized.setdefault("required", [])
    return normalized


def _response_format_to_output_schema(response_format: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not response_format:
        return None
    response_type = str(response_format.get("type") or "").strip()
    if response_type == "json_object":
        return None
    if response_type == "json_schema":
        schema_payload = response_format.get("json_schema")
        if isinstance(schema_payload, dict):
            schema = schema_payload.get("schema")
            if isinstance(schema, dict):
                return _normalize_strict_json_schema(schema)
    raise CodexLocalProviderError(f"Codex Local does not support response_format `{response_type or 'unknown'}`.")


def _response_format_requires_json_object_instruction(response_format: Optional[Dict[str, Any]]) -> bool:
    if not response_format:
        return False
    return str(response_format.get("type") or "").strip() == "json_object"


def _messages_for_response_format(
    messages: List[Dict[str, Any]],
    response_format: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    cloned_messages = [dict(message) for message in messages]
    if not _response_format_requires_json_object_instruction(response_format):
        return cloned_messages
    return [
        {"role": "system", "content": CODEX_LOCAL_JSON_OBJECT_INSTRUCTION},
        *cloned_messages,
    ]


def _codex_app_server_env() -> Dict[str, str]:
    allowed_exact = {
        "HOME",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TERM",
        "COLORTERM",
        "NO_COLOR",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "CODEX_HOME",
    }
    allowed_prefixes = (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "XDG_",
    )
    env: Dict[str, str] = {}
    for key, value in os.environ.items():
        if key in allowed_exact or key.startswith(allowed_prefixes):
            env[key] = value
    env.setdefault("HOME", str(Path.home()))
    env.setdefault("PATH", os.defpath)
    env.setdefault("LANG", "C.UTF-8")
    env.setdefault("LC_ALL", env.get("LANG", "C.UTF-8"))
    env.setdefault("LC_CTYPE", env.get("LANG", "C.UTF-8"))
    return env


def _source_codex_home() -> Path:
    configured = str(os.environ.get("CODEX_HOME") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codex"


def _codex_runtime_root() -> Path:
    data_root = Path(os.environ.get("MEDIA_STUDIO_DATA_ROOT") or "/tmp/media-studio-data").expanduser()
    runtime_root = data_root / "runtime" / "codex-local"
    runtime_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    runtime_root.chmod(0o700)
    return runtime_root


def _codex_working_directory() -> Path:
    working_directory = _codex_runtime_root() / "work"
    working_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    working_directory.chmod(0o700)
    return working_directory


def _refresh_codex_credential(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    if destination.exists() and source.stat().st_mtime_ns <= destination.stat().st_mtime_ns:
        destination.chmod(0o600)
        return
    shutil.copy2(source, destination)
    destination.chmod(0o600)


def _prepare_isolated_codex_home() -> Path:
    with _CODEX_LOCAL_HOME_LOCK:
        source_home = _source_codex_home()
        source_auth = source_home / "auth.json"
        if not source_auth.exists():
            raise CodexLocalProviderError("Codex Local is not logged in. Run `codex login` first.")
        isolated_home = _codex_runtime_root() / "home"
        isolated_home.mkdir(parents=True, exist_ok=True, mode=0o700)
        isolated_home.chmod(0o700)
        _refresh_codex_credential(source_auth, isolated_home / "auth.json")
        _refresh_codex_credential(source_home / "installation_id", isolated_home / "installation_id")
        return isolated_home


def _message_to_turn_input(messages: List[Dict[str, Any]], temp_root: Path) -> List[Dict[str, Any]]:
    prompt_parts: List[str] = []
    inputs: List[Dict[str, Any]] = []
    image_index = 0

    for message in messages:
        role = str(message.get("role") or "user").strip().upper()
        content = message.get("content")
        text_chunks: List[str] = []
        if isinstance(content, str):
            text = content.strip()
            if text:
                text_chunks.append(text)
        elif isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                item_type = str(item.get("type") or "").strip()
                if item_type == "text":
                    text = str(item.get("text") or "").strip()
                    if text:
                        text_chunks.append(text)
                    continue
                if item_type != "image_url":
                    continue
                image_url = item.get("image_url")
                if isinstance(image_url, dict):
                    image_url = image_url.get("url")
                image_value = str(image_url or "").strip()
                if not image_value:
                    continue
                image_index += 1
                if image_value.startswith("data:"):
                    inputs.append({"type": "localImage", "path": str(_data_url_to_path(image_value, temp_root, image_index))})
                else:
                    image_path = Path(image_value).expanduser()
                    if image_path.exists():
                        inputs.append({"type": "localImage", "path": str(image_path.resolve())})
                    else:
                        inputs.append({"type": "image", "url": image_value})
        if text_chunks:
            prompt_parts.append(f"{role}:\n" + "\n\n".join(chunk for chunk in text_chunks if chunk))

    prompt_text = "\n\n".join(part for part in prompt_parts if part).strip()
    if not prompt_text:
        raise CodexLocalProviderError("Codex Local prompt is empty.")
    return [{"type": "text", "text": prompt_text}, *inputs]


def _normalize_model(model: Dict[str, Any]) -> Dict[str, Any]:
    input_modalities = [str(value).strip() for value in list(model.get("inputModalities") or []) if str(value).strip()]
    supports_images = "image" in {value.lower() for value in input_modalities}
    normalized = {
        "id": str(model.get("id") or model.get("model") or "").strip(),
        "label": str(model.get("displayName") or model.get("id") or model.get("model") or "").strip(),
        "provider": "codex_local",
        "supports_images": supports_images,
        "input_modalities": input_modalities or ["text"],
        "raw": {
            "provider_kind": "codex_local",
            "supports_text": True,
            "supports_image_input": supports_images,
            "supports_structured_output": True,
            "supports_image_generation": False,
            "supports_usage_reporting": True,
            "supports_cost_visibility": False,
            "billing_kind": "subscription",
            "reasoning_efforts": list(model.get("supportedReasoningEfforts") or []),
            "default_reasoning_effort": model.get("defaultReasoningEffort"),
            "service_tiers": list(model.get("serviceTiers") or []),
        },
    }
    return normalized


def _clamp_reasoning_effort(
    session: "_CodexAppServerSession",
    model_id: str,
    requested_effort: Optional[str],
) -> Optional[str]:
    requested = str(requested_effort or "").strip()
    if not requested:
        return None
    with _CODEX_LOCAL_MODEL_REASONING_LOCK:
        cached = _CODEX_LOCAL_MODEL_REASONING.get(model_id)
    if cached is None:
        selected = next(
            (
                model
                for model in session.list_models()
                if str(model.get("id") or model.get("model") or "").strip() == model_id
            ),
            {},
        )
        supported_values: List[str] = []
        for value in selected.get("supportedReasoningEfforts") or []:
            raw_value = value.get("reasoningEffort") if isinstance(value, dict) else value
            normalized_value = str(raw_value or "").strip()
            if normalized_value:
                supported_values.append(normalized_value)
        supported = tuple(supported_values)
        default = str(selected.get("defaultReasoningEffort") or "").strip() or None
        cached = (supported, default)
        with _CODEX_LOCAL_MODEL_REASONING_LOCK:
            _CODEX_LOCAL_MODEL_REASONING[model_id] = cached
    supported, default = cached
    if requested in supported:
        return requested
    return default if default in supported else None


def _thread_setup_kwargs(
    *,
    cwd: str,
    model: str,
    base_instructions: Optional[str],
    developer_instructions: Optional[str],
) -> Dict[str, Any]:
    kwargs: Dict[str, Any] = {"cwd": cwd, "model": model}
    if base_instructions is not None:
        kwargs["base_instructions"] = base_instructions
    if developer_instructions is not None:
        kwargs["developer_instructions"] = developer_instructions
    return kwargs


def _normalize_model_catalog(models: List[Dict[str, Any]], selected_model_id: Optional[str] = None) -> List[Dict[str, Any]]:
    catalog = [_normalize_model(model) for model in models if not bool(model.get("hidden"))]
    selected = str(selected_model_id or "").strip()
    if selected and not any(str(item.get("id") or "").strip() == selected for item in catalog):
        catalog.insert(
            0,
            {
                "id": selected,
                "label": selected,
                "provider": "codex_local",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {
                    "provider_kind": "codex_local",
                    "supports_text": True,
                    "supports_image_input": True,
                    "supports_structured_output": True,
                    "supports_image_generation": False,
                    "supports_usage_reporting": True,
                    "supports_cost_visibility": False,
                    "billing_kind": "subscription",
                },
            },
        )
    return catalog


def _select_catalog_model(catalog: List[Dict[str, Any]], selected_model_id: Optional[str]) -> Dict[str, Any]:
    selected = str(selected_model_id or "").strip()
    if selected:
        for item in catalog:
            if str(item.get("id") or "").strip() == selected:
                return item
    for item in catalog:
        if str(item.get("id") or "").strip() == CODEX_LOCAL_DEFAULT_MODEL:
            return item
    if catalog:
        return catalog[0]
    return {
        "id": CODEX_LOCAL_DEFAULT_MODEL,
        "label": CODEX_LOCAL_DEFAULT_MODEL,
        "provider": "codex_local",
        "supports_images": True,
        "input_modalities": ["text", "image"],
        "raw": {
            "provider_kind": "codex_local",
            "supports_text": True,
            "supports_image_input": True,
            "supports_structured_output": True,
            "supports_image_generation": False,
            "supports_usage_reporting": True,
            "supports_cost_visibility": False,
            "billing_kind": "subscription",
        },
    }


def _clean_codex_error_message(raw_message: Any) -> str:
    text = str(raw_message or "").strip()
    if not text:
        return "Codex Local execution failed."
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(parsed, dict):
        error = parsed.get("error")
        if isinstance(error, dict):
            inner_message = str(error.get("message") or "").strip()
            if inner_message:
                return inner_message
        inner_message = str(parsed.get("message") or "").strip()
        if inner_message:
            return inner_message
    return text


def _cached_catalog_fresh() -> bool:
    fetched_at = float(_CODEX_LOCAL_CATALOG_CACHE.get("fetched_at") or 0.0)
    return fetched_at > 0 and (time.time() - fetched_at) < CODEX_LOCAL_CATALOG_CACHE_TTL_SECONDS


def _load_account_and_catalog(*, selected_model_id: Optional[str], force_refresh: bool = False) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    if not force_refresh and _cached_catalog_fresh():
        cached_account = _CODEX_LOCAL_CATALOG_CACHE.get("account")
        cached_catalog = _CODEX_LOCAL_CATALOG_CACHE.get("catalog")
        if isinstance(cached_account, dict) and isinstance(cached_catalog, list):
            return dict(cached_account), [dict(item) for item in cached_catalog]

    temp_root = Path(tempfile.mkdtemp(prefix="media-studio-codex-local-catalog-"))
    try:
        with _CodexAppServerSession(temp_root=temp_root, timeout_seconds=CODEX_APP_SERVER_TIMEOUT_SECONDS) as session:
            account_response = session.read_account()
            account = account_response.get("account") if isinstance(account_response.get("account"), dict) else None
            if not account or str(account.get("type") or "").strip() != "chatgpt":
                raise CodexLocalProviderError("Codex Local requires a ChatGPT-backed Codex login. Run `codex login` and choose ChatGPT.")
            models = session.list_models()
            catalog = _normalize_model_catalog(models, selected_model_id)
            _CODEX_LOCAL_CATALOG_CACHE["account"] = dict(account)
            _CODEX_LOCAL_CATALOG_CACHE["catalog"] = [dict(item) for item in catalog]
            _CODEX_LOCAL_CATALOG_CACHE["fetched_at"] = time.time()
            return dict(account), [dict(item) for item in catalog]
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def _normalize_usage_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    input_tokens = snapshot.get("inputTokens")
    output_tokens = snapshot.get("outputTokens")
    cached_input_tokens = snapshot.get("cachedInputTokens")
    reasoning_output_tokens = snapshot.get("reasoningOutputTokens")
    total_tokens = snapshot.get("totalTokens")
    return {
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": total_tokens,
        "prompt_tokens_details": {
            "cached_tokens": cached_input_tokens,
        },
        "completion_tokens_details": {
            "reasoning_tokens": reasoning_output_tokens,
        },
    }


def _compaction_threshold(context_window: int) -> int:
    measured_threshold = int(context_window * CODEX_LOCAL_COMPACTION_TRIGGER_RATIO)
    override = str(
        os.environ.get("MEDIA_STUDIO_CODEX_COMPACTION_THRESHOLD_TOKENS") or ""
    ).strip()
    if override.isdigit() and int(override) > 0:
        return min(int(override), measured_threshold)
    return measured_threshold


class _ManagedCodexLocalSession:
    def __init__(self, *, key: str, temp_root: Path, session: "_CodexAppServerSession", thread_id: str, model_id: str) -> None:
        self.key = key
        self.temp_root = temp_root
        self.session = session
        self.thread_id = thread_id
        self.model_id = model_id
        self.created_at = time.monotonic()
        self.last_used_at = self.created_at
        self.context_input_tokens = 0
        self.model_context_window = 0
        self.next_compaction_input_tokens = 0
        self.lock = Lock()

    def record_usage(self, usage: Dict[str, Any]) -> None:
        context_input_tokens = int(usage.get("prompt_tokens") or 0)
        context_window = int(usage.get("model_context_window") or 0)
        if context_window <= 0:
            return
        self.context_input_tokens = context_input_tokens
        self.model_context_window = context_window
        base_threshold = _compaction_threshold(context_window)
        if not self.next_compaction_input_tokens or context_input_tokens < base_threshold:
            self.next_compaction_input_tokens = base_threshold

    def compaction_due(self) -> bool:
        return bool(
            self.model_context_window
            and self.next_compaction_input_tokens
            and self.context_input_tokens >= self.next_compaction_input_tokens
        )

    def defer_next_compaction(self) -> int:
        hysteresis = int(
            self.model_context_window * CODEX_LOCAL_COMPACTION_HYSTERESIS_RATIO
        )
        self.next_compaction_input_tokens = min(
            self.model_context_window,
            self.context_input_tokens + max(hysteresis, 1),
        )
        return self.next_compaction_input_tokens

    def close(self) -> None:
        try:
            self.session.__exit__(None, None, None)
        finally:
            shutil.rmtree(self.temp_root, ignore_errors=True)


def _close_expired_codex_local_skill_sessions(now: float | None = None) -> None:
    current = time.monotonic() if now is None else now
    with _CODEX_LOCAL_SKILL_SESSIONS_LOCK:
        expired_keys = [
            key
            for key, managed in list(_CODEX_LOCAL_SKILL_SESSIONS.items())
            if current - managed.last_used_at > CODEX_LOCAL_SKILL_SESSION_TTL_SECONDS
        ]
        expired = [_CODEX_LOCAL_SKILL_SESSIONS.pop(key) for key in expired_keys if key in _CODEX_LOCAL_SKILL_SESSIONS]
    for managed in expired:
        managed.close()


def start_codex_local_skill_session_reaper() -> None:
    global _CODEX_LOCAL_SKILL_SESSION_REAPER, _CODEX_LOCAL_SKILL_SESSION_REAPER_STOP
    with _CODEX_LOCAL_SKILL_SESSION_REAPER_LOCK:
        if _CODEX_LOCAL_SKILL_SESSION_REAPER and _CODEX_LOCAL_SKILL_SESSION_REAPER.is_alive():
            return
        stop_event = Event()
        _CODEX_LOCAL_SKILL_SESSION_REAPER_STOP = stop_event

        def reap_until_stopped() -> None:
            while not stop_event.wait(CODEX_LOCAL_SKILL_SESSION_REAP_SECONDS):
                _close_expired_codex_local_skill_sessions()

        _CODEX_LOCAL_SKILL_SESSION_REAPER = Thread(
            target=reap_until_stopped,
            name="codex-local-session-reaper",
            daemon=True,
        )
        _CODEX_LOCAL_SKILL_SESSION_REAPER.start()


def stop_codex_local_skill_session_reaper() -> None:
    global _CODEX_LOCAL_SKILL_SESSION_REAPER
    with _CODEX_LOCAL_SKILL_SESSION_REAPER_LOCK:
        thread = _CODEX_LOCAL_SKILL_SESSION_REAPER
        _CODEX_LOCAL_SKILL_SESSION_REAPER = None
        _CODEX_LOCAL_SKILL_SESSION_REAPER_STOP.set()
    if thread:
        thread.join(timeout=2)


def codex_local_skill_session_reaper_running() -> bool:
    with _CODEX_LOCAL_SKILL_SESSION_REAPER_LOCK:
        return bool(
            _CODEX_LOCAL_SKILL_SESSION_REAPER
            and _CODEX_LOCAL_SKILL_SESSION_REAPER.is_alive()
        )


def close_codex_local_skill_sessions() -> None:
    with _CODEX_LOCAL_SKILL_SESSIONS_LOCK:
        sessions = list(_CODEX_LOCAL_SKILL_SESSIONS.values())
        _CODEX_LOCAL_SKILL_SESSIONS.clear()
    for managed in sessions:
        managed.close()


def close_codex_local_skill_session(session_key: str) -> None:
    normalized_key = str(session_key or "").strip()
    if not normalized_key:
        return
    with _CODEX_LOCAL_SKILL_SESSIONS_LOCK:
        managed = _CODEX_LOCAL_SKILL_SESSIONS.pop(normalized_key, None)
    if managed:
        managed.close()


def _managed_codex_local_session(
    *,
    session_key: str,
    model_id: str,
    timeout_seconds: float,
    preferred_thread_id: str | None,
    base_instructions: str | None = None,
    developer_instructions: str | None = None,
) -> tuple[_ManagedCodexLocalSession, bool, List[str]]:
    _close_expired_codex_local_skill_sessions()
    existing: _ManagedCodexLocalSession | None = None
    with _CODEX_LOCAL_SKILL_SESSIONS_LOCK:
        existing = _CODEX_LOCAL_SKILL_SESSIONS.get(session_key)
        if (
            existing
            and existing.model_id == model_id
            and (not preferred_thread_id or existing.thread_id == preferred_thread_id)
        ):
            existing.last_used_at = time.monotonic()
            return existing, True, ["thread_live_reused"]
        if existing:
            _CODEX_LOCAL_SKILL_SESSIONS.pop(session_key, None)
    if existing:
        existing.close()

    temp_root = Path(tempfile.mkdtemp(prefix="media-studio-codex-local-skill-"))
    session: _CodexAppServerSession | None = None
    try:
        session = _CodexAppServerSession(temp_root=temp_root, timeout_seconds=int(timeout_seconds or CODEX_APP_SERVER_TIMEOUT_SECONDS))
        session.__enter__()
        working_directory = str(_codex_working_directory())
        thread_lifecycle: List[str] = []
        if preferred_thread_id:
            try:
                thread_result = session.resume_thread(
                    thread_id=preferred_thread_id,
                    **_thread_setup_kwargs(
                        cwd=working_directory,
                        model=model_id,
                        base_instructions=base_instructions,
                        developer_instructions=developer_instructions,
                    ),
                )
                thread_lifecycle.append("thread_resumed")
            except CodexLocalProviderError:
                thread_result = session.start_thread(
                    **_thread_setup_kwargs(
                        cwd=working_directory,
                        model=model_id,
                        base_instructions=base_instructions,
                        developer_instructions=developer_instructions,
                    )
                )
                thread_lifecycle.extend(
                    ["thread_resume_failed", "fallback_hydrated", "thread_replaced"]
                )
        else:
            thread_result = session.start_thread(
                **_thread_setup_kwargs(
                    cwd=working_directory,
                    model=model_id,
                    base_instructions=base_instructions,
                    developer_instructions=developer_instructions,
                )
            )
            thread_lifecycle.append("thread_started")
        thread = thread_result.get("thread") if isinstance(thread_result.get("thread"), dict) else {}
        thread_id = str(thread.get("id") or "").strip()
        if not thread_id:
            raise CodexLocalProviderError("Codex Local did not return a thread id.")
        managed = _ManagedCodexLocalSession(
            key=session_key,
            temp_root=temp_root,
            session=session,
            thread_id=thread_id,
            model_id=model_id,
        )
    except Exception:
        if session is not None:
            try:
                session.__exit__(None, None, None)
            except Exception:
                pass
        shutil.rmtree(temp_root, ignore_errors=True)
        raise
    with _CODEX_LOCAL_SKILL_SESSIONS_LOCK:
        _CODEX_LOCAL_SKILL_SESSIONS[session_key] = managed
    return managed, False, thread_lifecycle


class _CodexAppServerSession:
    def __init__(self, *, temp_root: Path, timeout_seconds: int = CODEX_APP_SERVER_TIMEOUT_SECONDS) -> None:
        self.temp_root = temp_root
        self.timeout_seconds = timeout_seconds
        self.proc: subprocess.Popen[str] | None = None
        self._next_request_id = 1
        self._stderr = ""

    def __enter__(self) -> "_CodexAppServerSession":
        binary = codex_command_path()
        if not binary:
            raise CodexLocalProviderError("The `codex` command is not installed or not on PATH.")
        isolated_codex_home = _prepare_isolated_codex_home()
        env = {**_codex_app_server_env(), "CODEX_HOME": str(isolated_codex_home)}
        self.proc = subprocess.Popen(
            [binary, "app-server", "--listen", "stdio://"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        self._initialize()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if not self.proc:
            return
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=2)
        if self.proc.stderr:
            self._stderr = self.proc.stderr.read()

    def read_account(self) -> Dict[str, Any]:
        return self._request("account/read", {})

    def list_models(self) -> List[Dict[str, Any]]:
        result = self._request("model/list", {})
        return list(result.get("data") or [])

    def start_thread(
        self,
        *,
        cwd: str,
        model: str,
        base_instructions: str | None = None,
        developer_instructions: str | None = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "ephemeral": False,
            "cwd": cwd,
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "model": model,
        }
        if base_instructions is not None:
            params["baseInstructions"] = base_instructions
        if developer_instructions is not None:
            params["developerInstructions"] = developer_instructions
        result = self._request(
            "thread/start",
            params,
        )
        thread = result.get("thread")
        if not isinstance(thread, dict) or not str(thread.get("id") or "").strip():
            raise CodexLocalProviderError("Codex Local did not return a thread id.")
        return result

    def resume_thread(
        self,
        *,
        thread_id: str,
        cwd: str,
        model: str,
        base_instructions: str | None = None,
        developer_instructions: str | None = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "threadId": thread_id,
            "cwd": cwd,
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "model": model,
        }
        if base_instructions is not None:
            params["baseInstructions"] = base_instructions
        if developer_instructions is not None:
            params["developerInstructions"] = developer_instructions
        result = self._request(
            "thread/resume",
            params,
        )
        thread = result.get("thread")
        if not isinstance(thread, dict) or not str(thread.get("id") or "").strip():
            raise CodexLocalProviderError("Codex Local did not return a resumed thread id.")
        return result

    def interrupt_turn(self, *, thread_id: str, turn_id: str) -> None:
        self._request(
            "turn/interrupt",
            {"threadId": thread_id, "turnId": turn_id},
            timeout_seconds=5,
        )

    def archive_thread(self, *, thread_id: str) -> None:
        self._request("thread/archive", {"threadId": thread_id})

    def compact_thread(
        self,
        *,
        thread_id: str,
        cancel_event: Event | None = None,
    ) -> Dict[str, Any]:
        notifications: List[Dict[str, Any]] = []
        self._request(
            "thread/compact/start",
            {"threadId": thread_id},
            notifications=notifications,
        )
        compaction_turn_id = ""
        usage_snapshot: Dict[str, Any] = {}
        model_context_window: int | None = None
        item_completed = False
        turn_completed = False
        thread_idle = False
        completed = False
        failure_message = ""

        def handle_message(message: Dict[str, Any]) -> None:
            nonlocal compaction_turn_id, usage_snapshot, model_context_window
            nonlocal item_completed, turn_completed, thread_idle, completed, failure_message
            method = str(message.get("method") or "").strip()
            params = message.get("params") if isinstance(message.get("params"), dict) else {}
            if str(params.get("threadId") or "").strip() != thread_id:
                return
            if method == "turn/started":
                turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
                compaction_turn_id = str(turn.get("id") or "").strip()
                item_completed = False
                turn_completed = False
                thread_idle = False
                completed = False
                return
            if method == "thread/status/changed":
                status = params.get("status") if isinstance(params.get("status"), dict) else {}
                thread_idle = str(status.get("type") or "").strip() == "idle"
                completed = item_completed and (turn_completed or thread_idle)
                return
            turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
            event_turn_id = str(params.get("turnId") or turn.get("id") or "").strip()
            if not compaction_turn_id or event_turn_id != compaction_turn_id:
                return
            if method == "thread/tokenUsage/updated":
                token_usage = params.get("tokenUsage") if isinstance(params.get("tokenUsage"), dict) else {}
                usage_snapshot = dict(token_usage.get("last") or {})
                raw_window = token_usage.get("modelContextWindow")
                model_context_window = int(raw_window) if raw_window is not None else None
                return
            if method == "item/completed":
                item = params.get("item") if isinstance(params.get("item"), dict) else {}
                item_completed = (
                    str(item.get("type") or "").strip() == "contextCompaction"
                )
                completed = item_completed and (turn_completed or thread_idle)
                return
            if method == "error":
                error = params.get("error") if isinstance(params.get("error"), dict) else {}
                failure_message = _clean_codex_error_message(error.get("message"))
                return
            if method == "turn/completed":
                turn_completed = str(turn.get("status") or "").strip() == "completed"
                completed = item_completed and turn_completed
                if not turn_completed:
                    error = turn.get("error") if isinstance(turn.get("error"), dict) else {}
                    failure_message = _clean_codex_error_message(error.get("message"))

        for notification in notifications:
            handle_message(notification)
        deadline = time.monotonic() + self.timeout_seconds
        while not completed and not failure_message:
            if cancel_event and cancel_event.is_set():
                if compaction_turn_id:
                    self.interrupt_turn(thread_id=thread_id, turn_id=compaction_turn_id)
                raise CodexLocalProviderCancelled("Codex Local compaction was interrupted.")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CodexLocalProviderError(
                    "Codex Local timed out while compacting the thread."
                )
            message = self._read_message(
                min(remaining, 0.25) if cancel_event else remaining,
                allow_timeout=bool(cancel_event),
            )
            if message is not None:
                handle_message(message)
        if failure_message:
            raise CodexLocalProviderError(failure_message)
        usage = _normalize_usage_snapshot(usage_snapshot)
        if model_context_window is not None:
            usage["model_context_window"] = model_context_window
        return {
            "completed": True,
            "provider_turn_id": compaction_turn_id or None,
            "usage": usage,
        }

    def run_turn(
        self,
        *,
        thread_id: str,
        input_items: List[Dict[str, Any]],
        output_schema: Optional[Dict[str, Any]] = None,
        cancel_event: Event | None = None,
        effort: Optional[str] = None,
        client_user_message_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        notifications: List[Dict[str, Any]] = []
        params: Dict[str, Any] = {
            "threadId": thread_id,
            "input": input_items,
        }
        if output_schema is not None:
            params["outputSchema"] = output_schema
        if effort is not None:
            params["effort"] = effort
        if client_user_message_id is not None:
            params["clientUserMessageId"] = client_user_message_id
        result = self._request("turn/start", params, notifications=notifications)
        turn = result.get("turn") if isinstance(result, dict) else None
        turn_id = str((turn or {}).get("id") or "").strip()
        if not turn_id:
            raise CodexLocalProviderError("Codex Local did not return a turn id.")
        return self._collect_turn(thread_id=thread_id, turn_id=turn_id, initial_notifications=notifications, cancel_event=cancel_event)

    def _initialize(self) -> None:
        self._request(
            "initialize",
            {
                "clientInfo": dict(_APP_SERVER_CLIENT_INFO),
                "capabilities": {
                    "experimentalApi": True,
                    "optOutNotificationMethods": list(_APP_SERVER_OPT_OUT_NOTIFICATIONS),
                },
            },
            timeout_seconds=15,
        )
        self._notify("initialized")

    def _collect_turn(
        self,
        *,
        thread_id: str,
        turn_id: str,
        initial_notifications: List[Dict[str, Any]],
        cancel_event: Event | None = None,
    ) -> Dict[str, Any]:
        agent_text_chunks: List[str] = []
        final_text = ""
        usage_snapshot: Dict[str, Any] = {}
        model_context_window: int | None = None
        turn_completed = False
        turn_failed_message = ""
        events: List[Dict[str, Any]] = list(initial_notifications)

        def handle_message(message: Dict[str, Any]) -> bool:
            nonlocal final_text, usage_snapshot, model_context_window, turn_completed, turn_failed_message
            events.append(message)
            method = str(message.get("method") or "").strip()
            params = message.get("params") if isinstance(message.get("params"), dict) else {}
            if method == "item/agentMessage/delta" and str(params.get("turnId") or "").strip() == turn_id:
                delta = str(params.get("delta") or "")
                if delta:
                    agent_text_chunks.append(delta)
                return False
            if method == "item/completed" and str(params.get("turnId") or "").strip() == turn_id:
                item = params.get("item") if isinstance(params.get("item"), dict) else {}
                if str(item.get("type") or "").strip() == "agentMessage" and str(item.get("phase") or "").strip() == "final_answer":
                    text = str(item.get("text") or "").strip()
                    if text:
                        final_text = text
                return False
            if method == "thread/tokenUsage/updated" and str(params.get("turnId") or "").strip() == turn_id:
                token_usage = params.get("tokenUsage") if isinstance(params.get("tokenUsage"), dict) else {}
                usage_snapshot = dict(token_usage.get("last") or token_usage.get("total") or {})
                raw_window = token_usage.get("modelContextWindow")
                model_context_window = int(raw_window) if raw_window is not None else None
                return False
            if method == "thread/status/changed" and str(params.get("threadId") or "").strip() == thread_id:
                status = params.get("status") if isinstance(params.get("status"), dict) else {}
                status_type = str(status.get("type") or "").strip()
                if status_type == "idle" and (final_text or agent_text_chunks):
                    # App Server can emit transient retry errors before a successful
                    # answer. A final answer followed by idle is authoritative.
                    turn_failed_message = ""
                    turn_completed = True
                    return True
                if status_type == "idle" and (turn_failed_message or usage_snapshot):
                    turn_completed = True
                    return True
                if status_type == "systemError" and turn_failed_message:
                    turn_completed = True
                    return True
                return False
            if method == "error" and str(params.get("turnId") or "").strip() == turn_id:
                error = params.get("error") if isinstance(params.get("error"), dict) else {}
                turn_failed_message = _clean_codex_error_message(error.get("message"))
                return False
            if method == "turn/completed" and str(params.get("threadId") or "").strip() == thread_id:
                turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
                if str(turn.get("id") or "").strip() != turn_id:
                    return False
                if str(turn.get("status") or "").strip() != "completed":
                    turn_failed_message = _clean_codex_error_message((turn.get("error") or {}).get("message") if isinstance(turn.get("error"), dict) else "")
                else:
                    # Successful terminal state supersedes transient `error`
                    # notifications such as stream reconnect attempts.
                    turn_failed_message = ""
                turn_completed = True
                return True
            return False

        for notification in list(initial_notifications):
            if handle_message(notification):
                break

        deadline = time.monotonic() + self.timeout_seconds
        while not turn_completed:
            if cancel_event and cancel_event.is_set():
                self.interrupt_turn(thread_id=thread_id, turn_id=turn_id)
                raise CodexLocalProviderCancelled("Codex Local turn was interrupted.")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CodexLocalProviderError("Codex Local timed out while waiting for a response.")
            message = self._read_message(min(remaining, 0.25) if cancel_event else remaining, allow_timeout=bool(cancel_event))
            if message is None:
                continue
            handle_message(message)

        resolved_text = final_text or "".join(agent_text_chunks).strip()
        if turn_failed_message:
            raise CodexLocalProviderError(turn_failed_message)
        if not resolved_text:
            raise CodexLocalProviderError("Codex Local returned an empty response.")
        usage = _normalize_usage_snapshot(usage_snapshot)
        if model_context_window is not None:
            usage["model_context_window"] = model_context_window
        return {
            "generated_text": resolved_text,
            "usage": usage,
            "provider_thread_id": thread_id,
            "provider_session_id": thread_id,
            "provider_turn_id": turn_id,
            "provider_response_id": f"{thread_id}:{turn_id}",
            "events": events,
        }

    def _notify(self, method: str, params: Optional[Dict[str, Any]] = None) -> None:
        payload: Dict[str, Any] = {"method": method}
        if params is not None:
            payload["params"] = params
        self._send(payload)

    def _request(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
        *,
        timeout_seconds: Optional[float] = None,
        notifications: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        request_id = self._next_request_id
        self._next_request_id += 1
        payload: Dict[str, Any] = {"id": request_id, "method": method}
        if params is not None:
            payload["params"] = params
        self._send(payload)
        deadline = time.monotonic() + (timeout_seconds or self.timeout_seconds)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CodexLocalProviderError(f"Codex Local timed out while waiting for {method}.")
            message = self._read_message(remaining)
            if message.get("id") == request_id:
                if isinstance(message.get("error"), dict):
                    raise CodexLocalProviderError(_clean_codex_error_message(message["error"].get("message")))
                result = message.get("result")
                if not isinstance(result, dict):
                    raise CodexLocalProviderError(f"Codex Local returned an invalid response for {method}.")
                return result
            if notifications is not None:
                notifications.append(message)

    def _send(self, payload: Dict[str, Any]) -> None:
        if not self.proc or not self.proc.stdin:
            raise CodexLocalProviderError("Codex Local App Server is not running.")
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def _read_message(self, timeout_seconds: float, *, allow_timeout: bool = False) -> Dict[str, Any] | None:
        if not self.proc or not self.proc.stdout:
            raise CodexLocalProviderError("Codex Local App Server is not running.")
        fileno = self.proc.stdout.fileno()
        readable, _, _ = select.select([fileno], [], [], max(timeout_seconds, 0.0))
        if not readable:
            if allow_timeout:
                return None
            raise CodexLocalProviderError("Codex Local App Server did not respond.")
        line = self.proc.stdout.readline()
        if not line:
            stderr_output = ""
            if self.proc.stderr:
                stderr_output = self.proc.stderr.read().strip()
            raise CodexLocalProviderError(_clean_codex_error_message(stderr_output) or "Codex Local App Server closed unexpectedly.")
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CodexLocalProviderError("Codex Local App Server returned invalid JSON.") from exc
        if not isinstance(parsed, dict):
            raise CodexLocalProviderError("Codex Local App Server returned an invalid message.")
        return parsed


def archive_codex_local_thread(*, session_key: str, thread_id: str) -> bool:
    normalized_thread_id = str(thread_id or "").strip()
    if not normalized_thread_id:
        return False
    close_codex_local_skill_session(session_key)
    temp_root = Path(tempfile.mkdtemp(prefix="media-studio-codex-local-archive-"))
    try:
        with _CodexAppServerSession(
            temp_root=temp_root,
            timeout_seconds=30,
        ) as session:
            session.archive_thread(thread_id=normalized_thread_id)
        return True
    except CodexLocalProviderError:
        return False
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def _probe_bundle(*, model_id: Optional[str], require_images: bool) -> Tuple[Dict[str, Any], Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    temp_root = Path(tempfile.mkdtemp(prefix="media-studio-codex-local-probe-"))
    try:
        with _CodexAppServerSession(temp_root=temp_root, timeout_seconds=CODEX_APP_SERVER_TIMEOUT_SECONDS) as session:
            account_response = session.read_account()
            account = account_response.get("account") if isinstance(account_response.get("account"), dict) else None
            if not account or str(account.get("type") or "").strip() != "chatgpt":
                raise CodexLocalProviderError("Codex Local requires a ChatGPT-backed Codex login. Run `codex login` and choose ChatGPT.")
            models = session.list_models()
            catalog = _normalize_model_catalog(models, model_id)
            selected = _select_catalog_model(catalog, model_id)
            if require_images and not bool(selected.get("supports_images")):
                raise CodexLocalProviderError(f"{selected['label']} does not accept image input in Codex Local.")
            thread_result = session.start_thread(cwd=str(temp_root), model=str(selected["id"]))
            thread = thread_result.get("thread") if isinstance(thread_result.get("thread"), dict) else {}
            turn_inputs: List[Dict[str, Any]] = [{"type": "text", "text": "Reply with exactly OK and nothing else."}]
            if require_images:
                turn_inputs = [
                    {"type": "text", "text": "Describe the image in one short sentence."},
                    {"type": "localImage", "path": str(_create_probe_image(temp_root))},
                ]
            result = session.run_turn(thread_id=str(thread.get("id") or ""), input_items=turn_inputs)
            return account, selected, catalog, result
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def load_codex_local_catalog(
    *,
    model_id: Optional[str] = None,
    require_images: bool = False,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    binary = codex_command_path()
    if not binary:
        raise CodexLocalProviderError("The `codex` command is not installed or not on PATH.")
    cache_hit = not force_refresh and _cached_catalog_fresh()
    account, catalog = _load_account_and_catalog(selected_model_id=model_id, force_refresh=force_refresh)
    selected = _select_catalog_model(catalog, model_id)
    if require_images and not bool(selected.get("supports_images")):
        raise CodexLocalProviderError(f"{selected['label']} does not accept image input in Codex Local.")
    selected_payload = {
        **selected,
        "raw": {
            **dict(selected.get("raw") or {}),
            "binary_path": binary,
            "credential_source": CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE,
            "provider_base_url": CODEX_LOCAL_PROVIDER_BASE_URL,
            "probe_response_id": None,
            "account_type": account.get("type"),
            "plan_type": account.get("planType"),
            "account_email": account.get("email"),
            "catalog_cache_hit": cache_hit,
        },
    }
    return {
        "ok": True,
        "provider": "codex_local",
        "credential_source": CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE,
        "selected_model": selected_payload,
        "available_models": catalog,
    }


def test_codex_local_connection(*, model_id: Optional[str] = None, require_images: bool = False) -> Dict[str, Any]:
    binary = codex_command_path()
    if not binary:
        raise CodexLocalProviderError("The `codex` command is not installed or not on PATH.")
    account, selected, catalog, result = _probe_bundle(model_id=model_id, require_images=require_images)
    selected_payload = {
        **selected,
        "raw": {
            **dict(selected.get("raw") or {}),
            "binary_path": binary,
            "credential_source": CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE,
            "provider_base_url": CODEX_LOCAL_PROVIDER_BASE_URL,
            "probe_response_id": result.get("provider_response_id"),
            "account_type": account.get("type"),
            "plan_type": account.get("planType"),
            "account_email": account.get("email"),
        },
    }
    return {
        "ok": True,
        "provider": "codex_local",
        "credential_source": CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE,
        "selected_model": selected_payload,
        "available_models": catalog,
    }


def run_codex_local_chat(
    *,
    model_id: str,
    messages: List[Dict[str, Any]],
    response_format: Optional[Dict[str, Any]] = None,
    error_context: str = "request",
    timeout_seconds: Optional[float] = None,
    cancel_event: Event | None = None,
    codex_session_key: Optional[str] = None,
    provider_thread_id: Optional[str] = None,
    force_new_codex_session: bool = False,
    thread_base_instructions: Optional[str] = None,
    thread_developer_instructions: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
    client_user_message_id: Optional[str] = None,
    compact_before_turn: bool = False,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    del error_context
    output_schema = _response_format_to_output_schema(response_format)
    selected_model_id = str(model_id or CODEX_LOCAL_DEFAULT_MODEL)
    session_key = str(codex_session_key or "").strip()
    preferred_thread_id = str(provider_thread_id or "").strip() or None
    provider_thread_reused = False
    fallback_mode: str | None = None
    thread_lifecycle: List[str] = []
    prompt_bytes = 0
    actual_reasoning_effort: Optional[str] = None
    compaction: Dict[str, Any] | None = None

    if session_key:
        if force_new_codex_session:
            close_codex_local_skill_session(session_key)
        managed, provider_thread_reused, managed_lifecycle = _managed_codex_local_session(
            session_key=session_key,
            model_id=selected_model_id,
            timeout_seconds=timeout_seconds or CODEX_APP_SERVER_TIMEOUT_SECONDS,
            preferred_thread_id=preferred_thread_id,
            base_instructions=thread_base_instructions,
            developer_instructions=thread_developer_instructions,
        )
        thread_lifecycle.extend(managed_lifecycle)
        try:
            with managed.lock:
                if compact_before_turn and managed.compaction_due():
                    triggering_usage = {
                        "prompt_tokens": managed.context_input_tokens,
                        "model_context_window": managed.model_context_window,
                    }
                    next_threshold = managed.defer_next_compaction()
                    try:
                        compacted = managed.session.compact_thread(
                            thread_id=managed.thread_id,
                            cancel_event=cancel_event,
                        )
                        compaction = {
                            "outcome": "completed",
                            "thread_id": managed.thread_id,
                            "provider_turn_id": compacted.get("provider_turn_id"),
                            "triggering_usage": triggering_usage,
                            "completion_usage": dict(compacted.get("usage") or {}),
                            "next_eligible_threshold": next_threshold,
                        }
                        thread_lifecycle.append("thread_compacted")
                    except CodexLocalProviderCancelled:
                        raise
                    except CodexLocalProviderError as exc:
                        compaction = {
                            "outcome": "failed_resumable",
                            "thread_id": managed.thread_id,
                            "triggering_usage": triggering_usage,
                            "error": str(exc),
                            "next_eligible_threshold": next_threshold,
                        }
                        thread_lifecycle.append("thread_compaction_failed")
                input_items = _message_to_turn_input(_messages_for_response_format(messages, response_format), managed.temp_root)
                prompt_bytes = len(json.dumps(input_items, separators=(",", ":")).encode("utf-8"))
                actual_reasoning_effort = _clamp_reasoning_effort(
                    managed.session,
                    selected_model_id,
                    reasoning_effort,
                )
                turn_kwargs: Dict[str, Any] = {
                    "thread_id": managed.thread_id,
                    "input_items": input_items,
                    "output_schema": output_schema,
                    "cancel_event": cancel_event,
                }
                if actual_reasoning_effort is not None:
                    turn_kwargs["effort"] = actual_reasoning_effort
                if client_user_message_id is not None:
                    turn_kwargs["client_user_message_id"] = client_user_message_id
                result = managed.session.run_turn(
                    **turn_kwargs,
                )
                managed.record_usage(dict(result.get("usage") or {}))
                managed.last_used_at = time.monotonic()
        except Exception:
            with _CODEX_LOCAL_SKILL_SESSIONS_LOCK:
                if _CODEX_LOCAL_SKILL_SESSIONS.get(session_key) is managed:
                    _CODEX_LOCAL_SKILL_SESSIONS.pop(session_key, None)
            managed.close()
            raise
    else:
        temp_root = Path(tempfile.mkdtemp(prefix="media-studio-codex-local-chat-"))
        try:
            input_items = _message_to_turn_input(_messages_for_response_format(messages, response_format), temp_root)
            prompt_bytes = len(json.dumps(input_items, separators=(",", ":")).encode("utf-8"))
            with _CodexAppServerSession(temp_root=temp_root, timeout_seconds=timeout_seconds or CODEX_APP_SERVER_TIMEOUT_SECONDS) as session:
                working_directory = str(_codex_working_directory())
                if preferred_thread_id:
                    try:
                        thread_result = session.resume_thread(
                            thread_id=preferred_thread_id,
                            **_thread_setup_kwargs(
                                cwd=working_directory,
                                model=selected_model_id,
                                base_instructions=thread_base_instructions,
                                developer_instructions=thread_developer_instructions,
                            ),
                        )
                        thread_lifecycle.append("thread_resumed")
                    except CodexLocalProviderError:
                        thread_lifecycle.extend(
                            ["thread_resume_failed", "fallback_hydrated", "thread_replaced"]
                        )
                        fallback_mode = "provider_thread_unavailable"
                        thread_result = session.start_thread(
                            **_thread_setup_kwargs(
                                cwd=working_directory,
                                model=selected_model_id,
                                base_instructions=thread_base_instructions,
                                developer_instructions=thread_developer_instructions,
                            )
                        )
                else:
                    thread_result = session.start_thread(
                        **_thread_setup_kwargs(
                            cwd=working_directory,
                            model=selected_model_id,
                            base_instructions=thread_base_instructions,
                            developer_instructions=thread_developer_instructions,
                        )
                    )
                    thread_lifecycle.append("thread_started")
                thread = thread_result.get("thread") if isinstance(thread_result.get("thread"), dict) else {}
                thread_id = str(thread.get("id") or "").strip()
                actual_reasoning_effort = _clamp_reasoning_effort(
                    session,
                    selected_model_id,
                    reasoning_effort,
                )
                turn_kwargs = {
                    "thread_id": thread_id,
                    "input_items": input_items,
                    "output_schema": output_schema,
                    "cancel_event": cancel_event,
                }
                if actual_reasoning_effort is not None:
                    turn_kwargs["effort"] = actual_reasoning_effort
                if client_user_message_id is not None:
                    turn_kwargs["client_user_message_id"] = client_user_message_id
                result = session.run_turn(**turn_kwargs)
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)
    usage = dict(result.get("usage") or {})
    result_thread_id = str(result.get("provider_thread_id") or result.get("provider_session_id") or provider_thread_id or "").strip()
    result_turn_id = str(result.get("provider_turn_id") or "").strip()
    provider_response_id = str(result.get("provider_response_id") or "").strip()
    if session_key and preferred_thread_id and not provider_thread_reused and result_thread_id != preferred_thread_id:
        fallback_mode = "provider_thread_unavailable"
    if result_thread_id and result_turn_id:
        provider_response_id = provider_response_id or f"{result_thread_id}:{result_turn_id}"
    elif result_thread_id:
        provider_response_id = provider_response_id or result_thread_id
    process_lifecycle = "process_reused" if provider_thread_reused else "process_spawned"
    reuse_mode = (
        "live_process"
        if provider_thread_reused
        else "disk_resume"
        if "thread_resumed" in thread_lifecycle
        else "replacement_thread"
        if "thread_replaced" in thread_lifecycle
        else "new_thread"
    )
    return {
        "provider_kind": "codex_local",
        "provider_model_id": selected_model_id,
        "provider_base_url": CODEX_LOCAL_PROVIDER_BASE_URL,
        "provider_session_id": result_thread_id or None,
        "provider_thread_id": result_thread_id or None,
        "provider_turn_id": result_turn_id or None,
        "provider_thread_reused": provider_thread_reused,
        "process_lifecycle": process_lifecycle,
        "reuse_mode": reuse_mode,
        "fallback_mode": fallback_mode,
        "thread_lifecycle": thread_lifecycle,
        "provider_response_id": provider_response_id or None,
        "usage": usage,
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "total_tokens": usage.get("total_tokens"),
        "latency_ms": int((time.perf_counter() - started_at) * 1000),
        "prompt_bytes": prompt_bytes,
        "reasoning_effort": actual_reasoning_effort,
        "client_user_message_id": client_user_message_id,
        "compaction": compaction,
        "cost": None,
        "generated_text": str(result.get("generated_text") or "").strip(),
        "warnings": [],
    }
