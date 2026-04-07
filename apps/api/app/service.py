from __future__ import annotations

import mimetypes
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw

from . import enhancement_provider, kie_adapter, store
from .pricing import attach_pricing_summary
from .settings import settings
from .schemas import (
    EnhancePreviewRequest,
    EnhancementConfigRecord,
    PresetUpsertRequest,
    SystemPromptUpsertRequest,
    ValidateRequest,
)

TEXT_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
IMAGE_TOKEN_RE = re.compile(r"\[\[\s*([a-zA-Z0-9_]+)\s*\]\]")
NANO_PRESET_MODELS = {"nano-banana-2", "nano-banana-pro"}
GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"
ENHANCEMENT_PROVIDER_TIMEOUT_SECONDS = 25


class ServiceError(Exception):
    pass


def validate_preset_payload(payload: PresetUpsertRequest) -> Dict[str, Any]:
    template = payload.prompt_template or ""
    text_tokens = sorted(set(TEXT_TOKEN_RE.findall(template)))
    image_tokens = sorted(set(IMAGE_TOKEN_RE.findall(template)))
    text_fields = [dict(field) for field in payload.input_schema_json]
    image_slots = [dict(slot) for slot in payload.input_slots_json]
    text_keys = sorted([field["key"] for field in text_fields])
    slot_keys = sorted([slot["key"] for slot in image_slots])
    if text_tokens != text_keys:
        raise ServiceError("Prompt template text tokens must exactly match configured text field keys.")
    if image_tokens != slot_keys:
        raise ServiceError("Prompt template image slot tokens must exactly match configured image slot keys.")
    if len(text_keys) != len(set(text_keys)) or len(slot_keys) != len(set(slot_keys)):
        raise ServiceError("Preset keys must be unique.")
    applies_to_models = [str(value).strip() for value in payload.applies_to_models if str(value).strip()]
    invalid_models = [value for value in applies_to_models if value not in NANO_PRESET_MODELS]
    if invalid_models:
        raise ServiceError("Unsupported preset model scope: %s" % ", ".join(sorted(invalid_models)))
    if not applies_to_models:
        raise ServiceError("Select at least one Nano Banana model for this preset.")
    model_key = payload.model_key or applies_to_models[0]
    if model_key not in applies_to_models:
        applies_to_models = [model_key, *[value for value in applies_to_models if value != model_key]]
    return {
        "key": payload.key,
        "label": payload.label,
        "description": payload.description,
        "status": payload.status,
        "model_key": model_key,
        "source_kind": payload.source_kind,
        "base_builtin_key": payload.base_builtin_key,
        "applies_to_models_json": applies_to_models,
        "applies_to_task_modes_json": payload.applies_to_task_modes,
        "applies_to_input_patterns_json": payload.applies_to_input_patterns,
        "prompt_template": payload.prompt_template or "",
        "system_prompt_template": payload.system_prompt_template or "",
        "system_prompt_ids_json": payload.system_prompt_ids,
        "default_options_json": payload.default_options_json,
        "rules_json": payload.rules_json,
        "requires_image": payload.requires_image,
        "requires_video": payload.requires_video,
        "requires_audio": payload.requires_audio,
        "input_schema_json": text_fields,
        "input_slots_json": image_slots,
        "choice_groups_json": payload.choice_groups_json,
        "thumbnail_path": payload.thumbnail_path,
        "thumbnail_url": payload.thumbnail_url,
        "notes": payload.notes,
        "version": payload.version,
        "priority": payload.priority,
    }


def upsert_preset(payload: PresetUpsertRequest, preset_id: Optional[str] = None) -> Dict[str, Any]:
    record = validate_preset_payload(payload)
    if preset_id:
        record["preset_id"] = preset_id
    return store.create_or_update_preset(record)


def upsert_system_prompt(payload: SystemPromptUpsertRequest, prompt_id: Optional[str] = None) -> Dict[str, Any]:
    record = payload.model_dump()
    if prompt_id:
        record["prompt_id"] = prompt_id
    return store.create_or_update_system_prompt(record)


def upsert_enhancement_config(payload: Dict[str, Any], model_key: Optional[str] = None) -> Dict[str, Any]:
    record = payload.copy()
    if model_key:
        record["model_key"] = model_key
    return store.create_or_update_enhancement_config(record)


