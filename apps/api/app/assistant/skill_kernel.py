from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal


RuntimeSkillId = Literal[
    "media_preset_builder",
    "prompt_recipe_builder",
    "graph_workflow_builder",
    "run_debugger",
    "general_helper",
]


@dataclass(frozen=True)
class AssistantSkillManifest:
    skill_id: RuntimeSkillId
    legacy_skill_id: str
    label: str
    prompt_asset: str
    prompt_asset_version: str
    required_context: List[str] = field(default_factory=list)
    allowed_operations: List[str] = field(default_factory=list)
    output_schema: str = "AssistantMessage"
    response_policy: str = "compact_user_chat_v1"


PROMPT_ASSET_VERSION = "2026-06-03"


KERNEL_SKILLS: Dict[RuntimeSkillId, AssistantSkillManifest] = {
    "media_preset_builder": AssistantSkillManifest(
        skill_id="media_preset_builder",
        legacy_skill_id="create_media_preset",
        label="Media Preset Builder",
        prompt_asset="apps/api/app/assistant/prompts/skills/media_preset_builder.md",
        prompt_asset_version=PROMPT_ASSET_VERSION,
        required_context=["attachments", "assistant_session", "workflow", "latest_run", "media_presets"],
        allowed_operations=[
            "ask_clarifying_question",
            "create_test_workflow",
            "update_test_prompt",
            "run_workflow",
            "compare_output",
            "save_media_preset",
            "test_saved_preset",
        ],
        output_schema="MediaPresetBuilderSkillOutput",
    ),
    "prompt_recipe_builder": AssistantSkillManifest(
        skill_id="prompt_recipe_builder",
        legacy_skill_id="create_prompt_recipe",
        label="Prompt Recipe Builder",
        prompt_asset="apps/api/app/assistant/prompts/skills/prompt_recipe_builder.md",
        prompt_asset_version=PROMPT_ASSET_VERSION,
        required_context=["attachments", "assistant_session", "prompt_recipes"],
        allowed_operations=["ask_clarifying_question", "create_recipe_draft", "test_recipe", "save_prompt_recipe"],
        output_schema="PromptRecipeBuilderSkillOutput",
    ),
    "graph_workflow_builder": AssistantSkillManifest(
        skill_id="graph_workflow_builder",
        legacy_skill_id="create_workflow",
        label="Graph Workflow Builder",
        prompt_asset="apps/api/app/assistant/prompts/skills/graph_workflow_builder.md",
        prompt_asset_version=PROMPT_ASSET_VERSION,
        required_context=["workflow", "node_catalog", "attachments", "assistant_session"],
        allowed_operations=["ask_clarifying_question", "create_graph_plan", "apply_graph_plan", "run_workflow"],
        output_schema="AssistantGraphPlan",
    ),
    "run_debugger": AssistantSkillManifest(
        skill_id="run_debugger",
        legacy_skill_id="repair_debug",
        label="Run Debugger",
        prompt_asset="apps/api/app/assistant/prompts/skills/run_debugger.md",
        prompt_asset_version=PROMPT_ASSET_VERSION,
        required_context=["workflow", "latest_run", "node_catalog", "assistant_session"],
        allowed_operations=["inspect_run", "explain_failure", "create_repair_plan", "apply_graph_plan"],
        output_schema="RunDebuggerSkillOutput",
    ),
    "general_helper": AssistantSkillManifest(
        skill_id="general_helper",
        legacy_skill_id="answer_question",
        label="General Helper",
        prompt_asset="apps/api/app/assistant/prompts/skills/general_helper.md",
        prompt_asset_version=PROMPT_ASSET_VERSION,
        required_context=["workflow", "attachments", "assistant_session"],
        allowed_operations=["answer_question", "ask_clarifying_question"],
        output_schema="AssistantMessage",
    ),
}


LEGACY_TO_RUNTIME_SKILL: Dict[str, RuntimeSkillId] = {
    manifest.legacy_skill_id: manifest.skill_id for manifest in KERNEL_SKILLS.values()
}


def assistant_skill_manifests() -> List[Dict[str, Any]]:
    return [manifest_to_dict(manifest) for manifest in KERNEL_SKILLS.values()]


