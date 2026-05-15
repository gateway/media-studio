from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List

from .. import store
from .artifacts import output_payload_to_refs, register_output_artifacts
from .compiler import compile_workflow
from .events import emit
from .execution_cache import cached_artifacts_available, cached_output_for_node, cached_output_media_available
from .executors.audio_ops import AudioTransformExecutor
from .executors.base import GraphExecutionContext, GraphExecutor
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
from .executors.prompt_ops import PromptConcatExecutor, PromptLlmExecutor, PromptTextExecutor
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
        workflow = workflow.model_copy(update={"workflow_id": workflow_id})
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
            workflow = GraphWorkflow(**run["workflow_json"])
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
                    },
                    "finished_at": store.utcnow_iso(),
                },
            )
            completed_run = store.get_graph_run(run_id) or {}
            emit(run_id, "run.completed", {"outputs": output_snapshot, "metrics": completed_run.get("metrics_json", {})})
        except Exception as exc:
            logger.exception("graph run failed", extra={"run_id": run_id})
            failed_metrics = {
                "duration_seconds": round(time.perf_counter() - run_started_monotonic, 4) if "run_started_monotonic" in locals() else None,
                "failed_node_id": active_node_id if "active_node_id" in locals() else None,
                "error": str(exc),
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
        run = store.update_graph_run(run_id, {"status": "cancelled", "finished_at": store.utcnow_iso()})
        emit(run_id, "run.cancelled")
        return self._shape_run(run)

    def _shape_run(self, record: Dict) -> GraphRun:
        return GraphRun(
            **record,
            nodes=[GraphRunNode(**item) for item in store.list_graph_run_nodes(record["run_id"])],
        )


runtime = GraphRuntime()
