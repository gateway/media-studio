from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List

from .. import store
from .artifacts import output_payload_to_refs, register_output_artifacts
from .cancellation import GRAPH_RUN_CANCELLED_MESSAGE, cancel_kie_jobs_for_run
from .compiler import compile_workflow
from .events import emit
from .execution_cache import cached_artifacts_available, cached_output_for_node, cached_output_media_available
from .normalization import materialize_workflow_defaults
from .executors.audio_ops import AudioTransformExecutor
from .executors.base import GraphExecutionContext, GraphExecutor, GraphRunCancelled
from .executors.debug_ops import DebugInspectExecutor, DebugMetadataExecutor, DisplayAnyExecutor
from .executors.image_ops import (
    ImageConvertFormatExecutor,
    ImageCropExecutor,
    ImageExtractMetadataExecutor,
    ImageGridSliceExecutor,
    ImagePadExecutor,
    ImageResizeExecutor,
    ImageSplitExecutor,
    ImageTransformExecutor,
)
from .executors.kie_model import KieModelExecutor
from .executors.media_load import LoadAudioExecutor, LoadImageExecutor, LoadVideoExecutor
from .executors.media_save import SaveAudioExecutor, SaveImageExecutor, SaveImagesExecutor, SaveVideoExecutor
from .executors.preset_ops import PresetRenderExecutor
from .executors.preview_ops import PreviewAudioExecutor, PreviewImageExecutor, PreviewVideoExecutor
from .executors.prompt_ops import PromptConcatExecutor, PromptLlmExecutor, PromptParseExecutor, PromptRecipeExecutor, PromptTextExecutor
from .executors.video_ops import (
    VideoConvertContainerExecutor,
    VideoCombineExecutor,
    VideoExtractExecutor,
    VideoExtractAudioExecutor,
    VideoExtractFramesExecutor,
    VideoPosterFrameExecutor,
    VideoResizeExecutor,
    VideoTransformExecutor,
    VideoTrimExecutor,
)
from .schemas import GraphRun, GraphRunNode, GraphWorkflow
from .validator import validate_workflow

logger = logging.getLogger(__name__)


def _aggregate_usage_metrics(node_metrics_by_id: Dict[str, Dict]) -> Dict[str, object]:
    usage_event_ids: List[str] = []
    provider_response_ids: List[str] = []
    total_cost_usd = 0.0
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0
    reasoning_tokens = 0
    cached_tokens = 0
    cache_write_tokens = 0
    for metrics in node_metrics_by_id.values():
        total_cost_usd += float(metrics.get("actual_cost_usd") or 0.0)
        prompt_tokens += int(metrics.get("prompt_tokens") or 0)
        completion_tokens += int(metrics.get("completion_tokens") or 0)
        total_tokens += int(metrics.get("total_tokens") or 0)
        reasoning_tokens += int(metrics.get("reasoning_tokens") or 0)
        cached_tokens += int(metrics.get("cached_tokens") or 0)
        cache_write_tokens += int(metrics.get("cache_write_tokens") or 0)
        for event_id in metrics.get("usage_event_ids") or []:
            clean = str(event_id or "").strip()
            if clean and clean not in usage_event_ids:
                usage_event_ids.append(clean)
        for response_id in metrics.get("provider_response_ids") or []:
            clean = str(response_id or "").strip()
            if clean and clean not in provider_response_ids:
                provider_response_ids.append(clean)
    return {
        "actual_cost_usd": round(total_cost_usd, 8),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "reasoning_tokens": reasoning_tokens,
        "cached_tokens": cached_tokens,
        "cache_write_tokens": cache_write_tokens,
        "usage_event_ids": usage_event_ids,
        "provider_response_ids": provider_response_ids,
    }


def _node_execution_mode(node) -> str:
    execution = node.metadata.get("execution") if isinstance(node.metadata.get("execution"), dict) else {}
    mode = str(execution.get("mode") or "enabled")
    return mode if mode in {"enabled", "frozen", "bypassed", "muted"} else "enabled"


def _output_asset_ids(outputs: Dict[str, List]) -> List[str]:
    asset_ids: List[str] = []
    for refs in outputs.values():
        for ref in refs:
            asset_id = getattr(ref, "asset_id", None)
            if asset_id and asset_id not in asset_ids:
                asset_ids.append(str(asset_id))
    return asset_ids


