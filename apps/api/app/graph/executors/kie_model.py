from __future__ import annotations

import time
from typing import Dict, List

from ... import service, store
from ...schemas import MediaRefInput, ValidateRequest
from ..events import emit
from ..registry import registry
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


def _to_media_ref(value: GraphOutputRef) -> MediaRefInput:
    return MediaRefInput(asset_id=value.asset_id, reference_id=value.reference_id)


class KieModelExecutor(GraphExecutor):
    node_type = "model.kie"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        definition = registry.get_definition(node.type)
        model_key = str(definition.source.get("model_key") or "nano-banana-pro")
        image_refs = [
            *context.inputs_for(node, "start_frame"),
            *context.inputs_for(node, "end_frame"),
            *context.inputs_for(node, "image_refs"),
        ]
        video_refs = context.inputs_for(node, "video_refs")
        audio_refs = context.inputs_for(node, "audio_refs")
        prompt_inputs = context.inputs_for(node, "prompt")
        prompt = str(prompt_inputs[0].value if prompt_inputs else node.fields.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("Model node prompt is required.")
        option_keys = {field.id for field in definition.fields if field.id != "prompt"}
        options = {key: value for key, value in node.fields.items() if key in option_keys and value is not None and value != ""}
        output_media_type = str(definition.source.get("output_media_type") or "image")
        task_modes = [str(item) for item in (definition.source.get("task_modes") or [])]
        task_mode = _select_task_mode(task_modes, output_media_type=output_media_type, has_images=bool(image_refs), has_videos=bool(video_refs), has_audios=bool(audio_refs))
        request = ValidateRequest(
            model_key=model_key,
            task_mode=task_mode,
            prompt=prompt,
            images=[_to_media_ref(item) for item in image_refs],
            videos=[_to_media_ref(item) for item in video_refs],
            audios=[_to_media_ref(item) for item in audio_refs],
            options=options,
            output_count=1,
        )
        emit(context.run_id, "kie.validating", {"model_key": model_key}, node_id=node.id)
        validation_started = time.perf_counter()
        service.build_validation_bundle(request)
        context.record_node_metric(node, "kie_validation_duration_seconds", round(time.perf_counter() - validation_started, 4))
        emit(context.run_id, "kie.submitted", {"model_key": model_key}, node_id=node.id)
        submit_started = time.perf_counter()
        batch, jobs = service.submit_jobs(request)
        context.record_node_metric(node, "kie_submit_duration_seconds", round(time.perf_counter() - submit_started, 4))
        job = jobs[0]
        emit(context.run_id, "kie.polling", {"job_id": job["job_id"], "batch_id": batch["batch_id"]}, node_id=node.id)

        from ...runner import runner

        deadline = time.time() + 3600
        polling_started = time.perf_counter()
        current = job
        poll_count = 0
        while time.time() < deadline:
            current = store.get_job(job["job_id"]) or current
            if current["status"] in {"completed", "failed", "cancelled"}:
                break
            runner.tick()
            poll_count += 1
            time.sleep(0.25)
        context.record_node_metric(node, "kie_polling_duration_seconds", round(time.perf_counter() - polling_started, 4))
        context.record_node_metric(node, "kie_poll_count", poll_count)
        current = store.get_job(job["job_id"]) or current
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


def _select_task_mode(task_modes: List[str], *, output_media_type: str, has_images: bool, has_videos: bool, has_audios: bool) -> str:
    available = set(task_modes)
    ordered_candidates: List[str] = []
    if output_media_type == "video":
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
        return "image_to_video" if has_images else "text_to_video"
    if output_media_type == "audio":
        return "text_to_audio"
    return "image_edit" if has_images else "text_to_image"
