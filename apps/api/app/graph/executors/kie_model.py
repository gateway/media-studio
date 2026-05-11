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
    node_type = "model.kie.nano_banana_pro"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        definition = registry.get_definition(node.type)
        model_key = str(definition.source.get("model_key") or "nano-banana-pro")
        image_refs = context.inputs_for(node, "image_refs")
        prompt = str(node.fields.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("Model node prompt is required.")
        option_keys = {field.id for field in definition.fields if field.id != "prompt"}
        options = {key: value for key, value in node.fields.items() if key in option_keys and value is not None and value != ""}
        request = ValidateRequest(
            model_key=model_key,
            task_mode="image_edit" if image_refs else "text_to_image",
            prompt=prompt,
            images=[_to_media_ref(item) for item in image_refs],
            options=options,
            output_count=1,
        )
        emit(context.run_id, "kie.validating", {"model_key": model_key}, node_id=node.id)
        service.build_validation_bundle(request)
        emit(context.run_id, "kie.submitted", {"model_key": model_key}, node_id=node.id)
        batch, jobs = service.submit_jobs(request)
        job = jobs[0]
        emit(context.run_id, "kie.polling", {"job_id": job["job_id"], "batch_id": batch["batch_id"]}, node_id=node.id)

        from ...runner import runner

        deadline = time.time() + 3600
        current = job
        while time.time() < deadline:
            current = store.get_job(job["job_id"]) or current
            if current["status"] in {"completed", "failed", "cancelled"}:
                break
            runner.tick()
            time.sleep(0.25)
        current = store.get_job(job["job_id"]) or current
        if current["status"] != "completed":
            raise ValueError(current.get("error") or f"KIE job did not complete: {current['status']}")
        asset = store.get_asset_by_job_id(current["job_id"])
        if not asset:
            raise ValueError("KIE job completed without creating an asset.")
        return {
            "image": [GraphOutputRef(kind="asset", media_type="image", asset_id=asset["asset_id"], job_id=current["job_id"])],
            "job": [GraphOutputRef(kind="job", job_id=current["job_id"], metadata={"batch_id": batch["batch_id"]})],
        }