def manifest_to_dict(manifest: AssistantSkillManifest) -> Dict[str, Any]:
    return {
        "skill_id": manifest.skill_id,
        "legacy_skill_id": manifest.legacy_skill_id,
        "label": manifest.label,
        "prompt_asset": manifest.prompt_asset,
        "prompt_asset_version": manifest.prompt_asset_version,
        "required_context": list(manifest.required_context),
        "allowed_operations": list(manifest.allowed_operations),
        "output_schema": manifest.output_schema,
        "response_policy": manifest.response_policy,
    }


def manifest_for_legacy_skill_id(legacy_skill_id: str) -> AssistantSkillManifest:
    runtime_skill_id = LEGACY_TO_RUNTIME_SKILL.get(legacy_skill_id, "general_helper")
    return KERNEL_SKILLS[runtime_skill_id]


def attachment_set_hash(attachments: List[Dict[str, Any]]) -> str:
    canonical = [
        {
            "assistant_attachment_id": str(item.get("assistant_attachment_id") or ""),
            "reference_id": str(item.get("reference_id") or ""),
            "kind": str(item.get("kind") or ""),
            "label": str(item.get("label") or ""),
        }
        for item in attachments
    ]
    canonical.sort(key=lambda item: (item["reference_id"], item["assistant_attachment_id"], item["label"]))
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return digest


def build_skill_session_id(
    *,
    assistant_session_id: str,
    skill_id: str,
    workflow_tab_id: str | None,
    lane: str | None,
    attachment_hash: str,
) -> str:
    canonical = {
        "assistant_session_id": str(assistant_session_id or ""),
        "skill_id": str(skill_id or ""),
        "workflow_tab_id": str(workflow_tab_id or ""),
        "lane": str(lane or "auto"),
        "attachment_set_hash": str(attachment_hash or ""),
    }
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:24]
    return f"askill_{digest}"