def public_enhancement_config(record: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(record.get("provider_kind") or "builtin").strip()
    stored_api_key = str(record.get("provider_api_key") or "").strip()
    stored_base_url = str(record.get("provider_base_url") or "").strip()

    credential_source: str | None = None
    if stored_api_key:
        credential_source = "stored"
    elif provider_kind == "openrouter" and settings.openrouter_api_key:
        credential_source = "env"
    elif provider_kind == "local_openai" and settings.local_openai_api_key:
        credential_source = "env"

    payload = record.copy()
    payload.pop("provider_api_key", None)
    payload.pop("provider_base_url", None)
    payload["provider_api_key_configured"] = bool(stored_api_key)
    payload["provider_base_url_configured"] = bool(stored_base_url)
    payload["provider_credential_source"] = credential_source
    return EnhancementConfigRecord(**payload).model_dump()


def probe_enhancement_provider(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(payload.get("provider_kind") or "").strip()
    require_images = bool(payload.get("require_images"))
    model_key = str(payload.get("model_key") or "").strip()
    current_config = store.get_enhancement_config(model_key) if model_key else None
    api_key = payload.get("api_key") or (current_config or {}).get("provider_api_key")
    base_url = payload.get("base_url") or (current_config or {}).get("provider_base_url")
    selected_model_id = payload.get("selected_model_id")
    if provider_kind == "openrouter":
        return enhancement_provider.test_openrouter_connection(
            api_key=api_key,
            model_id=selected_model_id,
            require_images=require_images,
            base_url=base_url,
        )
    if provider_kind == "local_openai":
        resolved_base = str(base_url or settings.local_openai_base_url).strip()
        if not resolved_base:
            raise ServiceError("Local OpenAI-compatible base URL is required.")
        return enhancement_provider.test_local_openai_connection(
            base_url=resolved_base,
            api_key=api_key,
            model_id=selected_model_id,
            require_images=require_images,
        )
    raise ServiceError("Unsupported enhancement provider.")


def _ref_to_kie(value: Dict[str, Any]) -> Dict[str, Any]:
    ref = {}
    for key in ("url", "path", "filename", "mime_type", "role", "duration_seconds"):
        if value.get(key):
            ref[key] = value[key]
    return ref


def _source_asset_to_kie_ref(asset_id: str | None) -> Dict[str, Any] | None:
    if not asset_id:
        return None
    asset = store.get_asset(str(asset_id))
    if not asset:
        return None
    for key in ("hero_original_path", "hero_web_path", "hero_thumb_path", "hero_poster_path"):
        value = asset.get(key)
        if not value:
            continue
        resolved = settings.data_root / str(value)
        if resolved.exists():
            mime_type = None
            suffix = resolved.suffix.lower()
            if suffix in {".jpg", ".jpeg"}:
                mime_type = "image/jpeg"
            elif suffix == ".png":
                mime_type = "image/png"
            elif suffix == ".webp":
                mime_type = "image/webp"
            elif suffix == ".mp4":
                mime_type = "video/mp4"
            return _ref_to_kie(
                {
                    "path": str(resolved),
                    "filename": resolved.name,
                    "mime_type": mime_type,
                }
            )
    return None


def _render_preset_prompt(template: str, text_values: Dict[str, str], image_slots: Dict[str, List[Dict[str, Any]]]) -> str:
    rendered = template
    for key, value in text_values.items():
        rendered = re.sub(r"\{\{\s*%s\s*\}\}" % re.escape(key), value, rendered)
    for key, refs in image_slots.items():
        rendered = re.sub(r"\[\[\s*%s\s*\]\]" % re.escape(key), "[%d image(s)]" % len(refs), rendered)
    return rendered


def _collect_system_prompts(ids: List[str]) -> List[Dict[str, Any]]:
    prompts = []
    for prompt_id in ids:
        prompt = store.get_system_prompt(prompt_id)
        if prompt:
            prompts.append(prompt)
    return prompts


def _resolve_preset(request: ValidateRequest) -> Tuple[Optional[Dict[str, Any]], Dict[str, str], Dict[str, List[Dict[str, Any]]], Optional[str]]:
    if not request.preset_id:
        return None, {}, {}, request.prompt
    preset = store.get_preset(request.preset_id)
    if not preset:
        raise ServiceError("Preset not found.")
    applies_to_models = preset.get("applies_to_models_json") or []
    if applies_to_models and request.model_key not in applies_to_models:
        raise ServiceError("Preset is not available for the selected model.")
    text_fields = preset.get("input_schema_json", [])
    slots = preset.get("input_slots_json", [])
    text_values = {}
    for field in text_fields:
        key = field["key"]
        value = request.preset_text_values.get(key) or field.get("default_value")
        if field.get("required") and not value:
            raise ServiceError("Missing required preset text field: %s" % key)
        if value:
            text_values[key] = value
    image_slot_values = {}
    for slot in slots:
        key = slot["key"]
        refs = [item.model_dump() for item in request.preset_image_slots.get(key, [])]
        if slot.get("required") and not refs:
            raise ServiceError("Missing required preset image slot: %s" % key)
        if refs:
            image_slot_values[key] = refs
    prompt = _render_preset_prompt(preset["prompt_template"] or "", text_values, image_slot_values)
    return preset, text_values, image_slot_values, prompt


def build_validation_bundle(request: ValidateRequest) -> Dict[str, Any]:
    preset, text_values, image_slot_values, final_prompt = _resolve_preset(request)
    selected_prompts = _collect_system_prompts(request.selected_system_prompt_ids)
    merged_images = [_ref_to_kie(item.model_dump()) for item in request.images]
    for refs in image_slot_values.values():
        merged_images.extend([_ref_to_kie(ref) for ref in refs])
    merged_videos = [_ref_to_kie(item.model_dump()) for item in request.videos]
    source_asset_ref = _source_asset_to_kie_ref(request.source_asset_id)
    if source_asset_ref:
        mime_type = str(source_asset_ref.get("mime_type") or "")
        if mime_type.startswith("video/"):
            merged_videos.append(source_asset_ref)
        else:
            merged_images.append(source_asset_ref)
    raw_request = {
        "model_key": request.model_key,
        "task_mode": request.task_mode,
        "prompt": final_prompt or request.prompt,
        "images": merged_images,
        "videos": merged_videos,
        "audios": [_ref_to_kie(item.model_dump()) for item in request.audios],
        "options": request.options,
        "prompt_profile_key": request.prompt_profile_key,
        "system_prompt_override": request.system_prompt_override,
        "prompt_policy": request.prompt_policy or ("ask" if request.enhance else "off"),
        "metadata": {
            "output_count": request.output_count,
            "selected_system_prompt_ids": request.selected_system_prompt_ids,
            "preset_text_values": text_values,
            "preset_image_slots": image_slot_values,
        },
    }
    prompt_context = kie_adapter.resolve_prompt_context(raw_request)
    validation = kie_adapter.validate_request(raw_request)
    try:
        preflight = kie_adapter.run_preflight(validation)
    except Exception as exc:
        preflight = {
            "decision": "reject",
            "can_submit": False,
            "reason": str(exc),
            "warnings": [],
            "estimated_cost": {
                "model_key": request.model_key,
                "estimated_credits": None,
                "estimated_cost_usd": None,
                "currency": "USD",
                "is_known": False,
                "has_numeric_estimate": False,
                "is_authoritative": False,
                "assumptions": [],
                "notes": [],
            },
        }
    estimated_cost = preflight.get("estimated_cost") if isinstance(preflight.get("estimated_cost"), dict) else None
    has_numeric_estimate = bool(estimated_cost and estimated_cost.get("has_numeric_estimate"))
    if not has_numeric_estimate:
        try:
            preflight["estimated_cost"] = kie_adapter.estimate_request_cost(raw_request)
        except Exception:
            pass
    preflight = attach_pricing_summary(preflight, output_count=request.output_count)
    return {
        "preset": preset,
        "raw_request": raw_request,
        "prompt_context": prompt_context,
        "validation": validation,
        "preflight": preflight,
        "pricing_summary": preflight.get("pricing_summary") or {},
        "final_prompt": final_prompt or request.prompt,
        "resolved_options": request.options,
        "selected_prompts": selected_prompts,
        "text_values": text_values,
        "image_slot_values": image_slot_values,
    }


def _resolved_enhancement_config(model_key: str) -> Dict[str, Any]:
    global_config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
    model_config = store.get_enhancement_config(model_key) or {}
    legacy_provider_config = model_config if (
        model_config.get("provider_model_id")
        or str(model_config.get("provider_kind") or "builtin").strip() != "builtin"
    ) else {}
    engine_config = global_config or legacy_provider_config
    if global_config or model_config:
        result = EnhancementConfigRecord(
            config_id=str(model_config.get("config_id") or global_config.get("config_id") or f"cfg-{model_key}"),
            model_key=model_key,
            label=str(model_config.get("label") or f"{model_key} enhancement"),
            helper_profile=str(model_config.get("helper_profile") or global_config.get("helper_profile") or "midctx-64k-no-thinking-q3-prefill"),
            provider_kind=str(engine_config.get("provider_kind") or "builtin"),
            provider_label=engine_config.get("provider_label"),
            provider_model_id=engine_config.get("provider_model_id"),
            provider_api_key_configured=bool(engine_config.get("provider_api_key")),
            provider_base_url_configured=bool(engine_config.get("provider_base_url")),
            provider_credential_source="stored" if engine_config.get("provider_api_key") else None,
            provider_supports_images=bool(engine_config.get("provider_supports_images")),
            provider_status=engine_config.get("provider_status"),
            provider_last_tested_at=engine_config.get("provider_last_tested_at"),
            provider_capabilities_json=engine_config.get("provider_capabilities_json") or {},
            system_prompt=str(model_config.get("system_prompt") or global_config.get("system_prompt") or ""),
            image_analysis_prompt=model_config.get("image_analysis_prompt") or global_config.get("image_analysis_prompt"),
            supports_text_enhancement=bool(
                model_config.get("supports_text_enhancement")
                if "supports_text_enhancement" in model_config
                else global_config.get("supports_text_enhancement", True)
            ),
            supports_image_analysis=bool(
                model_config.get("supports_image_analysis")
                if "supports_image_analysis" in model_config
                else global_config.get("supports_image_analysis", False)
            ),
            notes=model_config.get("notes") or global_config.get("notes"),
            status=str(model_config.get("status") or global_config.get("status") or "active"),
        ).model_dump()
        result["provider_api_key"] = engine_config.get("provider_api_key")
        result["provider_base_url"] = engine_config.get("provider_base_url")
        return result
    return EnhancementConfigRecord(
        config_id=f"cfg-{GLOBAL_ENHANCEMENT_CONFIG_KEY}",
        model_key=GLOBAL_ENHANCEMENT_CONFIG_KEY,
        label="Studio enhancement",
        helper_profile="midctx-64k-no-thinking-q3-prefill",
        provider_kind="builtin",
        provider_api_key_configured=False,
        provider_base_url_configured=False,
        supports_text_enhancement=True,
        supports_image_analysis=False,
    ).model_dump()


def _candidate_enhancement_image_paths(request: ValidateRequest, bundle: Dict[str, Any]) -> List[str]:
    paths: List[str] = []
    for item in request.images:
        if item.path:
            paths.append(str(item.path))
    for refs in bundle.get("image_slot_values", {}).values():
        for ref in refs:
            path_value = ref.get("path")
            if path_value:
                paths.append(str(path_value))
    if request.source_asset_id:
        asset = store.get_asset(str(request.source_asset_id))
        if asset:
            for key in ("hero_web_path", "hero_original_path", "hero_thumb_path", "hero_poster_path"):
                value = asset.get(key)
                if value:
                    resolved = settings.data_root / str(value)
                    if resolved.exists():
                        paths.append(str(resolved))
                        break
    deduped: List[str] = []
    seen = set()
    for path_value in paths:
        if path_value in seen:
            continue
        seen.add(path_value)
        deduped.append(path_value)
    return deduped


def _run_external_enhancement(config: Dict[str, Any], request: EnhancePreviewRequest, bundle: Dict[str, Any]) -> Dict[str, Any]:
    provider_kind = str(config.get("provider_kind") or "builtin").strip()
    provider_model_id = str(config.get("provider_model_id") or "").strip()
    if not provider_model_id:
        if provider_kind == "openrouter":
            provider_model_id = "qwen/qwen3.5-35b-a3b"
        else:
            raise ServiceError("Choose an enhancement model before running enhancement.")
    image_paths = _candidate_enhancement_image_paths(request, bundle)
    prompt_text = str(bundle.get("final_prompt") or request.prompt or "").strip()
    supports_text_enhancement = bool(config.get("supports_text_enhancement"))
    supports_image_analysis = bool(config.get("supports_image_analysis"))
    using_image_analysis = supports_image_analysis and bool(image_paths)
    if not prompt_text and not image_paths:
        raise ServiceError("Add a prompt or source media before enhancing.")
    if not supports_text_enhancement and not using_image_analysis:
        raise ServiceError("The selected enhancement model requires an image input.")
    if using_image_analysis and not bool(config.get("provider_supports_images")):
        raise ServiceError("The selected enhancement model does not support image input.")
    provider_api_key = config.get("provider_api_key") or None
    provider_base_url = config.get("provider_base_url") or None
    def run_provider_call() -> Dict[str, Any]:
        if provider_kind == "openrouter":
            return enhancement_provider.run_openai_compatible_enhancement(
                provider_kind="openrouter",
                base_url=str(provider_base_url or settings.openrouter_base_url),
                api_key=str(provider_api_key or settings.openrouter_api_key or ""),
                model_id=provider_model_id,
                prompt=prompt_text,
                media_model_key=request.model_key,
                task_mode=request.task_mode,
                system_prompt=config.get("system_prompt"),
                image_analysis_prompt=config.get("image_analysis_prompt"),
                image_paths=image_paths[:1] if using_image_analysis else [],
            )
        if provider_kind == "local_openai":
            return enhancement_provider.run_openai_compatible_enhancement(
                provider_kind="local_openai",
                base_url=str(provider_base_url or settings.local_openai_base_url),
                api_key=str(provider_api_key or settings.local_openai_api_key or ""),
                model_id=provider_model_id,
                prompt=prompt_text,
                media_model_key=request.model_key,
                task_mode=request.task_mode,
                system_prompt=config.get("system_prompt"),
                image_analysis_prompt=config.get("image_analysis_prompt"),
                image_paths=image_paths[:1] if using_image_analysis else [],
            )
        raise ServiceError("Unsupported enhancement provider.")
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(run_provider_call)
        try:
            return future.result(timeout=ENHANCEMENT_PROVIDER_TIMEOUT_SECONDS)
        except FuturesTimeoutError as exc:
            raise ServiceError("The enhancement provider timed out. Try again or switch the enhancement model in Settings.") from exc


def build_enhancement_preview(request: EnhancePreviewRequest) -> Dict[str, Any]:
    preview_request = request.model_copy(update={"prompt_policy": request.prompt_policy or "preview"})
    bundle = build_validation_bundle(preview_request)
    enhancement_config = _resolved_enhancement_config(preview_request.model_key)
    provider_kind = str(enhancement_config.get("provider_kind") or "builtin").strip()
    if provider_kind == "builtin":
        enhancement = kie_adapter.dry_run_prompt_enhancement(bundle["raw_request"])
    else:
        try:
            enhancement = _run_external_enhancement(enhancement_config, preview_request, bundle)
        except enhancement_provider.EnhancementProviderError as exc:
            raise ServiceError(str(exc)) from exc
    return {
        "prompt_context": enhancement.get("context") or bundle["prompt_context"],
        "enhancement": enhancement,
        "validation": bundle["validation"],
        "raw_prompt": bundle["final_prompt"] or preview_request.prompt,
        "enhanced_prompt": enhancement.get("enhanced_prompt"),
        "final_prompt_used": enhancement.get("final_prompt_used") or enhancement.get("enhanced_prompt"),
        "image_analysis": enhancement.get("image_analysis"),
        "warnings": enhancement.get("warnings") or [],
        "enhancement_config": enhancement_config,
        "provider_kind": provider_kind,
        "provider_label": enhancement_config.get("provider_label") or provider_kind,
        "provider_model_id": enhancement.get("provider_model_id") or enhancement_config.get("provider_model_id"),
        "resolved_options": bundle["resolved_options"],
    }


def submit_jobs(request: ValidateRequest) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    bundle = build_validation_bundle(request)
    validation_state = bundle["validation"].get("state")
    if validation_state not in {"ready", "ready_with_defaults", "ready_with_warning"}:
        raise ServiceError("Request is not ready for submit.")

    preset = bundle["preset"]
    batch_payload = {
        "model_key": request.model_key,
        "task_mode": request.task_mode,
        "requested_outputs": request.output_count,
        "source_asset_id": request.source_asset_id,
        "requested_preset_key": preset["key"] if preset else None,
        "resolved_preset_key": preset["key"] if preset else None,
        "preset_source": "media_preset" if preset else None,
        "request_summary_json": {
            "prompt": bundle["final_prompt"],
            "options": bundle["resolved_options"],
            "output_count": request.output_count,
            "preset_text_values": bundle["text_values"],
            "preset_image_slots": bundle["image_slot_values"],
            "pricing_summary": bundle["pricing_summary"],
        },
    }
    jobs_payload = []
    for index in range(request.output_count):
        jobs_payload.append(
            {
                "batch_index": index,
                "model_key": request.model_key,
                "task_mode": request.task_mode,
                "source_asset_id": request.source_asset_id,
                "requested_preset_key": preset["key"] if preset else None,
                "resolved_preset_key": preset["key"] if preset else None,
                "preset_source": "media_preset" if preset else None,
                "raw_prompt": request.prompt,
                "final_prompt_used": bundle["final_prompt"],
                "selected_system_prompt_ids_json": request.selected_system_prompt_ids,
                "selected_system_prompts_json": bundle["selected_prompts"],
                "resolved_system_prompt_json": bundle["prompt_context"],
                "resolved_options_json": bundle["resolved_options"],
                "normalized_request_json": bundle["validation"].get("normalized_request") or {},
                "prompt_context_json": bundle["prompt_context"],
                "validation_json": bundle["validation"],
                "preflight_json": bundle["preflight"],
            }
        )
    return store.create_batch_and_jobs(batch_payload, jobs_payload)


def _fake_output_image(target_path: Path, label: str) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1024, 1024), color=(15, 18, 16))
    draw = ImageDraw.Draw(image)
    draw.rectangle((48, 48, 976, 976), outline=(208, 255, 72), width=6)
    draw.text((100, 120), "Media Studio", fill=(247, 246, 240))
    draw.text((100, 180), label[:120], fill=(200, 200, 190))
    image.save(target_path)


