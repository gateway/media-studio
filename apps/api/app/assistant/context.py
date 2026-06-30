from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from .. import store
from ..graph.registry import registry
from ..graph.schemas import GraphNodeDefinition, GraphWorkflow
from ..graph.validator import validate_workflow
from .canvas_context import compact_canvas_context
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT, is_image_attachment
from .skills import assistant_skill_catalog


SENSITIVE_KEY_PARTS = ("api", "key", "secret", "token", "password", "authorization", "cookie")


def _redact_value(key: str, value: Any) -> Any:
    normalized_key = key.lower().replace("-", "_")
    if any(part in normalized_key for part in SENSITIVE_KEY_PARTS):
        return "[redacted]"
    if isinstance(value, dict):
        return {str(child_key): _redact_value(str(child_key), child_value) for child_key, child_value in value.items()}
    if isinstance(value, list):
        return [_redact_value(key, item) for item in value[:20]]
    if isinstance(value, str) and ("/Users/" in value or "\\Users\\" in value):
        return "[local-path-redacted]"
    return value


def redact_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {key: _redact_value(key, value) for key, value in payload.items()}


def _field_summary(definition: GraphNodeDefinition) -> List[Dict[str, Any]]:
    return [
        {
            "id": field.id,
            "label": field.label,
            "type": field.type,
            "required": field.required,
            "options": field.options[:20] if isinstance(field.options, list) else [],
        }
        for field in definition.fields
        if not field.hidden
    ]


def _port_summary(definition: GraphNodeDefinition, direction: str) -> List[Dict[str, Any]]:
    return [
        {
            "id": port.id,
            "label": port.label,
            "type": port.type,
            "array": port.array,
            "required": port.required,
            "accepts": port.accepts,
        }
        for port in definition.ports.get(direction, [])
        if not port.advanced
    ]


def build_node_catalog_summary(definitions: Iterable[GraphNodeDefinition] | None = None) -> List[Dict[str, Any]]:
    items = definitions if definitions is not None else registry.list_definitions()
    return [
        {
            "type": item.type,
            "title": item.title,
            "category": item.category,
            "description": item.description,
            "inputs": _port_summary(item, "inputs"),
            "outputs": _port_summary(item, "outputs"),
            "fields": _field_summary(item),
        }
        for item in items
        if not item.source.get("hidden")
    ]


def build_workflow_summary(workflow: GraphWorkflow) -> Dict[str, Any]:
    validation = validate_workflow(workflow)
    return {
        "workflow_id": workflow.workflow_id,
        "name": workflow.name,
        "node_count": len(workflow.nodes),
        "edge_count": len(workflow.edges),
        "nodes": [
            {
                "id": node.id,
                "type": node.type,
                "title": node.metadata.get("ui", {}).get("customTitle") if isinstance(node.metadata.get("ui"), dict) else None,
                "field_ids": sorted(str(key) for key in node.fields.keys()),
            }
            for node in workflow.nodes
        ],
        "edges": [
            {
                "source": edge.source,
                "source_port": edge.source_port,
                "target": edge.target,
                "target_port": edge.target_port,
            }
            for edge in workflow.edges
        ],
        "validation": {
            "valid": validation.valid,
            "errors": [error.model_dump(mode="json") for error in validation.errors[:10]],
            "warnings": [warning.model_dump(mode="json") for warning in validation.warnings[:10]],
        },
    }


def build_preset_catalog_summary(limit: int = 40) -> List[Dict[str, Any]]:
    return [
        {
            "preset_id": str(item.get("preset_id") or ""),
            "key": str(item.get("key") or ""),
            "label": str(item.get("label") or item.get("key") or ""),
            "model_key": item.get("model_key"),
            "applies_to_models": item.get("applies_to_models_json") if isinstance(item.get("applies_to_models_json"), list) else [],
            "text_fields": item.get("input_schema_json") if isinstance(item.get("input_schema_json"), list) else [],
            "media_slots": item.get("input_slots_json") if isinstance(item.get("input_slots_json"), list) else [],
        }
        for item in store.list_presets()[:limit]
        if str(item.get("status") or "active") == "active"
    ]


