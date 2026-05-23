from __future__ import annotations

import time
from typing import Dict, List, Optional

from ... import service, store
from ...schemas import MediaRefInput, ValidateRequest
from ..cancellation import GRAPH_RUN_CANCELLED_MESSAGE, cancel_batch_jobs
from ..events import emit
from ..registry import registry
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor, GraphRunCancelled


SEEDANCE_MODEL_KEYS = {"seedance-2.0", "seedance_2_0"}


def _adaptive_graph_kie_poll_interval(elapsed_seconds: float) -> float:
    if elapsed_seconds < 10:
        return 0.5
    if elapsed_seconds < 45:
        return 1.0
    if elapsed_seconds < 180:
        return 2.0
    return 4.0


def _normalized_model_key(model_key: str) -> str:
    return str(model_key or "").strip().lower().replace("_", "-")


def _is_seedance_model(model_key: str) -> bool:
    normalized = _normalized_model_key(model_key)
    return normalized in SEEDANCE_MODEL_KEYS or normalized.startswith("seedance-2.0")


def _is_suno_model(model_key: str) -> bool:
    normalized = _normalized_model_key(model_key)
    return normalized.startswith("suno-") or "suno" in normalized


def _iter_nested_dicts(value) -> List[Dict]:
    if isinstance(value, dict):
        items = [value]
        for child in value.values():
            items.extend(_iter_nested_dicts(child))
        return items
    if isinstance(value, list):
        items: List[Dict] = []
        for child in value:
            items.extend(_iter_nested_dicts(child))
        return items
    return []


def _suno_metadata_items(job: Dict) -> List[Dict]:
    status = job.get("final_status_json") if isinstance(job.get("final_status_json"), dict) else {}
    raw_response = status.get("raw_response") if isinstance(status.get("raw_response"), dict) else {}
    metadata = raw_response.get("suno_output_metadata") if isinstance(raw_response, dict) else None
    return [item for item in _iter_nested_dicts(metadata) if isinstance(item, dict)]