def _relative_media_path(artifact: Dict[str, Any], path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None
    run_dir = artifact.get("run_dir")
    if not run_dir:
        return path_value
    absolute_path = Path(run_dir) / path_value
    try:
        return absolute_path.relative_to(settings.data_root).as_posix()
    except ValueError:
        return absolute_path.as_posix()


def _infer_output_kind(job: Dict[str, Any], output_path: Path, remote_output_url: Optional[str]) -> str:
    if output_path.exists():
        try:
            header = output_path.read_bytes()[:32]
        except OSError:
            header = b""
        if b"ftyp" in header[:16]:
            return "video"
        if header.startswith(b"\x1a\x45\xdf\xa3"):
            return "video"
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image"
        if header.startswith(b"\xff\xd8\xff"):
            return "image"
        if header.startswith(b"RIFF") and b"WEBP" in header[:16]:
            return "image"
        if header.startswith((b"GIF87a", b"GIF89a")):
            return "image"
    for candidate in (remote_output_url, str(output_path)):
        mime_type = mimetypes.guess_type(candidate or "")[0] or ""
        if mime_type.startswith("video/"):
            return "video"
        if mime_type.startswith("image/"):
            return "image"
    suffix = output_path.suffix.lower()
    if suffix in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
        return "video"
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "image"
    task_mode = str(job.get("task_mode") or "").lower()
    if "video" in task_mode:
        return "video"
    model_key = str(job.get("model_key") or "").lower()
    if "video" in model_key or "i2v" in model_key or "t2v" in model_key:
        return "video"
    return "image"


def _normalized_output_source_path(job: Dict[str, Any], output_path: Path, remote_output_url: Optional[str]) -> Path:
    output_kind = _infer_output_kind(job, output_path, remote_output_url)
    if output_kind == "video" and output_path.suffix.lower() not in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
        normalized = output_path.with_suffix(".mp4")
        if not normalized.exists():
            output_path.replace(normalized)
        return normalized
    if output_kind == "image" and output_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        extension = ".jpg"
        try:
            header = output_path.read_bytes()[:32]
        except OSError:
            header = b""
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            extension = ".png"
        elif header.startswith(b"RIFF") and b"WEBP" in header[:16]:
            extension = ".webp"
        elif header.startswith((b"GIF87a", b"GIF89a")):
            extension = ".gif"
        normalized = output_path.with_suffix(extension)
        if not normalized.exists():
            output_path.replace(normalized)
        return normalized
    return output_path


def publish_job_artifact(job: Dict[str, Any], output_path: Path, remote_output_url: Optional[str] = None) -> Dict[str, Any]:
    existing_asset = store.get_asset_by_job_id(job["job_id"])
    normalized_output_path = _normalized_output_source_path(job, output_path, remote_output_url)
    output_kind = _infer_output_kind(job, normalized_output_path, remote_output_url)
    payload = job["submit_response_json"]
    status = job["final_status_json"]
    artifact = kie_adapter.create_run_artifact(
        {
            "status": "succeeded",
            "model_key": job["model_key"],
            "task_mode": job.get("task_mode"),
            "provider_model": (job["validation_json"].get("normalized_request") or {}).get("provider_model"),
            "slug": job["job_id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "prompts": {
                "raw": job.get("raw_prompt"),
                "enhanced": job.get("enhanced_prompt"),
                "final_used": job.get("final_prompt_used"),
                "prompt_profile": job["prompt_context_json"].get("resolved_profile_key"),
            },
            "outputs": [{"kind": output_kind, "role": "output", "source_path": str(normalized_output_path)}],
            "options": job["resolved_options_json"],
            "provider_trace": {
                "task_id": job.get("provider_task_id"),
            },
            "submit_payload": payload.get("provider_payload"),
            "submit_response": payload,
            "final_status_response": status,
        }
    )
    output = artifact["outputs"][0]
    generation_kind = "video" if output_kind == "video" else "image"
    asset_payload = {
        "job_id": job["job_id"],
        "provider_task_id": job.get("provider_task_id"),
        "run_id": artifact["run_id"],
        "source_asset_id": job.get("source_asset_id"),
        "generation_kind": generation_kind,
        "model_key": job["model_key"],
        "status": "completed",
        "task_mode": job.get("task_mode"),
        "prompt_summary": job.get("final_prompt_used") or job.get("raw_prompt"),
        "artifact_run_dir": artifact["run_dir"],
        "manifest_path": _relative_media_path(artifact, artifact.get("manifest_path")),
        "run_json_path": _relative_media_path(artifact, "run.json"),
        "hero_original_path": _relative_media_path(artifact, output.get("original_path")),
        "hero_web_path": _relative_media_path(artifact, output.get("web_path")),
        "hero_thumb_path": _relative_media_path(artifact, output.get("thumb_path")),
        "hero_poster_path": _relative_media_path(artifact, output.get("poster_path")),
        "remote_output_url": remote_output_url,
        "preset_key": job.get("resolved_preset_key"),
        "preset_source": job.get("preset_source"),
        "payload_json": artifact,
        "tags_json": ["offline"] if not remote_output_url else [],
    }
    if existing_asset:
        asset_payload["asset_id"] = existing_asset["asset_id"]
    asset = store.create_or_update_asset(asset_payload)
    store.update_job(job["job_id"], {"artifact_json": artifact})
    return asset


def simulate_job_completion(job: Dict[str, Any], downloads_dir: Path) -> Dict[str, Any]:
    output_path = downloads_dir / ("%s.png" % job["job_id"])
    _fake_output_image(output_path, job.get("final_prompt_used") or job.get("raw_prompt") or job["model_key"])
    return publish_job_artifact(job, output_path)
