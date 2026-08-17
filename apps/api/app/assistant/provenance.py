from __future__ import annotations

import hashlib
import json
from typing import Any, Dict

from ..graph.normalization import materialize_workflow_defaults
from ..graph.schemas import GraphWorkflow
from ..schemas import PresetUpsertRequest


_PRESET_QUALITY_CONTRACT_KEYS = (
    "model_key",
    "applies_to_models",
    "applies_to_task_modes",
    "applies_to_input_patterns",
    "prompt_template",
    "system_prompt_ids",
    "requires_image",
    "input_schema_json",
    "input_slots_json",
    "default_options_json",
    "rules_json",
)


def _execution_workflow_payload(workflow: GraphWorkflow) -> Dict[str, Any]:
    nodes = []
    for node in workflow.nodes:
        metadata = node.metadata if isinstance(node.metadata, dict) else {}
        execution = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
        nodes.append(
            {
                "id": node.id,
                "type": node.type,
                "fields": node.fields,
                "execution": {
                    "mode": str(execution.get("mode") or "enabled"),
                    "cached_run_id": execution.get("cached_run_id") or None,
                    "cached_artifact_ids": execution.get("cached_artifact_ids") or {},
                },
            }
        )
    return {
        "nodes": sorted(nodes, key=lambda item: item["id"]),
        "edges": sorted(
            [
                {
                    "source": edge.source,
                    "source_port": edge.source_port,
                    "target": edge.target,
                    "target_port": edge.target_port,
                }
                for edge in workflow.edges
            ],
            key=lambda item: (
                item["source"],
                item["source_port"],
                item["target"],
                item["target_port"],
            ),
        ),
    }


def _workflow_validation_payload(workflow: GraphWorkflow) -> Dict[str, Any]:
    metadata = workflow.metadata if isinstance(workflow.metadata, dict) else {}
    assistant_plan = metadata.get("assistant_plan") if isinstance(metadata.get("assistant_plan"), dict) else {}
    quality_gate = {
        key: assistant_plan.get(key)
        for key in (
            "template_id",
            "prompt_quality_gate_required",
            "prompt_quality_passed",
            "prompt_quality_prompt_hash",
        )
        if key in assistant_plan
    }
    prompt_titles = {}
    if quality_gate.get("prompt_quality_gate_required"):
        for node in workflow.nodes:
            if node.type != "prompt.text":
                continue
            ui = node.metadata.get("ui") if isinstance(node.metadata.get("ui"), dict) else {}
            prompt_titles[node.id] = str(ui.get("customTitle") or "")
    return {"assistant_plan": quality_gate, "prompt_titles": prompt_titles}


def workflow_fingerprint(workflow: GraphWorkflow) -> str:
    normalized = materialize_workflow_defaults(workflow)
    metadata = normalized.metadata if isinstance(normalized.metadata, dict) else {}
    payload = {
        "workflow_id": normalized.workflow_id or str(metadata.get("workflow_id") or ""),
        **_execution_workflow_payload(normalized),
        "validation": _workflow_validation_payload(normalized),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def preset_test_workflow_fingerprint(workflow: GraphWorkflow) -> str:
    payload = _execution_workflow_payload(materialize_workflow_defaults(workflow))
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def recipe_plan_workflow_fingerprint(workflow: GraphWorkflow) -> str:
    comparable = materialize_workflow_defaults(workflow).model_copy(deep=True)
    for node in comparable.nodes:
        execution = (
            node.metadata.get("execution")
            if isinstance(node.metadata.get("execution"), dict)
            else {}
        )
        node.metadata["execution"] = {
            "mode": str(execution.get("mode") or "enabled")
        }
    return preset_test_workflow_fingerprint(comparable)


def preset_quality_contract_hash(draft: Dict[str, Any]) -> str:
    normalized = PresetUpsertRequest.model_validate(draft).model_dump(mode="json")
    contract = {key: normalized.get(key) for key in _PRESET_QUALITY_CONTRACT_KEYS}
    canonical = json.dumps(contract, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