def _suno_audio_url(item: Dict) -> str:
    for key in ("audio_url", "audioUrl", "source_audio_url"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _suno_cover_url(item: Dict) -> str:
    for key in ("image_url", "imageUrl", "cover_url", "coverUrl", "cover_image_url", "coverImageUrl"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _asset_remote_url(asset: Dict) -> str:
    return str(asset.get("remote_output_url") or "").strip()


def _suno_track_outputs(*, job: Dict, assets: List[Dict], batch_id: str) -> Dict[str, List[GraphOutputRef]]:
    audio_assets = [asset for asset in assets if str(asset.get("generation_kind") or "") == "audio"]
    if not audio_assets:
        return {}
    metadata_items = _suno_metadata_items(job)
    metadata_by_audio = {_suno_audio_url(item): item for item in metadata_items if _suno_audio_url(item)}
    outputs: Dict[str, List[GraphOutputRef]] = {}
    for index, asset in enumerate(audio_assets[:2], start=1):
        remote_url = _asset_remote_url(asset)
        provider_metadata = metadata_by_audio.get(remote_url) or (metadata_items[index - 1] if index - 1 < len(metadata_items) else {})
        cover_url = _suno_cover_url(provider_metadata)
        track_value = {
            "kind": "music_track",
            "track_index": index,
            "title": provider_metadata.get("title") or provider_metadata.get("name") or f"Music Track {index}",
            "audio": {
                "asset_id": asset["asset_id"],
                "remote_output_url": remote_url or None,
                "media_type": "audio",
            },
            "cover_image": {
                "remote_output_url": cover_url or None,
                "thumb_path": asset.get("hero_thumb_path"),
                "poster_path": asset.get("hero_poster_path"),
            },
            "provider_metadata": provider_metadata,
        }
        outputs[f"track_{index}"] = [
            GraphOutputRef(
                kind="value",
                media_type="music_track",
                value=track_value,
                job_id=job["job_id"],
                metadata={
                    "batch_id": batch_id,
                    "track_index": index,
                    "audio_asset_id": asset["asset_id"],
                    "cover_image_url": cover_url or None,
                },
            )
        ]
    return outputs


def completed_kie_job_outputs(
    *,
    node: GraphWorkflowNode,
    job: Dict,
    assets: List[Dict],
    batch_id: str,
) -> Dict[str, List[GraphOutputRef]]:
    definition = registry.get_definition(node.type)
    model_key = str(definition.source.get("model_key") or "")
    output_media_type = str(definition.source.get("output_media_type") or "image")
    outputs: Dict[str, List[GraphOutputRef]] = {"job": [GraphOutputRef(kind="job", job_id=job["job_id"], metadata={"batch_id": batch_id})]}
    if _is_suno_model(model_key):
        outputs.update(_suno_track_outputs(job=job, assets=assets, batch_id=batch_id))
        return {key: value for key, value in outputs.items() if value}
    for asset in assets:
        asset_media_type = str(asset.get("generation_kind") or output_media_type)
        output_port = "video" if asset_media_type == "video" else "audio" if asset_media_type == "audio" else "image"
        outputs.setdefault(output_port, []).append(
            GraphOutputRef(kind="asset", media_type=output_port, asset_id=asset["asset_id"], job_id=job["job_id"])
        )
    return {key: value for key, value in outputs.items() if value}


def wait_for_existing_kie_job(
    *,
    node: GraphWorkflowNode,
    context: GraphExecutionContext,
    job_id: str,
    batch_id: str,
) -> Dict[str, List[GraphOutputRef]]:
    from ...runner import runner

    deadline = time.time() + 3600
    polling_started = time.perf_counter()
    poll_count = 0
    sleep_seconds = 0.5
    current = store.get_job(job_id)
    if not current:
        raise ValueError(f"Cannot recover KIE job {job_id}: job record not found.")
    context.record_node_metric(node, "recovered_existing_kie_job", True)
    context.record_node_metric(node, "batch_id", batch_id)
    context.record_node_metric(node, "job_id", job_id)
    emit(context.run_id, "kie.recovering", {"job_id": job_id, "batch_id": batch_id}, node_id=node.id)
    while time.time() < deadline:
        if context.is_cancel_requested():
            cancel_batch_jobs(batch_id)
            raise GraphRunCancelled(GRAPH_RUN_CANCELLED_MESSAGE)
        current = store.get_job(job_id) or current
        if current["status"] in {"completed", "failed", "cancelled"}:
            break
        runner.tick()
        poll_count += 1
        elapsed = time.perf_counter() - polling_started
        sleep_seconds = _adaptive_graph_kie_poll_interval(elapsed)
        sleep_deadline = time.perf_counter() + sleep_seconds
        while time.perf_counter() < sleep_deadline:
            if context.is_cancel_requested():
                cancel_batch_jobs(batch_id)
                raise GraphRunCancelled(GRAPH_RUN_CANCELLED_MESSAGE)
            time.sleep(min(0.25, max(0.0, sleep_deadline - time.perf_counter())))
    context.record_node_metric(node, "kie_recovery_polling_duration_seconds", round(time.perf_counter() - polling_started, 4))
    context.record_node_metric(node, "kie_recovery_poll_count", poll_count)
    context.record_node_metric(node, "kie_recovery_poll_interval_seconds", sleep_seconds)
    current = store.get_job(job_id) or current
    if current["status"] == "cancelled" and context.is_cancel_requested():
        raise GraphRunCancelled(GRAPH_RUN_CANCELLED_MESSAGE)
    if current["status"] != "completed":
        raise ValueError(current.get("error") or f"KIE job did not complete: {current['status']}")
    assets = store.get_assets_by_job_id(current["job_id"])
    if not assets:
        raise ValueError("KIE job completed without creating an asset.")
    return completed_kie_job_outputs(node=node, job=current, assets=assets, batch_id=batch_id)


def _to_media_ref(value: GraphOutputRef, *, role: Optional[str] = None) -> MediaRefInput:
    return MediaRefInput(asset_id=value.asset_id, reference_id=value.reference_id, role=role)


def submit_and_wait_for_kie_request(
    *,
    node: GraphWorkflowNode,
    context: GraphExecutionContext,
    request: ValidateRequest,
    model_key: str,
) -> Dict[str, List[GraphOutputRef]]:
    emit(context.run_id, "kie.validating", {"model_key": model_key}, node_id=node.id)
    validation_started = time.perf_counter()
    service.build_validation_bundle(request)
    context.record_node_metric(node, "kie_validation_duration_seconds", round(time.perf_counter() - validation_started, 4))
    submit_started = time.perf_counter()
    batch, jobs = service.submit_jobs(request)
    context.record_node_metric(node, "kie_submit_duration_seconds", round(time.perf_counter() - submit_started, 4))
    job = jobs[0]
    context.record_node_metric(node, "batch_id", batch["batch_id"])
    context.record_node_metric(node, "job_id", job["job_id"])
    emit(context.run_id, "kie.submitted", {"model_key": model_key, "job_id": job["job_id"], "batch_id": batch["batch_id"]}, node_id=node.id)
    emit(context.run_id, "kie.polling", {"job_id": job["job_id"], "batch_id": batch["batch_id"]}, node_id=node.id)

    from ...runner import runner

    deadline = time.time() + 3600
    polling_started = time.perf_counter()
    current = job
    poll_count = 0
    sleep_seconds = 0.5
    while time.time() < deadline:
        if context.is_cancel_requested():
            cancel_batch_jobs(batch["batch_id"])
            raise GraphRunCancelled(GRAPH_RUN_CANCELLED_MESSAGE)
        current = store.get_job(job["job_id"]) or current
        if current["status"] in {"completed", "failed", "cancelled"}:
            break
        runner.tick()
        poll_count += 1
        elapsed = time.perf_counter() - polling_started
        sleep_seconds = _adaptive_graph_kie_poll_interval(elapsed)
        sleep_deadline = time.perf_counter() + sleep_seconds
        while time.perf_counter() < sleep_deadline:
            if context.is_cancel_requested():
                cancel_batch_jobs(batch["batch_id"])
                raise GraphRunCancelled(GRAPH_RUN_CANCELLED_MESSAGE)
            time.sleep(min(0.25, max(0.0, sleep_deadline - time.perf_counter())))
    context.record_node_metric(node, "kie_polling_duration_seconds", round(time.perf_counter() - polling_started, 4))
    context.record_node_metric(node, "kie_poll_count", poll_count)
    context.record_node_metric(node, "kie_poll_interval_seconds", sleep_seconds)
    current = store.get_job(job["job_id"]) or current
    if current["status"] == "cancelled" and context.is_cancel_requested():
        raise GraphRunCancelled(GRAPH_RUN_CANCELLED_MESSAGE)
    if current["status"] != "completed":
        raise ValueError(current.get("error") or f"KIE job did not complete: {current['status']}")
    assets = store.get_assets_by_job_id(current["job_id"])
    if not assets:
        raise ValueError("KIE job completed without creating an asset.")
    return completed_kie_job_outputs(node=node, job=current, assets=assets, batch_id=batch["batch_id"])


class KieModelExecutor(GraphExecutor):
    node_type = "model.kie"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        definition = registry.get_definition(node.type)
        model_key = str(definition.source.get("model_key") or "nano-banana-pro")
        seedance_model = _is_seedance_model(model_key)
        start_frame_refs = context.inputs_for(node, "start_frame")
        end_frame_refs = context.inputs_for(node, "end_frame")
        legacy_image_refs = context.inputs_for(node, "image_refs")
        legacy_video_refs = context.inputs_for(node, "video_refs")
        legacy_audio_refs = context.inputs_for(node, "audio_refs")
        reference_image_refs = context.inputs_for(node, "reference_images")
        reference_video_refs = context.inputs_for(node, "reference_videos")
        reference_audio_refs = context.inputs_for(node, "reference_audios")
        if seedance_model:
            image_inputs = [
                *[_to_media_ref(item, role="first_frame") for item in start_frame_refs],
                *[_to_media_ref(item, role="last_frame") for item in end_frame_refs],
                *[_to_media_ref(item, role="reference") for item in [*reference_image_refs, *legacy_image_refs]],
            ]
            video_inputs = [_to_media_ref(item, role="reference") for item in [*reference_video_refs, *legacy_video_refs]]
            audio_inputs = [_to_media_ref(item, role="reference") for item in [*reference_audio_refs, *legacy_audio_refs]]
            has_images = bool(image_inputs)
            has_videos = bool(video_inputs)
            has_audios = bool(audio_inputs)
        else:
            image_refs = [*start_frame_refs, *end_frame_refs, *legacy_image_refs]
            video_refs = legacy_video_refs
            audio_refs = legacy_audio_refs
            image_inputs = [_to_media_ref(item) for item in image_refs]
            video_inputs = [_to_media_ref(item) for item in video_refs]
            audio_inputs = [_to_media_ref(item) for item in audio_refs]
            has_images = bool(image_refs)
            has_videos = bool(video_refs)
            has_audios = bool(audio_refs)
        suno_model = _is_suno_model(model_key)
        custom_mode = bool(node.fields.get("custom_mode"))
        instrumental = bool(node.fields.get("instrumental"))
        if suno_model:
            prompt_field = "lyrics" if custom_mode else "song_description"
            prompt_inputs = context.inputs_for(node, prompt_field) or context.inputs_for(node, "prompt")
            prompt = str(prompt_inputs[0].value if prompt_inputs else node.fields.get(prompt_field) or node.fields.get("prompt") or "").strip()
        else:
            prompt_inputs = context.inputs_for(node, "prompt")
            prompt = str(prompt_inputs[0].value if prompt_inputs else node.fields.get("prompt") or "").strip()
        if not prompt and not (suno_model and custom_mode and instrumental):
            raise ValueError("Model node prompt is required.")
        option_keys = {field.id for field in definition.fields if field.id not in {"prompt", "song_description", "lyrics"}}
        options = {key: value for key, value in node.fields.items() if key in option_keys and value is not None and value != ""}
        output_media_type = str(definition.source.get("output_media_type") or "image")
        task_modes = [str(item) for item in (definition.source.get("task_modes") or [])]
        task_mode = _select_task_mode(
            task_modes,
            output_media_type=output_media_type,
            has_images=has_images,
            has_videos=has_videos,
            has_audios=has_audios,
            model_key=model_key,
        )
        request = ValidateRequest(
            model_key=model_key,
            task_mode=task_mode,
            prompt=prompt,
            images=image_inputs,
            videos=video_inputs,
            audios=audio_inputs,
            options=options,
            output_count=1,
        )
        return submit_and_wait_for_kie_request(node=node, context=context, request=request, model_key=model_key)


def _select_task_mode(
    task_modes: List[str],
    *,
    output_media_type: str,
    has_images: bool,
    has_videos: bool,
    has_audios: bool,
    model_key: str | None = None,
) -> str:
    available = set(task_modes)
    ordered_candidates: List[str] = []
    normalized_model_key = _normalized_model_key(model_key or "")
    if output_media_type == "video":
        if _is_seedance_model(normalized_model_key) and (has_images or has_videos or has_audios):
            ordered_candidates.append("reference_to_video")
        if has_images:
            ordered_candidates.extend(["image_to_video", "i2v"])
        if has_videos:
            ordered_candidates.extend(["video_to_video", "v2v"])
        ordered_candidates.extend(["text_to_video", "t2v"])
    elif output_media_type == "audio":
        if has_videos:
            ordered_candidates.append("video_to_audio")
        ordered_candidates.extend(["text_to_audio", "text_to_music", "music_generation"])
    else:
        if has_images:
            ordered_candidates.extend(["image_edit", "image_to_image", "i2i"])
        ordered_candidates.extend(["text_to_image", "t2i"])
    for candidate in ordered_candidates:
        if candidate in available:
            return candidate
    if task_modes:
        return task_modes[0]
    if output_media_type == "video":
        if _is_seedance_model(normalized_model_key) and (has_images or has_videos or has_audios):
            return "reference_to_video"
        return "image_to_video" if has_images else "text_to_video"
    if output_media_type == "audio":
        return "text_to_music" if "suno" in normalized_model_key or "music" in normalized_model_key else "text_to_audio"
    return "image_edit" if has_images else "text_to_image"
