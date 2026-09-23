"""Read-only, session-owned generation evidence and execution-equivalent preparation."""
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field


class InspectGenerationArguments(BaseModel):
    node_id: str = Field(min_length=1, max_length=160)
    run_id: Optional[str] = Field(default=None, max_length=120)
    evidence: Literal["authored", "prepared", "submitted", "rejected"] = "prepared"
    attempt: int = Field(default=0, ge=0)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=6000, ge=1, le=12000)
    expected_workflow_fingerprint: Optional[str] = None
    refresh_balance: bool = False


def _chunk(text, options):
    if text is None:
        return {"text": None, "total_chars": None, "next_offset": None}
    end = min(len(text), options.offset + options.limit)
    return {"text": text[options.offset:end], "total_chars": len(text),
            "next_offset": end if end < len(text) else None}


def _run_evidence(options, context):
    from .. import store
    from .results import owned_run
    _, run = owned_run(str(context.session_id or ""), options.run_id)
    node = next((n for n in store.list_graph_run_nodes(options.run_id) if n["node_id"] == options.node_id), None)
    if node is None:
        raise ValueError("That node is not in the selected session-owned run.")
    metrics = node.get("metrics_json") or {}
    snapshot = node.get("input_snapshot_json") or {}
    attempts = snapshot.get("storyboard_contract_attempts") or []
    job = store.get_job(metrics["job_id"]) if metrics.get("job_id") else None
    text = None
    if options.evidence == "rejected":
        if options.attempt >= len(attempts):
            raise ValueError("No retained output exists at that attempt index; historical rejected text may be unavailable.")
        text = attempts[options.attempt].get("text")
    elif options.evidence == "authored":
        text = snapshot.get("authored_prompt")
    elif options.evidence == "prepared":
        text = snapshot.get("prepared_prompt") or (snapshot.get("prompt") if "authored_prompt" not in snapshot else None)
    elif job and job.get("provider_task_id"):
        text = job.get("final_prompt_used")
    return {
        "run_id": options.run_id, "node_id": options.node_id, "status": node.get("status"),
        "evidence": options.evidence, "prompt": _chunk(text, options),
        "error": node.get("error") or run.get("error"), "job_id": metrics.get("job_id"),
        "provider_submitted": True if job and job.get("provider_task_id") else (None if job else metrics.get("provider_submitted")),
        "submission_stage": metrics.get("submission_stage", "unknown"),
        "scheduler_attempts": job.get("scheduler_attempts") if job else None,
        "attempts": [{k: a.get(k) for k in ("stage", "attempt", "error")} for a in attempts],
        "authored_chars": metrics.get("original_prompt_chars"),
        "prepared_chars": metrics.get("prepared_prompt_chars", snapshot.get("prompt_submitted_chars")),
        "model_limit": metrics.get("model_prompt_max_chars"),
        "transformation": metrics.get("prompt_shape_strategy"),
        "note": "Historical missing evidence is unknown. A queued local job is not proof of external submission.",
    }