def build_prompt_recipe_catalog_summary(limit: int = 40) -> List[Dict[str, Any]]:
    return [
        {
            "recipe_id": str(item.get("recipe_id") or ""),
            "key": str(item.get("key") or ""),
            "label": str(item.get("label") or item.get("key") or ""),
            "category": item.get("category"),
            "image_mode": item.get("image_input_mode"),
            "variables": item.get("variables_json") if isinstance(item.get("variables_json"), list) else [],
            "custom_fields": item.get("custom_fields_json") if isinstance(item.get("custom_fields_json"), list) else [],
        }
        for item in store.list_prompt_recipes(status="active")[:limit]
    ]


def build_attachment_summary(attachments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    summary = []
    image_count = 0
    for attachment in attachments:
        if is_image_attachment(attachment):
            if image_count >= ASSISTANT_IMAGE_ATTACHMENT_LIMIT:
                continue
            image_count += 1
        reference = store.get_reference_media(str(attachment.get("reference_id") or ""))
        summary.append(
            {
                "assistant_attachment_id": attachment.get("assistant_attachment_id"),
                "reference_id": attachment.get("reference_id"),
                "kind": attachment.get("kind") or (reference or {}).get("kind"),
                "label": attachment.get("label") or (reference or {}).get("original_filename"),
                "mime_type": (reference or {}).get("mime_type"),
                "width": (reference or {}).get("width"),
                "height": (reference or {}).get("height"),
                "duration_seconds": (reference or {}).get("duration_seconds"),
            }
        )
    return summary


def build_latest_run_summary(run_id: Optional[str]) -> Dict[str, Any] | None:
    resolved_run_id = str(run_id or "").strip()
    if not resolved_run_id:
        return None
    run = store.get_graph_run(resolved_run_id)
    if not run:
        return None
    artifacts = []
    for artifact in store.list_graph_artifacts_for_run(resolved_run_id)[:12]:
        asset = store.get_asset(str(artifact.get("asset_id") or "")) if artifact.get("asset_id") else None
        artifacts.append(
            {
                "artifact_id": artifact.get("artifact_id"),
                "node_id": artifact.get("node_id"),
                "node_type": artifact.get("node_type"),
                "output_port": artifact.get("output_port"),
                "kind": artifact.get("kind"),
                "media_type": artifact.get("media_type"),
                "asset_id": artifact.get("asset_id"),
                "reference_id": artifact.get("reference_id"),
                "job_id": artifact.get("job_id"),
                "prompt_summary": (asset or {}).get("prompt_summary"),
                "model_key": (asset or {}).get("model_key"),
            }
        )
    return {
        "run_id": run.get("run_id"),
        "workflow_id": run.get("workflow_id"),
        "status": run.get("status"),
        "error": run.get("error"),
        "metrics": run.get("metrics_json") if isinstance(run.get("metrics_json"), dict) else {},
        "artifacts": artifacts,
    }


def build_assistant_context(
    workflow: GraphWorkflow | None,
    attachments: List[Dict[str, Any]],
    run_id: Optional[str] = None,
    canvas_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "node_catalog": build_node_catalog_summary(),
        "media_presets": build_preset_catalog_summary(),
        "prompt_recipes": build_prompt_recipe_catalog_summary(),
        "attachments": build_attachment_summary(attachments),
        "provider_readiness": {
            "preferred": "codex_local",
            "fallbacks": ["openrouter", "local_openai"],
        },
        "assistant_limits": {
            "max_image_references": ASSISTANT_IMAGE_ATTACHMENT_LIMIT,
        },
        "assistant_skills": assistant_skill_catalog(),
    }
    if workflow is not None:
        payload["workflow"] = build_workflow_summary(workflow)
    compact_canvas = compact_canvas_context(canvas_context)
    if compact_canvas:
        payload["canvas_context"] = compact_canvas
    latest_run = build_latest_run_summary(run_id)
    if latest_run:
        payload["latest_graph_run"] = latest_run
    return redact_context(payload)