def _bypass_outputs(node, context: GraphExecutionContext, execution: Dict) -> Dict[str, List]:
    bypass_mode = execution.get("bypass_mode") if isinstance(execution.get("bypass_mode"), dict) else {}
    input_port = str(bypass_mode.get("input") or "")
    output_port = str(bypass_mode.get("output") or "")
    if not input_port or not output_port:
        raise ValueError(f"Node {node.id} does not support bypass.")
    inputs = context.inputs_for(node, input_port)
    if not inputs:
        raise ValueError(f"Bypassed node {node.id} has no input to pass through.")
    return {output_port: inputs}


class GraphRuntime:
    def __init__(self) -> None:
        executors: List[GraphExecutor] = [
            PromptTextExecutor(),
            PromptConcatExecutor(),
            PromptLlmExecutor(),
            PromptRecipeExecutor(),
            PromptParseExecutor(),
            LoadImageExecutor(),
            LoadVideoExecutor(),
            LoadAudioExecutor(),
            AudioTransformExecutor(),
            ImageTransformExecutor(),
            ImageResizeExecutor(),
            ImageGridSliceExecutor(),
            ImageSplitExecutor(),
            ImageCropExecutor(),
            ImagePadExecutor(),
            ImageConvertFormatExecutor(),
            ImageExtractMetadataExecutor(),
            VideoTransformExecutor(),
            VideoCombineExecutor(),
            VideoResizeExecutor(),
            VideoTrimExecutor(),
            VideoExtractFramesExecutor(),
            VideoExtractAudioExecutor(),
            VideoExtractExecutor(),
            VideoPosterFrameExecutor(),
            VideoConvertContainerExecutor(),
            PresetRenderExecutor(),
            PreviewImageExecutor(),
            PreviewVideoExecutor(),
            PreviewAudioExecutor(),
            DisplayAnyExecutor(),
            DebugInspectExecutor(),
            DebugMetadataExecutor(),
            KieModelExecutor(),
            SaveImageExecutor(),
            SaveImagesExecutor(),
            SaveVideoExecutor(),
            SaveAudioExecutor(),
        ]
        self.executors: Dict[str, GraphExecutor] = {executor.node_type: executor for executor in executors}

    def create_run(self, workflow_id: str, workflow: GraphWorkflow, *, start: bool = True) -> GraphRun:
        workflow = materialize_workflow_defaults(workflow.model_copy(update={"workflow_id": workflow_id}))
        emit_payload = workflow.model_dump(mode="json")
        compiled = compile_workflow(workflow)
        run = store.create_graph_run(
            {
                "workflow_id": workflow_id,
                "status": "queued",
                "schema_version": workflow.schema_version,
                "workflow_json": emit_payload,
                "compiled_graph_json": compiled.model_dump(mode="json"),
                "metrics_json": {
                    "node_count": len(workflow.nodes),
                    "edge_count": len(workflow.edges),
                    "queued_node_count": len(workflow.nodes),
                },
            },
            [
                {
                    "node_id": node.id,
                    "node_type": node.type,
                    "status": "queued",
                    "input_snapshot_json": node.fields,
                }
                for node in workflow.nodes
            ],
        )
        emit(run["run_id"], "run.created", {"workflow_id": workflow_id})
        if start:
            thread = threading.Thread(target=self.execute_run, args=(run["run_id"],), name=f"graph-run-{run['run_id']}", daemon=True)
            thread.start()
        return self._shape_run(run)

    def execute_run(self, run_id: str) -> None:
        run = store.get_graph_run(run_id)
        if not run:
            return
        try:
            run_started_monotonic = time.perf_counter()
            workflow = materialize_workflow_defaults(GraphWorkflow(**run["workflow_json"]))
            emit(run_id, "run.validating")
            validation = validate_workflow(workflow)
            if not validation.valid:
                raise ValueError("; ".join(error.message for error in validation.errors))
            compiled = compile_workflow(workflow)
            store.update_graph_run(run_id, {"status": "running", "started_at": store.utcnow_iso(), "compiled_graph_json": compiled.model_dump(mode="json")})
            emit(run_id, "run.compiled", {"node_count": len(workflow.nodes), "edge_count": len(workflow.edges)})
            emit(run_id, "run.started")
            context = GraphExecutionContext(run_id=run_id, workflow=workflow)
            nodes_by_id = {node.id: node for node in workflow.nodes}
            active_node_id = None
            node_metrics_by_id: Dict[str, Dict] = {}
            for node_id in compiled.execution_order:
                context.raise_if_cancel_requested()
                node = nodes_by_id[node_id]
                active_node_id = node.id
                execution_mode = _node_execution_mode(node)
                definition = compiled.node_definitions.get(node.type)
                if execution_mode == "muted":
                    context.publish_outputs(node, {})
                    node_metrics = {"execution_mode": "muted", "output_ref_count": 0}
                    node_metrics_by_id[node.id] = node_metrics
                    store.update_graph_run_node(
                        run_id,
                        node.id,
                        {
                            "status": "skipped",
                            "progress": 1,
                            "output_snapshot_json": {},
                            "metrics_json": node_metrics,
                            "finished_at": store.utcnow_iso(),
                        },
                    )
                    emit(run_id, "node.skipped", {"execution_mode": "muted"}, node_id=node.id)
                    active_node_id = None
                    continue
                if execution_mode == "frozen":
                    cached = cached_output_for_node(str(run["workflow_id"]), node)
                    if not cached:
                        context.publish_outputs(node, {})
                        node_metrics = {"execution_mode": "frozen", "cached": False, "output_ref_count": 0, "skip_reason": "missing_cached_output"}
                        node_metrics_by_id[node.id] = node_metrics
                        store.update_graph_run_node(
                            run_id,
                            node.id,
                            {
                                "status": "skipped",
                                "progress": 1,
                                "output_snapshot_json": {},
                                "metrics_json": node_metrics,
                                "finished_at": store.utcnow_iso(),
                            },
                        )
                        emit(run_id, "node.skipped", {"execution_mode": "frozen", "reason": "missing_cached_output", "metrics": node_metrics}, node_id=node.id)
                        active_node_id = None
                        continue
                    cached_run_id = str(cached.get("run_id") or "")
                    if not cached_artifacts_available(node, cached_run_id):
                        raise ValueError(f"Frozen node {node.id} references cached artifacts that no longer exist.")
                    if not cached_output_media_available(cached.get("output_snapshot_json") or {}):
                        raise ValueError(f"Frozen node {node.id} references cached media that no longer exists.")
                    outputs = output_payload_to_refs(cached.get("output_snapshot_json") or {})
                    context.publish_outputs(node, outputs)
                    output_payload = {key: [item.model_dump(mode="json") for item in value] for key, value in outputs.items()}
                    node_metrics = {
                        "execution_mode": "frozen",
                        "cached": True,
                        "cached_run_id": cached_run_id,
                        "output_ref_count": sum(len(value) for value in outputs.values()),
                    }
                    node_metrics_by_id[node.id] = node_metrics
                    store.update_graph_run_node(
                        run_id,
                        node.id,
                        {
                            "status": "cached",
                            "progress": 1,
                            "output_snapshot_json": output_payload,
                            "metrics_json": node_metrics,
                            "finished_at": store.utcnow_iso(),
                        },
                    )
                    emit(run_id, "node.cached", {**output_payload, "metrics": node_metrics}, node_id=node.id)
                    active_node_id = None
                    continue
                if execution_mode == "bypassed":
                    outputs = _bypass_outputs(node, context, definition.execution if definition else {})
                    context.publish_outputs(node, outputs)
                    output_payload = {key: [item.model_dump(mode="json") for item in value] for key, value in outputs.items()}
                    node_metrics = {
                        "execution_mode": "bypassed",
                        "output_ref_count": sum(len(value) for value in outputs.values()),
                    }
                    node_metrics_by_id[node.id] = node_metrics
                    store.update_graph_run_node(
                        run_id,
                        node.id,
                        {
                            "status": "bypassed",
                            "progress": 1,
                            "output_snapshot_json": output_payload,
                            "metrics_json": node_metrics,
                            "finished_at": store.utcnow_iso(),
                        },
                    )
                    emit(run_id, "node.bypassed", {**output_payload, "metrics": node_metrics}, node_id=node.id)
                    active_node_id = None
                    continue
                executor = self.executors.get(node.type)
                if not executor and node.type.startswith("model.kie."):
                    executor = self.executors.get("model.kie")
                if not executor and node.type.startswith("preset.render."):
                    executor = self.executors.get("preset.render")
                if not executor and node.type.startswith("prompt.recipe."):
                    executor = self.executors.get("prompt.recipe")
                if not executor:
                    raise ValueError(f"No executor for node type: {node.type}")
                emit(run_id, "node.queued", node_id=node.id)
                node_started_monotonic = time.perf_counter()
                store.update_graph_run_node(run_id, node.id, {"status": "running", "started_at": store.utcnow_iso(), "progress": 0.1})
                emit(run_id, "node.started", {"node_type": node.type}, node_id=node.id)
                input_refs = context.all_inputs_for(node)
                outputs = executor.execute(node, context)
                node_duration = round(time.perf_counter() - node_started_monotonic, 4)
                outputs = register_output_artifacts(
                    workflow_id=str(run["workflow_id"]),
                    run_id=run_id,
                    node=node,
                    outputs=outputs,
                    input_refs=input_refs,
                )
                context.publish_outputs(node, outputs)
                output_payload = {key: [item.model_dump(mode="json") for item in value] for key, value in outputs.items()}
                node_metrics = {
                    **context.node_metrics.get(node.id, {}),
                    "duration_seconds": node_duration,
                    "output_asset_ids": _output_asset_ids(outputs),
                    "output_ref_count": sum(len(value) for value in outputs.values()),
                }
                node_metrics_by_id[node.id] = node_metrics
                store.update_graph_run_node(
                    run_id,
                    node.id,
                    {
                        "status": "completed",
                        "progress": 1,
                        "output_snapshot_json": output_payload,
                        "metrics_json": node_metrics,
                        "finished_at": store.utcnow_iso(),
                    },
                )
                emit(run_id, "node.completed", {**output_payload, "metrics": node_metrics}, node_id=node.id)
                active_node_id = None
                context.raise_if_cancel_requested()
            output_snapshot = {
                node_id: {port: [item.model_dump(mode="json") for item in refs] for port, refs in outputs.items()}
                for node_id, outputs in context.node_outputs.items()
            }
            store.update_graph_run(
                run_id,
                {
                    "status": "completed",
                    "output_snapshot_json": output_snapshot,
                    "metrics_json": {
                        "duration_seconds": round(time.perf_counter() - run_started_monotonic, 4),
                        "node_count": len(workflow.nodes),
                        "edge_count": len(workflow.edges),
                        "completed_node_count": len(node_metrics_by_id),
                        "failed_node_count": 0,
                        "node_metrics": node_metrics_by_id,
                        "output_asset_ids": sorted({asset_id for metrics in node_metrics_by_id.values() for asset_id in metrics.get("output_asset_ids", [])}),
                        **_aggregate_usage_metrics(node_metrics_by_id),
                    },
                    "finished_at": store.utcnow_iso(),
                },
            )
            completed_run = store.get_graph_run(run_id) or {}
            emit(run_id, "run.completed", {"outputs": output_snapshot, "metrics": completed_run.get("metrics_json", {})})
        except GraphRunCancelled:
            logger.info("graph run cancelled", extra={"run_id": run_id})
            self._finalize_cancelled_run(
                run_id,
                context if "context" in locals() else None,
                node_metrics_by_id if "node_metrics_by_id" in locals() else {},
                run_started_monotonic if "run_started_monotonic" in locals() else None,
                active_node_id if "active_node_id" in locals() else None,
                node_started_monotonic if "node_started_monotonic" in locals() else None,
            )
        except Exception as exc:
            logger.exception("graph run failed", extra={"run_id": run_id})
            failed_metrics = {
                "duration_seconds": round(time.perf_counter() - run_started_monotonic, 4) if "run_started_monotonic" in locals() else None,
                "failed_node_id": active_node_id if "active_node_id" in locals() else None,
                "error": str(exc),
                **_aggregate_usage_metrics(context.node_metrics if "context" in locals() else {}),
            }
            if "active_node_id" in locals() and active_node_id:
                store.update_graph_run_node(
                    run_id,
                    active_node_id,
                    {
                        "status": "failed",
                        "progress": 1,
                        "error": str(exc),
                        "metrics_json": {
                            **(context.node_metrics.get(active_node_id, {}) if "context" in locals() else {}),
                            "duration_seconds": round(time.perf_counter() - node_started_monotonic, 4) if "node_started_monotonic" in locals() else None,
                            "error": str(exc),
                        },
                        "finished_at": store.utcnow_iso(),
                    },
                )
                emit(run_id, "node.failed", {"error": str(exc)}, node_id=active_node_id)
            store.update_graph_run(run_id, {"status": "failed", "error": str(exc), "metrics_json": failed_metrics, "finished_at": store.utcnow_iso()})
            emit(run_id, "run.failed", {"error": str(exc), "metrics": failed_metrics})

    def cancel_run(self, run_id: str) -> GraphRun:
        current = store.get_graph_run(run_id)
        if not current:
            raise KeyError("graph run not found")
        current_status = str(current.get("status") or "").strip()
        if current_status in {"completed", "failed", "cancelled"}:
            return self._shape_run(current)
        run = store.update_graph_run(run_id, {"status": "cancelling"})
        cancel_result = cancel_kie_jobs_for_run(run_id)
        emit(run_id, "run.cancelling", cancel_result)
        if current_status == "queued":
            self._finalize_cancelled_run(run_id, None, {}, None, None, None)
            return self._shape_run(store.get_graph_run(run_id) or run)
        return self._shape_run(run)

    def _finalize_cancelled_run(
        self,
        run_id: str,
        context: GraphExecutionContext | None,
        node_metrics_by_id: Dict[str, Dict],
        run_started_monotonic: float | None,
        active_node_id: str | None,
        node_started_monotonic: float | None,
    ) -> None:
        cancel_result = cancel_kie_jobs_for_run(run_id)
        for event in store.list_graph_run_events(run_id):
            if str(event.get("event_type") or "").strip() != "run.cancelling":
                continue
            payload = event.get("payload_json") or {}
            for batch_id in payload.get("batch_ids") or []:
                clean = str(batch_id or "").strip()
                if clean and clean not in (cancel_result.get("batch_ids") or []):
                    cancel_result.setdefault("batch_ids", []).append(clean)
            for job_id in payload.get("job_ids") or []:
                clean = str(job_id or "").strip()
                if clean and clean not in (cancel_result.get("job_ids") or []):
                    cancel_result.setdefault("job_ids", []).append(clean)
        cancelled_node_ids: List[str] = []
        for run_node in store.list_graph_run_nodes(run_id):
            status = str(run_node.get("status") or "").strip()
            if status not in {"queued", "running"}:
                continue
            metrics = dict(run_node.get("metrics_json") or {})
            if context:
                metrics.update(context.node_metrics.get(str(run_node.get("node_id") or ""), {}))
            if active_node_id and str(run_node.get("node_id") or "") == active_node_id and node_started_monotonic is not None:
                metrics["duration_seconds"] = round(time.perf_counter() - node_started_monotonic, 4)
            store.update_graph_run_node(
                run_id,
                str(run_node["node_id"]),
                {
                    "status": "cancelled",
                    "progress": 1,
                    "metrics_json": metrics,
                    "finished_at": store.utcnow_iso(),
                },
            )
            cancelled_node_ids.append(str(run_node["node_id"]))
        if active_node_id and active_node_id in cancelled_node_ids:
            emit(run_id, "node.cancelled", {"message": GRAPH_RUN_CANCELLED_MESSAGE}, node_id=active_node_id)
        cancelled_metrics = {
            "duration_seconds": round(time.perf_counter() - run_started_monotonic, 4) if run_started_monotonic is not None else None,
            "completed_node_count": len(node_metrics_by_id),
            "cancelled_node_count": len(cancelled_node_ids),
            "cancelled_node_ids": cancelled_node_ids,
            "node_metrics": node_metrics_by_id,
            "output_asset_ids": sorted({asset_id for metrics in node_metrics_by_id.values() for asset_id in metrics.get("output_asset_ids", [])}),
            "cancelled_jobs": cancel_result.get("job_ids") or [],
            "cancelled_batches": cancel_result.get("batch_ids") or [],
            **_aggregate_usage_metrics(context.node_metrics if context else {}),
        }
        store.update_graph_run(
            run_id,
            {
                "status": "cancelled",
                "error": None,
                "metrics_json": cancelled_metrics,
                "finished_at": store.utcnow_iso(),
            },
        )
        emit(run_id, "run.cancelled", {"metrics": cancelled_metrics, **cancel_result})

    def _shape_run(self, record: Dict) -> GraphRun:
        return GraphRun(
            **record,
            nodes=[GraphRunNode(**item) for item in store.list_graph_run_nodes(record["run_id"])],
        )


runtime = GraphRuntime()
