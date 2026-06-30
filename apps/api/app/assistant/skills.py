from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Tuple

from .preset_skill import MEDIA_PRESET_BUILDER_LIFECYCLE
from .skill_kernel import manifest_for_legacy_skill_id


AssistantSkillId = Literal["create_workflow", "create_prompt_recipe", "create_media_preset", "repair_debug", "answer_question"]


@dataclass(frozen=True)
class AssistantSkill:
    skill_id: AssistantSkillId
    label: str
    capability: str
    context_keys: List[str]
    media_kinds: List[str]
    output_contract: str
    lifecycle_states: Tuple[str, ...] = ()


ASSISTANT_SKILLS: Dict[AssistantSkillId, AssistantSkill] = {
    "create_workflow": AssistantSkill(
        skill_id="create_workflow",
        label="Create workflow",
        capability="plan_graph",
        context_keys=["workflow", "node_catalog", "media_presets", "prompt_recipes", "attachments", "assistant_limits"],
        media_kinds=["image", "video", "audio"],
        output_contract="AssistantGraphPlan",
    ),
    "create_prompt_recipe": AssistantSkill(
        skill_id="create_prompt_recipe",
        label="Create Prompt Recipe",
        capability="draft_prompt_recipe",
        context_keys=["prompt_recipes", "attachments", "assistant_limits"],
        media_kinds=["image"],
        output_contract="PromptRecipeUpsertRequest",
    ),
    "create_media_preset": AssistantSkill(
        skill_id="create_media_preset",
        label="Create Media Preset",
        capability="draft_media_preset",
        context_keys=["media_presets", "node_catalog", "attachments", "assistant_limits"],
        media_kinds=["image", "video", "audio"],
        output_contract="PresetUpsertRequest",
        lifecycle_states=MEDIA_PRESET_BUILDER_LIFECYCLE,
    ),
    "repair_debug": AssistantSkill(
        skill_id="repair_debug",
        label="Repair graph",
        capability="repair_graph",
        context_keys=["workflow", "failed_run", "node_catalog"],
        media_kinds=[],
        output_contract="AssistantGraphPlan",
    ),
    "answer_question": AssistantSkill(
        skill_id="answer_question",
        label="Answer question",
        capability="answer_question",
        context_keys=["workflow", "node_catalog", "media_presets", "prompt_recipes", "attachments"],
        media_kinds=["image", "video", "audio"],
        output_contract="AssistantMessage",
    ),
}


def assistant_skill_catalog() -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    for skill in ASSISTANT_SKILLS.values():
        manifest = manifest_for_legacy_skill_id(skill.skill_id)
        catalog.append(
            {
            "skill_id": skill.skill_id,
            "runtime_skill_id": manifest.skill_id,
            "label": skill.label,
            "capability": skill.capability,
            "context_keys": skill.context_keys,
            "media_kinds": skill.media_kinds,
            "output_contract": skill.output_contract,
            "prompt_asset": manifest.prompt_asset,
            "prompt_asset_version": manifest.prompt_asset_version,
            "allowed_operations": list(manifest.allowed_operations),
            "lifecycle_states": list(skill.lifecycle_states),
        }
        )
    return catalog


def select_assistant_skill(message: str) -> AssistantSkill:
    text = " ".join(str(message or "").lower().split())
    if any(token in text for token in ("fix", "repair", "debug", "failed", "error")):
        return ASSISTANT_SKILLS["repair_debug"]
    if any(token in text for token in ("workflow", "work graph", "graph", "node", "connect", "wire", "output")):
        return ASSISTANT_SKILLS["create_workflow"]
    if any(token in text for token in ("recipe", "prompt recipe")):
        return ASSISTANT_SKILLS["create_prompt_recipe"]
    if any(token in text for token in ("preset", "media preset")):
        return ASSISTANT_SKILLS["create_media_preset"]
    if any(token in text for token in ("workflow", "graph", "node", "connect", "build", "create", "generate")):
        return ASSISTANT_SKILLS["create_workflow"]
    return ASSISTANT_SKILLS["answer_question"]