def _prepare_current(options, context):
    from .. import service, kie_adapter
    from ..graph.executors.base import GraphExecutionContext
    from ..graph.executors.kie_model import KieModelExecutor
    from ..graph.executors.media_load import LoadImageExecutor, LoadVideoExecutor, LoadAudioExecutor
    from ..graph.executors.prompt_ops import PromptTextExecutor
    from ..graph.normalization import materialize_workflow_defaults
    from .provenance import workflow_fingerprint

    if context.workflow is None:
        raise ValueError("Open a workflow before inspecting generation.")
    workflow = materialize_workflow_defaults(context.workflow)
    fingerprint = workflow_fingerprint(workflow)
    if options.expected_workflow_fingerprint and options.expected_workflow_fingerprint != fingerprint:
        raise ValueError("The workflow changed. Inspect the current model, options and references again.")
    nodes = {n.id: n for n in workflow.nodes}
    node = nodes.get(options.node_id)
    if node is None or not node.type.startswith("model.kie."):
        raise ValueError("Select a KIE model node in the current workflow.")
    result = {"node_id": node.id, "workflow_fingerprint": fingerprint, "provider_submitted": False,
              "account_readiness": "unknown", "inspection_grants_run_approval": False}
    mode = (node.metadata.get("execution") or {}).get("mode", "enabled")
    if mode != "enabled":
        return {**result, "status": "disabled", "execution_mode": mode,
                "note": "Zero new spend while disabled does not quote an enabled generation."}
    execution = GraphExecutionContext(run_id="", workflow=workflow)
    # Only these existing read-only executors may run. All dynamic generation is pending.
    readers = {"prompt.text": PromptTextExecutor(), "media.load_image": LoadImageExecutor(),
               "media.load_video": LoadVideoExecutor(), "media.load_audio": LoadAudioExecutor()}
    pending, visiting = set(), set()

    def resolve(node_id):
        if node_id in execution.node_outputs:
            return True
        source = nodes.get(node_id)
        if source is None or node_id in visiting:
            pending.add(node_id)
            return False
        if source.type not in readers or (source.metadata.get("execution") or {}).get("mode", "enabled") != "enabled":
            pending.add(node_id)
            return False
        visiting.add(node_id)
        ready = all([resolve(e.source) for e in workflow.edges if e.target == node_id])
        visiting.remove(node_id)
        if ready:
            execution.publish_outputs(source, readers[source.type].execute(source, execution))
        return ready

    ready = all([resolve(e.source) for e in workflow.edges if e.target == node.id])
    if not ready:
        return {**result, "status": "pending_prerequisites", "pending_node_ids": sorted(pending),
                "note": "Recipe/LLM or other dynamic outputs are not prepared. Static graph validation does not prove this pipeline executable. LLM preparation consumes tokens; no image was submitted."}
    request = KieModelExecutor().prepare_request(node, execution)
    bundle = service.build_validation_bundle(request)
    preflight = bundle.get("preflight") or {}
    final_prompt = bundle.get("final_prompt") or request.prompt
    result.update({"status": "prepared", "model_key": request.model_key, "task_mode": request.task_mode,
                   "options": request.options, "ordered_images": [i.model_dump(exclude_none=True) for i in request.images],
                   "authored_chars": execution.node_metrics[node.id].get("original_prompt_chars"),
                   "prepared_chars": len(final_prompt), "prompt_preserved": final_prompt == request.prompt,
                   "model_limit": execution.node_metrics[node.id].get("model_prompt_max_chars"),
                   "pricing": bundle.get("pricing_summary"),
                   "preflight": {k: preflight.get(k) for k in ("decision", "can_submit", "reason", "warnings")},
                   "note": "This validates the unchanged prepared request, not account funding or provider success. Current run review is still required."})
    text = execution.node_input_snapshots[node.id]["authored_prompt"] if options.evidence == "authored" else final_prompt
    if options.evidence in {"submitted", "rejected"}:
        text = None
    result["prompt"] = _chunk(text, options)
    if options.refresh_balance:
        checked_at = datetime.now(timezone.utc).isoformat()
        try:
            balance = kie_adapter.get_credit_balance()
            result["balance"] = {"available_credits": balance.get("available_credits"), "source": "KIE credit endpoint", "checked_at": checked_at,
                                 "note": "Read-only balance lookup; it does not verify this model's account funding."}
        except Exception:
            result["balance"] = {"available_credits": None, "source": "KIE credit endpoint", "checked_at": checked_at, "note": "Balance lookup unavailable; account readiness remains unknown."}
    return result


def inspect_generation(arguments, context):
    options = InspectGenerationArguments.model_validate(arguments)
    try:
        return _run_evidence(options, context) if options.run_id else _prepare_current(options, context)
    except (ValueError, HTTPException) as error:
        from .kernel_tools import KernelToolFailure
        raise KernelToolFailure(code="generation_inspection_failed", message=str(getattr(error, "detail", error)), retryable=False) from error
