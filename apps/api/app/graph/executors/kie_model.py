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


def _to_media_ref(value: GraphOutputRef, *, role: Optional[str] = None) -> MediaRefInput:
    return MediaRefInput(asset_id=value.asset_id, reference_id=value.reference_id, role=role)


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
        prompt_inputs = context.inputs_for(node, "prompt")
        prompt = str(prompt_inputs[0].value if prompt_inputs else node.fields.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("Model node prompt is required.")
        option_keys = {field.id for field in definition.fields if field.id != "prompt"}
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
        asset = store.get_asset_by_job_id(current["job_id"])
        if not asset:
            raise ValueError("KIE job completed without creating an asset.")
        asset_media_type = str(asset.get("generation_kind") or output_media_type)
        output_port = "video" if asset_media_type == "video" else "audio" if asset_media_type == "audio" else "image"
        return {
            output_port: [GraphOutputRef(kind="asset", media_type=output_port, asset_id=asset["asset_id"], job_id=current["job_id"])],
            "job": [GraphOutputRef(kind="job", job_id=current["job_id"], metadata={"batch_id": batch["batch_id"]})],
        }


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
        ordered_candidates.append("text_to_audio")
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
        return "text_to_audio"
    return "image_edit" if has_images else "text_to_image"