def build_skill_trace(
    *,
    session_id: str,
    skill_session_id: str | None = None,
    message_id: str | None,
    workflow_tab_id: str | None,
    manifest: AssistantSkillManifest,
    intent_route: Dict[str, Any] | None = None,
    contract_validation: Dict[str, Any] | None = None,
    state_before: str,
    state_after: str,
    attachments: List[Dict[str, Any]],
    cache_decision: str,
    cache_reason: str,
    provider_called: bool,
    provider_kind: str | None,
    provider_response_id: str | None,
    provider_model_id: str | None = None,
    provider_session_id: str | None = None,
    provider_thread_id: str | None = None,
    provider_turn_id: str | None = None,
    provider_thread_reused: bool | None = None,
    provider_image_path_count: int | None = None,
    provider_image_path_basenames: List[str] | None = None,
    provider_image_path_hashes: List[str] | None = None,
    fallback_mode: str | None = None,
    prompt_quality_score: int | None = None,
    prompt_quality_passed: bool | None = None,
    prompt_quality_issues: List[str] | None = None,
    fixmyphoto_planner_score: int | None = None,
    fixmyphoto_planner_issues: List[str] | None = None,
    generation_directness_score: int | None = None,
    generation_directness_issues: List[str] | None = None,
    prompt_contract_validation_status: str | None = None,
    prompt_contract_validation_issues: List[str] | None = None,
    repair_attempt_count: int | None = None,
    output_match_rating: int | None = None,
    output_comparison_summary: str | None = None,
    latest_run_id: str | None = None,
    latest_output_asset_id: str | None = None,
    saved_preset_ids: List[str] | None = None,
    saved_preset_keys: List[str] | None = None,
    next_action: str | None = None,
    assistant_prompt_route: str | None = None,
    loaded_prompt_assets: List[str] | None = None,
    system_prompt_char_count: int | None = None,
) -> Dict[str, Any]:
    image_attachments = [item for item in attachments if str(item.get("kind") or "").lower() in {"", "image"}]
    return {
        "session_id": session_id,
        "skill_session_id": skill_session_id,
        "message_id": message_id,
        "workflow_tab_id": workflow_tab_id,
        "skill": manifest.skill_id,
        "legacy_skill": manifest.legacy_skill_id,
        "intent_capability": (intent_route or {}).get("capability"),
        "intent_confidence": (intent_route or {}).get("confidence"),
        "intent_needs_clarification": (intent_route or {}).get("needs_clarification"),
        "contract_validation": contract_validation or {"status": "not_applicable"},
        "prompt_asset": manifest.prompt_asset,
        "prompt_asset_version": manifest.prompt_asset_version,
        "state_before": state_before,
        "state_after": state_after,
        "attachment_set_hash": attachment_set_hash(attachments),
        "reference_ids": [str(item.get("reference_id") or "") for item in image_attachments if str(item.get("reference_id") or "")],
        "attachment_ids": [str(item.get("assistant_attachment_id") or "") for item in image_attachments if str(item.get("assistant_attachment_id") or "")],
        "attachment_labels": [str(item.get("label") or "")[:80] for item in image_attachments if str(item.get("label") or "")],
        "input_image_count": len(image_attachments),
        "cache_decision": cache_decision,
        "cache_reason": cache_reason,
        "provider_called": provider_called,
        "provider_kind": provider_kind,
        "provider_model_id": provider_model_id,
        "provider_session_id": provider_session_id,
        "provider_thread_id": provider_thread_id,
        "provider_turn_id": provider_turn_id,
        "provider_thread_reused": provider_thread_reused,
        "provider_image_path_count": provider_image_path_count,
        "provider_image_path_basenames": (provider_image_path_basenames or [])[:14],
        "provider_image_path_hashes": (provider_image_path_hashes or [])[:14],
        "provider_response_id": provider_response_id,
        "fallback_mode": fallback_mode,
        "prompt_quality_score": prompt_quality_score,
        "prompt_quality_passed": prompt_quality_passed,
        "prompt_quality_issues": (prompt_quality_issues or [])[:8],
        "fixmyphoto_planner_score": fixmyphoto_planner_score,
        "fixmyphoto_planner_issues": (fixmyphoto_planner_issues or [])[:8],
        "generation_directness_score": generation_directness_score,
        "generation_directness_issues": (generation_directness_issues or [])[:8],
        "prompt_contract_validation_status": prompt_contract_validation_status,
        "prompt_contract_validation_issues": (prompt_contract_validation_issues or [])[:8],
        "repair_attempt_count": repair_attempt_count,
        "output_match_rating": output_match_rating,
        "output_comparison_summary": output_comparison_summary,
        "latest_run_id": latest_run_id,
        "latest_output_asset_id": latest_output_asset_id,
        "saved_preset_ids": saved_preset_ids or [],
        "saved_preset_keys": saved_preset_keys or [],
        "next_action": next_action,
        "assistant_prompt_route": assistant_prompt_route,
        "loaded_prompt_assets": loaded_prompt_assets or [],
        "system_prompt_char_count": system_prompt_char_count,
    }


def sanitize_skill_trace(trace: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {
        "session_id",
        "skill_session_id",
        "message_id",
        "workflow_tab_id",
        "skill",
        "legacy_skill",
        "intent_capability",
        "intent_confidence",
        "intent_needs_clarification",
        "contract_validation",
        "prompt_asset",
        "prompt_asset_version",
        "state_before",
        "state_after",
        "attachment_set_hash",
        "reference_ids",
        "attachment_ids",
        "attachment_labels",
        "input_image_count",
        "cache_decision",
        "cache_reason",
        "provider_called",
        "provider_kind",
        "provider_model_id",
        "provider_session_id",
        "provider_thread_id",
        "provider_turn_id",
        "provider_thread_reused",
        "provider_image_path_count",
        "provider_image_path_basenames",
        "provider_image_path_hashes",
        "provider_response_id",
        "fallback_mode",
        "prompt_quality_score",
        "prompt_quality_passed",
        "prompt_quality_issues",
        "fixmyphoto_planner_score",
        "fixmyphoto_planner_issues",
        "generation_directness_score",
        "generation_directness_issues",
        "prompt_contract_validation_status",
        "prompt_contract_validation_issues",
        "repair_attempt_count",
        "output_match_rating",
        "output_comparison_summary",
        "latest_run_id",
        "latest_output_asset_id",
        "saved_preset_ids",
        "saved_preset_keys",
        "next_action",
        "assistant_prompt_route",
        "loaded_prompt_assets",
        "system_prompt_char_count",
    }
    return {key: value for key, value in trace.items() if key in allowed}
