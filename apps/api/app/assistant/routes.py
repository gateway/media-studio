from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from .. import store
from .. import store_assistant
from ..graph.normalization import materialize_workflow_defaults
from ..graph.pricing import estimate_graph_workflow
from ..graph.registry import registry
from ..graph.schemas import GraphError, GraphWorkflow
from ..graph.validator import validate_workflow
from ..service_errors import ServiceError
from ..service_preset_validation import upsert_preset
from ..service_prompt_recipe_validation import upsert_prompt_recipe
from ..store_support import new_id
from .canvas_context import canvas_inventory_reply, canvas_preset_shape_reply
from .character_sheet_recipe import (
    CHARACTER_SHEET_TEMPLATE_ID,
    character_sheet_graph_plan_from_workflow_request,
    character_sheet_prompt_recipe_request,
)
from .context import build_assistant_context, build_attachment_summary, build_latest_run_summary
from .cancellation import AssistantRequestCancelled, cancel_session as cancel_tracked_session, track_session
from .drafts import draft_media_preset, draft_prompt_recipe, reconcile_media_preset_draft_for_save
from .graph_diff import graph_plan_diff_summary, graph_plan_layout_errors
from .graph_plan import apply_graph_plan
from .story_graph import story_graph_plan_from_state
from .transcript_quality import audit_assistant_transcript
from .turn_trace import build_assistant_turn_trace
from .intent import AssistantIntentRoute, intent_guidance_text, is_graph_creation_negated, is_story_project_request, route_assistant_intent
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT, is_image_attachment
from .planner import plan_graph_from_message
from .preset_loop_state import (
    PresetLoopLane,
    preset_loop_drift_reply,
    preset_loop_lane_from_summary,
    preset_loop_planning_instruction,
    preset_loop_start_lane,
    preset_loop_start_lane_from_metadata,
)
from .preset_builder import (
    apply_provider_image_input_hint,
    build_preset_builder_proposal,
    is_reference_preset_request,
    preset_builder_chat_text,
)
from .preset_capabilities import wants_sandbox_example
from .preset_slots import infer_runtime_image_slots_from_text
from .prompt_recall import is_full_prompt_request, prompt_recall_chat_reply
from .provider_chat import AssistantProviderChatError, run_assistant_provider_chat
from .provider_planner import run_provider_graph_plan
from .repair import repair_plan_for_failed_run
from .run_approval import deterministic_run_request_reply, test_run_request
from .schemas import (
    AssistantAttachment,
    AssistantAttachmentCreateRequest,
    AssistantArtifactSaveResponse,
    AssistantDraftCreateRequest,
    AssistantGraphPlan,
    AssistantMediaInspectionResponse,
    AssistantMediaPresetDraftResponse,
    AssistantMediaPresetSaveRequest,
    AssistantMessageCreateRequest,
    MediaPresetBuilderSkillInput,
    AssistantPlan,
    AssistantPlanApplyRequest,
    AssistantPlanApplyResponse,
    AssistantPlanCreateRequest,
    AssistantPlanResponse,
    AssistantPromptRecipeDraftResponse,
    AssistantPromptRecipeSaveRequest,
    AssistantRepairCreateRequest,
    AssistantRepairResponse,
    AssistantSession,
    AssistantSessionCreateRequest,
    AssistantSessionListResponse,
)
from .selected_node_edit import selected_node_field_edit_plan_from_context
from .skills import ASSISTANT_SKILLS
from .skill_kernel import (
    assistant_skill_manifests,
    attachment_set_hash,
    build_skill_session_id,
    build_skill_trace,
    manifest_for_legacy_skill_id,
    sanitize_skill_trace,
)
from .story_state import merge_story_project_state, story_project_from_session
from .style_brief import (
    ReferenceStyleImageSlot,
    ReferenceStylePresetField,
    build_reference_style_output_check,
    build_reference_style_brief,
    compact_style_brief_reply,
    encode_reference_style_brief_marker,
    has_concrete_style_traits,
    merge_reference_style_contract_into_proposal,
    parse_reference_style_brief,
    reference_style_brief_hash,
    reference_style_brief_to_analysis_text,
    reference_style_brief_with_alternative_fields,
    compile_reference_style_prompt_result,
    compile_reference_style_t2i_prompt_result,
    score_reference_style_prompt_text,
    strip_provider_reference_style_payload,
    sync_reference_style_brief_with_visible_setup,
)

router = APIRouter(prefix="/media/assistant", tags=["media-assistant"])

ASSISTANT_RESPONSE_KINDS = {"answer", "ask", "create_local", "confirm_paid_or_mutating"}
ASSISTANT_ASK_ACTIONS = {"clarify", "ask_clarifying_question"}
ASSISTANT_LOCAL_ACTIONS = {"create_graph_plan", "create_media_preset_draft", "create_prompt_recipe_draft"}
ASSISTANT_MUTATING_ACTIONS = {"run_workflow", "save_media_preset", "save_prompt_recipe"}
ASSISTANT_LOCAL_CAPABILITIES = {"plan_graph", "draft_prompt_recipe", "draft_media_preset", "repair_graph"}
ASSISTANT_MUTATING_CAPABILITIES = {"save_media_preset", "save_prompt_recipe"}


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{name} not found")


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def _shape_session(record: dict) -> AssistantSession:
    session_id = str(record["assistant_session_id"])
    return AssistantSession(
        **record,
        messages=[store_assistant_message for store_assistant_message in store_assistant.list_assistant_messages(session_id)],
        attachments=[store_assistant_attachment for store_assistant_attachment in store_assistant.list_assistant_attachments(session_id)],
    )


def _assistant_response_kind(content_json: dict[str, Any], content_text: str = "") -> str:
    action = str(content_json.get("suggested_action") or "")
    capability = str(content_json.get("capability") or "")
    if action in ASSISTANT_MUTATING_ACTIONS or capability in ASSISTANT_MUTATING_CAPABILITIES:
        return "confirm_paid_or_mutating"
    if action in ASSISTANT_ASK_ACTIONS or content_json.get("questions"):
        return "ask"
    if action in ASSISTANT_LOCAL_ACTIONS or capability in ASSISTANT_LOCAL_CAPABILITIES:
        return "create_local"
    existing = str(content_json.get("assistant_response_kind") or "")
    if existing in ASSISTANT_RESPONSE_KINDS:
        return existing
    return "answer"


def _assistant_content_json(content_json: dict[str, Any], content_text: str = "") -> dict[str, Any]:
    payload = dict(content_json)
    payload["assistant_response_kind"] = _assistant_response_kind(payload, content_text)
    payload["assistant_turn_trace"] = build_assistant_turn_trace(payload, content_text)
    return payload


def _media_preset_builder_status(summary_json: dict[str, Any] | None) -> str:
    if not isinstance(summary_json, dict):
        return "intake"
    builder_state = summary_json.get("media_preset_builder")
    if not isinstance(builder_state, dict):
        return "intake"
    return str(builder_state.get("status") or "intake")


def _attachment_counts(attachments: list[dict]) -> dict[str, int]:
    counts = {"image": 0, "video": 0, "audio": 0, "other": 0}
    for attachment in attachments:
        kind = str(attachment.get("kind") or "").lower()
        if is_image_attachment(attachment):
            counts["image"] += 1
        elif kind == "video":
            counts["video"] += 1
        elif kind == "audio":
            counts["audio"] += 1
        else:
            counts["other"] += 1
    return counts


def _reference_ids_for_style_cache(attachments: list[dict]) -> list[str]:
    return sorted(
        {
            str(attachment.get("reference_id") or "").strip()
            for attachment in attachments
            if is_image_attachment(attachment) and str(attachment.get("reference_id") or "").strip()
        }
    )


def _story_project_with_attachment_character_sheet(
    story_project: dict[str, Any] | None,
    attachments: list[dict],
) -> dict[str, Any] | None:
    if not story_project:
        return story_project
    sheet = story_project.get("approved_character_sheet") if isinstance(story_project.get("approved_character_sheet"), dict) else {}
    if str(sheet.get("reference_id") or "").strip() or str(sheet.get("asset_id") or "").strip():
        return story_project
    image_attachment = next(
        (
            attachment
            for attachment in attachments
            if is_image_attachment(attachment) and str(attachment.get("reference_id") or "").strip()
        ),
        None,
    )
    if not image_attachment:
        return story_project
    return {
        **story_project,
        "approved_character_sheet": {
            **sheet,
            "status": sheet.get("status") or "approved",
            "label": sheet.get("label") or image_attachment.get("label") or "Character Sheet Ref",
            "source": sheet.get("source") or "assistant_attachment",
            "reference_id": str(image_attachment.get("reference_id") or "").strip(),
        },
    }


def _style_brief_matches_references(brief: Any, reference_ids: list[str]) -> bool:
    if not reference_ids or not brief or not has_concrete_style_traits(brief):
        return False
    return sorted(str(item) for item in brief.source_reference_ids if str(item).strip()) == reference_ids


def _active_reference_style_brief_for_attachments(summary_json: dict[str, Any], attachments: list[dict]) -> Any | None:
    brief = parse_reference_style_brief(summary_json.get("reference_style_brief"))
    if not (brief and has_concrete_style_traits(brief)):
        return None
    builder_state = summary_json.get("media_preset_builder") if isinstance(summary_json.get("media_preset_builder"), dict) else {}
    current_hash = attachment_set_hash(attachments)
    stored_hash = str(builder_state.get("attachment_set_hash") or "").strip()
    if stored_hash:
        return brief if stored_hash == current_hash else None
    # Backward compatibility for active sessions created before attachment hashing
    # existed. Cross-session reuse still goes through the explicit fallback path.
    return brief if _style_brief_matches_references(brief, _reference_ids_for_style_cache(attachments)) else None


def _latest_visible_reference_style_setup(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message.get("role") != "assistant":
            continue
        text = str(message.get("content_text") or "").strip()
        if "Suggested setup" in text and ("- Field:" in text or "- Image input:" in text):
            return text
    return ""


def _clone_style_brief_for_attachments(brief: Any, attachments: list[dict]) -> Any:
    return brief.model_copy(
        update={
            "brief_id": new_id("rsb"),
            "source_attachment_ids": [
                str(attachment.get("assistant_attachment_id") or "")
                for attachment in attachments
                if is_image_attachment(attachment) and str(attachment.get("assistant_attachment_id") or "").strip()
            ],
            "source_reference_ids": _reference_ids_for_style_cache(attachments),
            "status": "draft",
        }
    )


def _cached_reference_style_brief_for_attachments(attachments: list[dict]) -> Any | None:
    reference_ids = _reference_ids_for_style_cache(attachments)
    if not reference_ids:
        return None
    for session in store_assistant.list_assistant_sessions(limit=80):
        summary_json = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
        summary_brief = parse_reference_style_brief(summary_json.get("reference_style_brief"))
        if _style_brief_matches_references(summary_brief, reference_ids):
            return _clone_style_brief_for_attachments(summary_brief, attachments)
        session_id = str(session.get("assistant_session_id") or "")
        for message in reversed(store_assistant.list_assistant_messages(session_id)):
            content_json = message.get("content_json") if isinstance(message.get("content_json"), dict) else {}
            message_brief = parse_reference_style_brief(content_json.get("reference_style_brief"))
            if _style_brief_matches_references(message_brief, reference_ids):
                return _clone_style_brief_for_attachments(message_brief, attachments)
    return None


def _image_slot_from_proposal(proposal: dict | None) -> ReferenceStyleImageSlot:
    slots = []
    if isinstance(proposal, dict):
        contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
        slots = contract.get("image_slots") if isinstance(contract.get("image_slots"), list) else []
    first_slot = next((slot for slot in slots if isinstance(slot, dict)), {})
    return ReferenceStyleImageSlot(
        key=str(first_slot.get("key") or "subject_image"),
        label=str(first_slot.get("label") or "Subject Image"),
        purpose=str(first_slot.get("help_text") or first_slot.get("purpose") or "User-provided image to restyle with the extracted reference look."),
        required=bool(first_slot.get("required", True)),
    )


def _enforce_locked_lane_on_style_brief(brief: Any, proposal: dict | None, locked_lane: PresetLoopLane | None) -> Any:
    if not brief or locked_lane not in {"image_to_image", "both"} or brief.preset_contract.image_slots:
        return brief
    image_slot = _image_slot_from_proposal(proposal)
    fields = list(brief.preset_contract.fields or [])
    if not fields:
        fields = [
            ReferenceStylePresetField(
                key="pose_framing",
                label="Pose / Framing",
                purpose="Optional crop, pose, or composition guidance for the provided image.",
                required=False,
            )
        ]
    return brief.model_copy(
        update={
            "preset_direction": brief.preset_direction.model_copy(
                update={"target_model_mode": "image_edit", "input_mode": "image_required"}
            ),
            "preset_contract": brief.preset_contract.model_copy(update={"fields": fields, "image_slots": [image_slot]}),
            "recommended_fields": fields,
            "recommended_image_slots": [image_slot],
        }
    )


def _persist_user_prompt(session_id: str, message: str, *, capability: str) -> None:
    text = message.strip()
    if not text:
        return
    existing = store_assistant.list_assistant_messages(session_id)
    latest_user = next((item for item in reversed(existing) if item.get("role") == "user"), None)
    if latest_user and str(latest_user.get("content_text") or "").strip() == text:
        return
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "user",
            "content_text": text,
            "content_json": {
                "capability": capability,
                "source": "assistant_action",
            },
        }
    )


def _fallback_chat_text(reason: str, *, route=None) -> str:
    if route:
        return intent_guidance_text(route, provider_error=reason)
    detail = f" Provider chat is not ready yet: {reason}" if reason else ""
    return (
        "I can still help by building a graph from the request, but the live AI chat connection did not complete."
        f"{detail} Ask me to create the graph when you are ready."
    )


def _fresh_reference_analysis_failed_text(reason: str) -> str:
    detail = str(reason or "").strip()
    suffix = f" ({detail[:140]})" if detail else ""
    return (
        "I could not analyze the attached reference image yet, so I should not create a test graph from a guess. "
        f"Please try again once the assistant connection is ready{suffix}."
    )


def _assistant_label_list(labels: list[str]) -> str:
    cleaned = [str(label).strip() for label in labels if str(label).strip()]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return ", ".join(cleaned[:-1]) + f", and {cleaned[-1]}"


def _replacement_field_planning_chat_text(brief: Any) -> str:
    fields = [field for field in brief.preset_contract.fields if str(field.label or "").strip()]
    slots = [slot for slot in brief.preset_contract.image_slots if str(slot.label or "").strip()]
    field_text = _assistant_label_list([field.label for field in fields[:2]]) or "a different field set"
    slot_text = _assistant_label_list([slot.label for slot in slots[:2]])
    if slot_text:
        image_sentence = (
            f"I would keep {slot_text} as the image input."
            if len(slots) == 1
            else f"I would keep {slot_text} as the image inputs."
        )
    else:
        image_sentence = "I can keep this text-to-image unless you want to add an image input."
    return (
        f"Other good fields from this image would be {field_text}.\n\n"
        f"{image_sentence} Do you want me to use this version for the test graph?"
    )


def _reference_style_brief_with_requested_image_slots(brief: Any, requested_slots: list[dict[str, Any]]) -> Any | None:
    if not brief or not requested_slots:
        return brief
    image_slots: list[ReferenceStyleImageSlot] = []
    seen_keys: set[str] = set()
    for index, slot in enumerate(requested_slots[:5]):
        label = str(slot.get("label") or f"Image Input {index + 1}").strip() or f"Image Input {index + 1}"
        key = str(slot.get("key") or "").strip()
        key = re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", key.lower())).strip("_")
        if not key:
            key = re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", label.lower())).strip("_") or f"image_input_{index + 1}"
        if key in seen_keys:
            key = f"{key}_{index + 1}"
        seen_keys.add(key)
        image_slots.append(
            ReferenceStyleImageSlot(
                key=key,
                label=label[:48],
                purpose=str(slot.get("purpose") or f"{label} image the user provides for this preset."),
                required=bool(slot.get("required", True)),
            )
        )
    if not image_slots:
        return brief
    return brief.model_copy(
        update={
            "preset_direction": brief.preset_direction.model_copy(
                update={"target_model_mode": "image_edit", "input_mode": "image_required"}
            ),
            "preset_contract": brief.preset_contract.model_copy(update={"image_slots": image_slots}),
            "recommended_image_slots": image_slots,
        }
    )


def _image_slot_planning_chat_text(brief: Any) -> str:
    slots = [slot for slot in brief.preset_contract.image_slots if str(slot.label or "").strip()]
    fields = [field for field in brief.preset_contract.fields if str(field.label or "").strip()]
    slot_text = _assistant_label_list([slot.label for slot in slots[:3]]) or "the requested image inputs"
    field_text = _assistant_label_list([field.label for field in fields[:2]])
    input_noun = "image input" if len(slots) == 1 else "image inputs"
    field_sentence = f" and keep {field_text} as the editable fields" if field_text else ""
    return (
        f"Got it. I would use {slot_text} as the {input_noun} for this preset{field_sentence}. "
        "I will use that setup when we create the test graph."
    )


def _media_preset_builder_contract_validation(
    *,
    user_message: str,
    assistant_mode: str | None,
    workflow_tab_id: str | None,
    current_state: str,
    requested_lane: str | None,
    attachments: list[dict],
    latest_run_id: str | None,
    latest_output_asset_id: str | None,
    summary_json: dict[str, Any],
) -> dict[str, Any]:
    builder_state = summary_json.get("media_preset_builder") if isinstance(summary_json.get("media_preset_builder"), dict) else {}
    try:
        MediaPresetBuilderSkillInput(
            user_message=user_message,
            assistant_mode=assistant_mode,
            workflow_tab_id=workflow_tab_id,
            current_state=current_state if current_state else "intake",
            requested_lane=requested_lane or "undecided",
            attachment_set_hash=attachment_set_hash(attachments),
            reference_ids=_reference_ids_for_style_cache(attachments),
            latest_run_id=latest_run_id,
            latest_output_asset_id=latest_output_asset_id,
            approved_fields=builder_state.get("field_choices") if isinstance(builder_state.get("field_choices"), list) else [],
            approved_image_slots=builder_state.get("image_slot_choices") if isinstance(builder_state.get("image_slot_choices"), list) else [],
            force_fresh_analysis=not bool(builder_state.get("style_brief_hash")),
        )
    except Exception as exc:
        return {
            "status": "invalid",
            "contract": "MediaPresetBuilderSkillInput",
            "error": str(exc)[:240],
        }
    return {
        "status": "valid",
        "contract": "MediaPresetBuilderSkillInput",
    }


def _provider_lifecycle_state(
    provider_result: dict | None,
    *,
    provider_error: str = "",
    provider_called: bool = False,
    fallback_mode: str | None = None,
) -> dict[str, Any]:
    result = provider_result if isinstance(provider_result, dict) else {}
    provider_kind = str(result.get("provider_kind") or "").strip()
    provider_model_id = str(result.get("provider_model_id") or "").strip()
    provider_response_id = str(result.get("provider_response_id") or "").strip()
    provider_thread_id = str(result.get("provider_thread_id") or "").strip()
    provider_turn_id = str(result.get("provider_turn_id") or "").strip()
    provider_session_id = str(
        result.get("provider_session_id")
        or result.get("provider_thread_id")
        or result.get("thread_id")
        or result.get("conversation_id")
        or ""
    ).strip()
    state = {
        "provider_called": bool(provider_called),
        "provider_kind": provider_kind or None,
        "provider_model_id": provider_model_id or None,
        "provider_session_id": provider_session_id or None,
        "provider_thread_id": provider_thread_id or None,
        "provider_turn_id": provider_turn_id or None,
        "provider_thread_reused": result.get("provider_thread_reused") if "provider_thread_reused" in result else None,
        "provider_response_id": provider_response_id or None,
        "provider_error": provider_error[:240] if provider_error else None,
        "fallback_mode": fallback_mode or (str(result.get("mode") or "").strip() if not provider_called else None) or None,
    }
    return {key: value for key, value in state.items() if value not in ("", None)}


def _apply_prompt_quality_validation(validation, prompt_compile_result):
    if not prompt_compile_result:
        return validation
    errors = list(validation.errors or [])
    if prompt_compile_result.contract_validation_status == "invalid":
        for issue in prompt_compile_result.contract_validation_issues[:6]:
            errors.append(
                GraphError(
                    code="preset_prompt_contract_invalid",
                    message=f"Preset prompt contract invalid: {issue}",
                    node_id=None,
                    field_id="text",
                )
            )
    if not prompt_compile_result.prompt_quality_passed:
        issue_text = "; ".join(prompt_compile_result.prompt_quality_issues[:4]) or "prompt quality score is below threshold"
        errors.append(
            GraphError(
                code="preset_prompt_quality_failed",
                message=f"Preset prompt quality failed: {issue_text}",
                node_id=None,
                field_id="text",
            )
        )
    if not errors:
        return validation
    return validation.model_copy(update={"valid": False, "errors": errors})


def _media_preset_builder_followup_route(*, media_intent: bool) -> AssistantIntentRoute:
    return AssistantIntentRoute(
        skill=ASSISTANT_SKILLS["create_media_preset"],
        confidence=0.92,
        needs_clarification=False,
        suggestions=["Continue the active Media Preset loop with a compact next action."],
        media_intent=media_intent,
    )


def _should_keep_media_preset_builder_route(
    text: str,
    *,
    assistant_mode: str | None,
    summary_json: dict[str, Any],
    attachments: list[dict],
) -> bool:
    if assistant_mode != "preset" and not isinstance(summary_json.get("media_preset_builder"), dict):
        return False
    lowered = " ".join(str(text or "").lower().strip().split())
    if any(term in lowered for term in ("recipe", "prompt recipe")):
        return False
    if any(term in lowered for term in ("new graph from scratch", "switch to graph", "graph mode")):
        return False
    return (
        _comparison_question_context(text)
        or test_run_request(text)
        or _preset_save_request(text)
        or _sandbox_creation_request(text)
        or wants_sandbox_example(text)
        or _ambiguous_action_request(text)
        or (bool(attachments) and "preset" in lowered)
    )


def _character_sheet_prompt_lookup_request(text: str) -> bool:
    normalized = " ".join(str(text or "").lower().strip().split())
    return is_full_prompt_request(text) and any(
        term in normalized
        for term in (
            "character sheet",
            "chr sheet",
            "character reference sheet",
            "reference sheet branch",
        )
    )


def _media_preset_prompt_route(
    text: str,
    attachments: list[dict],
    *,
    assistant_mode: str | None,
    output_comparison: bool = False,
    reference_style_prompt_only: bool = False,
) -> str:
    normalized = " ".join(str(text or "").lower().strip().split())
    has_images = any(is_image_attachment(attachment) for attachment in attachments)
    if output_comparison:
        return "output_comparison"
    if is_full_prompt_request(text) and (not is_story_project_request(text) or _character_sheet_prompt_lookup_request(text)):
        return "show_current_prompt"
    if reference_style_prompt_only:
        return "preset_intake"
    if any(
        phrase in normalized
        for phrase in (
            "don't like those fields",
            "dont like those fields",
            "do not like those fields",
            "other fields",
            "alternative fields",
            "different fields",
            "change the fields",
            "field alternatives",
        )
    ):
        return "replacement_field_planning"
    if any(
        phrase in normalized
        for phrase in (
            "image input",
            "image inputs",
            "input image",
            "input images",
            "face and body",
            "face reference",
            "body reference",
            "product reference",
            "vehicle reference",
            "room reference",
            "logo reference",
            "two images",
            "2 images",
        )
    ):
        return "image_slot_planning"
    if _sandbox_creation_request(text) or _preset_save_request(text) or "test workflow" in normalized or "save preset" in normalized:
        return "prompt_compilation"
    if has_images and (assistant_mode == "preset" or is_reference_preset_request(text, attachments)):
        return "preset_intake"
    if has_images and any(term in normalized for term in ("analyze", "analyse", "break down", "describe", "clone", "recreate")):
        return "reference_image_analysis"
    return "general"


def _should_compact_preset_reply(text: str) -> bool:
    lowered = text.lower()
    return (
        len(text) > 1000
        or "```" in text
        or "prompt template" in lowered
        or "full prompt" in lowered
        or "target model" in lowered
        or "nano-banana" in lowered
        or "nano banana" in lowered
        or "gpt-image" in lowered
        or "gpt image" in lowered
    )


def _local_create_negated(text: str) -> bool:
    normalized = " ".join(str(text or "").lower().strip().split())
    if not normalized:
        return False
    if "chat text only" in normalized or "chat only" in normalized:
        return True
    create_verbs = r"(?:create|creating|build|building|make|making|add|adding|apply|applying|prepare|preparing|start|starting|generate|generating)"
    local_targets = r"(?:graph|workflow|canvas|node|nodes|anything|any thing)"
    if re.search(rf"\b(?:do not|don't|dont)\b.{0,100}\b{create_verbs}\b.{0,100}\b{local_targets}\b", normalized):
        return True
    if re.search(rf"\bwithout\b.{0,100}\b{create_verbs}\b.{0,100}\b{local_targets}\b", normalized):
        return True
    if re.search(rf"\b(?:do not|don't|dont)\s+{create_verbs}\b", normalized) and any(
        target in normalized for target in ("anything", "graph", "workflow", "canvas", "node")
    ):
        return True
    return False


def _workflow_draft_preset_prompt_text(workflow: GraphWorkflow) -> str:
    for node in workflow.nodes:
        metadata = node.metadata if isinstance(node.metadata, dict) else {}
        assistant = metadata.get("assistant") if isinstance(metadata.get("assistant"), dict) else {}
        ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
        if node.type == "prompt.text" and (
            str(assistant.get("semantic_ref") or "") == "prompt"
            or str(ui.get("customTitle") or "").strip().lower() == "draft preset prompt"
        ):
            fields = node.fields if isinstance(node.fields, dict) else {}
            return str(fields.get("text") or fields.get("prompt") or "").strip()
    return ""


def _field_contract_from_prompt_text(prompt_text: str) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    seen: set[str] = set()
    patterns = (
        r"\bSet\s+the\s+(.{2,48}?)\s+as\s+",
        r"\bUse\s+.{2,140}?\s+as\s+the\s+(.{2,48}?)(?:\s+to\b|[.,;]|$)",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, str(prompt_text or ""), flags=re.IGNORECASE):
            raw_match = match.group(0)
            if "[[" in raw_match or "{{" in raw_match:
                continue
            label = re.sub(r"\s+", " ", match.group(1)).strip(" .,:;`\"'")
            if not label or label.lower() in {"field", "fields", "identity and likeness source", "visual subject and control source"}:
                continue
            key = re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", label.lower())).strip("_")
            if not key or key in seen:
                continue
            seen.add(key)
            fields.append(
                {
                    "key": key,
                    "label": label,
                    "required": len(fields) == 0,
                    "placeholder": f"{label}.",
                    "default_value": "",
                }
            )
            if len(fields) >= 4:
                return fields
    return fields


def _saved_preset_matches_workflow_fields(record: dict[str, Any], workflow: GraphWorkflow | None) -> bool:
    record_key = str(record.get("key") or "")
    record_base_key = _assistant_preset_key_base(record_key)
    if record_key != record_base_key:
        canonical = store.get_preset_by_key(record_base_key)
        if canonical and str(canonical.get("label") or "").strip().lower() == str(record.get("label") or "").strip().lower():
            return False
    prompt_fields = _field_contract_from_prompt_text(_workflow_draft_preset_prompt_text(workflow)) if workflow else []
    if not prompt_fields:
        return True
    saved_fields = record.get("input_schema_json") if isinstance(record.get("input_schema_json"), list) else []
    prompt_keys = [str(field.get("key") or "").strip() for field in prompt_fields if str(field.get("key") or "").strip()]
    saved_keys = [str(field.get("key") or "").strip() for field in saved_fields if str(field.get("key") or "").strip()]
    if prompt_keys != saved_keys:
        return False
    saved_prompt = str(record.get("prompt_template") or "")
    for field in prompt_fields:
        field_key = str(field.get("key") or "").strip()
        label = str(field.get("label") or "").strip()
        if field_key and label and f"Use {{{{{field_key}}}}} as the {label}" not in saved_prompt:
            return False
    return True


def _latest_preset_save_workflow(session_id: str) -> GraphWorkflow | None:
    for plan in store_assistant.list_assistant_plans(session_id):
        if str(plan.get("status") or "") not in {"applied", "validated"}:
            continue
        workflow_json = plan.get("workflow_json") if isinstance(plan.get("workflow_json"), dict) else None
        if not workflow_json:
            continue
        try:
            workflow = GraphWorkflow(**workflow_json)
        except Exception:
            continue
        if _workflow_draft_preset_prompt_text(workflow):
            return workflow
    return None


def _resolved_preset_save_workflow(session_id: str, workflow: GraphWorkflow | None) -> GraphWorkflow | None:
    if workflow and _workflow_draft_preset_prompt_text(workflow):
        return workflow
    return _latest_preset_save_workflow(session_id) or workflow


def _assistant_preset_key_base(key: str) -> str:
    return re.sub(r"_\d+$", "", str(key or "").strip())


def _existing_preset_for_assistant_draft(draft: Any) -> dict[str, Any] | None:
    exact = store.get_preset_by_key(str(getattr(draft, "key", "") or ""))
    if exact:
        return exact
    label = str(getattr(draft, "label", "") or "").strip().lower()
    key_base = _assistant_preset_key_base(str(getattr(draft, "key", "") or ""))
    if not label or not key_base.startswith("assistant_"):
        return None
    candidates: list[dict[str, Any]] = []
    for preset in store.list_presets():
        preset_key = str(preset.get("key") or "")
        if _assistant_preset_key_base(preset_key) != key_base:
            continue
        if str(preset.get("label") or "").strip().lower() == label:
            candidates.append(preset)
    if not candidates:
        return None
    return next((preset for preset in candidates if str(preset.get("key") or "") == key_base), candidates[0])


def _assistant_prompt_hash(prompt: str) -> str:
    return hashlib.sha256(repr(prompt or "").encode("utf-8")).hexdigest()[:12]


def _stamp_prompt_quality_gate(
    graph_plan: AssistantGraphPlan,
    workflow: GraphWorkflow,
    prompt_compile_result: Any | None,
) -> None:
    existing_metadata = workflow.metadata if isinstance(workflow.metadata, dict) else {}
    existing_assistant_plan = existing_metadata.get("assistant_plan") if isinstance(existing_metadata.get("assistant_plan"), dict) else {}
    template_id = str(graph_plan.metadata.get("template_id") or existing_assistant_plan.get("template_id") or "")
    if template_id not in {"preset_style_t2i_sandbox_v1", "preset_style_i2i_sandbox_v1"}:
        return
    prompt_text = _workflow_draft_preset_prompt_text(workflow)
    graph_plan.metadata.update(
        {
            "template_id": template_id,
            "prompt_quality_gate_required": True,
            "prompt_quality_passed": bool(prompt_compile_result and prompt_compile_result.prompt_quality_passed),
            "prompt_quality_score": prompt_compile_result.prompt_quality_score if prompt_compile_result else 0,
            "prompt_quality_prompt_hash": _assistant_prompt_hash(prompt_text),
            "fixmyphoto_planner_score": prompt_compile_result.fixmyphoto_planner_score if prompt_compile_result else 0,
            "generation_directness_score": prompt_compile_result.generation_directness_score if prompt_compile_result else 0,
            "prompt_contract_validation_status": prompt_compile_result.contract_validation_status if prompt_compile_result else "invalid",
        }
    )
    metadata = dict(existing_metadata)
    assistant_plan = dict(metadata.get("assistant_plan") or {})
    assistant_plan.update(graph_plan.metadata)
    metadata["assistant_plan"] = assistant_plan
    workflow.metadata = metadata


def _preset_loop_start_reply(
    lane: PresetLoopLane,
    *,
    reference_style_brief: Any | None = None,
    proposal: dict | None = None,
) -> str:
    if reference_style_brief and has_concrete_style_traits(reference_style_brief):
        brief = reference_style_brief
        if lane == "image_to_image":
            brief = _enforce_locked_lane_on_style_brief(brief, proposal, lane)
        elif lane == "text_to_image":
            brief = brief.model_copy(
                update={
                    "preset_direction": brief.preset_direction.model_copy(update={"target_model_mode": "image"}),
                    "preset_contract": brief.preset_contract.model_copy(update={"image_slots": []}),
                    "recommended_image_slots": [],
                }
            )
        return compact_style_brief_reply(brief, {"explicit_text_only": lane == "text_to_image"})
    if lane == "text_to_image":
        return (
            "Locked to Text-to-Image. I will treat attached refs as style sources only, with no image input in the preset. "
            "I will suggest one to three simple fields after reading the style. If that works, ask me to create the text-to-image test graph."
        )
    if lane == "image_to_image":
        return (
            "Locked to Image-to-Image. I will keep style refs as analysis only and use a separate user-provided image input for the preset. "
            "Suggested input: Subject Image. I will suggest any text fields after reading the style. If that works, ask me to create the image-to-image test graph."
        )
    return (
        "Locked to Both variants. I will test the Image-to-Image lane first, then the Text-to-Image lane, and save them as distinct presets. "
        "Start by asking me to create the image-to-image test graph."
    )


def _guided_reference_style_intake_request(
    text: str,
    attachments: list[dict],
    *,
    assistant_mode: str | None,
    locked_lane: PresetLoopLane | None,
) -> bool:
    """Preset-loop users often say "create the sandbox" after selecting a lane.

    In that path the product context already means "reference-image-to-preset";
    requiring the user to repeat "Media Preset" causes the assistant to skip
    style intake and produce an empty generic plan.
    """
    if assistant_mode != "preset" or not locked_lane:
        return False
    if not any(is_image_attachment(attachment) for attachment in attachments):
        return False
    return _sandbox_creation_request(text) or wants_sandbox_example(text)


def _reference_style_prompt_only_request(text: str, attachments: list[dict]) -> bool:
    """Route "turn this image into a prompt" through reference analysis.

    Prompt recall asks for a prompt already present in the workflow. Prompt-only
    analysis asks the assistant to read attached image refs and compile a fresh
    generation prompt without creating a workflow or preset.
    """

    if not any(is_image_attachment(attachment) for attachment in attachments):
        return False
    normalized = " ".join(str(text or "").lower().strip().split())
    if "prompt" not in normalized:
        return False
    if "preset" in normalized or "workflow" in normalized or "test graph" in normalized:
        return False
    if any(term in normalized for term in ("what prompt", "prompt you used", "prompt that you used", "current prompt", "draft preset prompt")):
        return False
    return bool(
        re.search(r"\b(analy[sz]e|look at|read|study|break down|turn|convert|make|create|generate|write|give me)\b.{0,100}\b(prompt|gpt image|nano banana)\b", normalized)
        or re.search(r"\b(prompt|gpt image|nano banana)\b.{0,80}\b(from|out of|for)\b.{0,40}\b(this|the|attached|reference)\b", normalized)
    )


def _ambiguous_action_request(text: str) -> bool:
    normalized = " ".join(text.lower().strip().split())
    return normalized in {"do it", "go ahead", "go for it", "ok do it", "okay do it", "yes do it", "let's do it", "lets do it"}


def _sandbox_creation_request(text: str) -> bool:
    normalized = " ".join(text.lower().strip().split())
    if not normalized:
        return False
    if re.search(
        r"\b(?:ask|question|confirm|confirmation|suggest|guide)\b.{0,100}\bbefore\b.{0,100}\b(?:create|creating|build|building|make|making|prepare|preparing)\b.{0,100}\b(?:test graph|test workflow|sandbox|workflow)\b",
        normalized,
    ):
        return False
    if (
        re.search(r"\b(not|don't|dont|do not)\s+(create|build|make|prepare|start|generate)\b.{0,60}\bsandbox\b", normalized)
        or re.search(r"\bwithout\s+(creating|building|making|preparing|starting|generating)\b.{0,60}\bsandbox\b", normalized)
    ):
        return False
    if (
        ("guide me" in normalized or "short question" in normalized or "questions first" in normalized)
        and re.search(r"\bbefore\b.{0,80}\b(create|creating|build|building|make|making)\b.{0,80}\b(test graph|sandbox|workflow)\b", normalized)
    ):
        return False
    if (
        "preset" in normalized
        and (
            any(term in normalized for term in ("approved sandbox", "sandbox result", "approved result"))
            or re.search(r"\bapproved\b.{0,50}\bsandbox\b", normalized)
            or re.search(r"\bapproved\b.{0,50}\btest workflow\b", normalized)
            or re.search(r"\bfrom\b.{0,40}\b(this|the)\b.{0,20}\bsandbox\b", normalized)
            or re.search(r"\b(this|the)\b.{0,30}\btest workflow\b.{0,60}\bas\b.{0,20}\bpreset\b", normalized)
        )
        and any(term in normalized for term in ("create", "save", "make", "turn"))
        and any(term in normalized for term in ("actual", "approved", "official", "thumbnail", "thumb", "now", "looks good", "close enough", "last generated"))
    ):
        return False
    if "temporary" in normalized and any(term in normalized for term in ("sandbox", "test graph", "test workflow", "workflow", "image to image", "text to image")):
        return True
    if any(term in normalized for term in ("test graph", "test workflow", "example graph", "example workflow", "sandbox graph", "temporary sandbox")):
        return True
    return bool(re.search(r"\b(create|build|make)\b.+\b(sandbox|test workflow)\b", normalized))


def _preset_save_request(text: str) -> bool:
    lowered = text.lower()
    if _sandbox_creation_request(text):
        return False
    if _save_request_is_negated(lowered):
        return False
    if re.search(r"\bnot\b.{0,30}\b(?:media\s+)?presets?\b", lowered):
        return False
    graph_context = any(
        term in lowered
        for term in (
            "graph",
            "workflow",
            "node",
            "nodes",
            "storyboard",
            "story board",
            "save image",
            "gpt image 2",
        )
    )
    if graph_context and "preset" not in lowered:
        return False
    preset_context = (
        "preset" in lowered
        or "contract" in lowered
        or "image to image" in lowered
        or "image-to-image" in lowered
        or "text to image" in lowered
        or "text-to-image" in lowered
    )
    approval_or_result_context = any(
        re.search(rf"\b{re.escape(term)}\b", lowered)
        for term in (
            "actual",
            "approved",
            "thumbnail",
            "thumb",
            "this is great",
            "looks good",
            "now",
            "generated output",
            "based upon this",
            "based on this",
        )
    )
    return (
        ("create" in lowered or "save" in lowered or "make" in lowered or "turn" in lowered)
        and preset_context
        and approval_or_result_context
    )


def _recipe_save_request(text: str) -> bool:
    lowered = text.lower()
    if _sandbox_creation_request(text):
        return False
    if _save_request_is_negated(lowered):
        return False
    return (
        ("create" in lowered or "save" in lowered or "make" in lowered or "turn" in lowered)
        and ("recipe" in lowered or "prompt recipe" in lowered)
        and any(term in lowered for term in ("actual", "approved", "thumbnail", "thumb", "this is great", "looks good", "now", "based upon this", "based on this"))
    )


def _save_request_is_negated(lowered_text: str) -> bool:
    normalized = " ".join(str(lowered_text or "").split())
    return bool(
        re.search(
            r"\b(?:do not|don't|dont|not|no|without|before)\s+(?:auto[- ]?)?(?:save|saving|saved|create the preset|creating the preset)\b",
            normalized,
        )
        or re.search(r"\b(?:do not|don't|dont|not|no|without|before)\b.{0,120}\b(?:save|saving|saved)\b", normalized)
        or re.search(r"\b(?:save|saving|create the preset|creating the preset)\s+(?:yet|later|after)\b", normalized)
        or "not save-ready" in normalized
        or "not save ready" in normalized
    )


def _comparison_question_context(text: str) -> bool:
    lowered = text.lower()
    has_compare_word = "compare" in lowered
    if not has_compare_word and (_preset_save_request(text) or _recipe_save_request(text)):
        return False
    if not any(term in lowered for term in ("compare", "current output", "latest output", "newest output", "last output", "new output", "result", "generated")):
        return False
    if has_compare_word and any(term in lowered for term in ("current output", "latest output", "newest output", "last output", "new output", "result", "generated")):
        return True
    return any(term in lowered for term in ("ref", "reference", "style", "closer", "match", "missing", "push", "adjust", "tweak", "refine"))


def _output_comparison_request(text: str) -> bool:
    return _comparison_question_context(text)


def _compact_output_compare_reply(provider_text: str, *, output_check: Any | None = None) -> str:
    if output_check is not None:
        def _without_label(value: str) -> str:
            text = re.sub(
                r"^\s*(matches?|what matches|missing|what is missing(?:\s+or\s+drifting)?|improve|prompt tweak|best prompt update|next prompt change|prompt delta|next change|refine once(?:\s+or\s+save)?)\s*:\s*",
                "",
                str(value or "").strip(" -\t"),
                flags=re.IGNORECASE,
            ).strip()
            text = re.sub(
                r"\s*;\s*(recommendation|what is missing(?:\s+or\s+drifting)?|prompt tweak|best prompt update|next prompt change|prompt delta|next change|refine once(?:\s+or\s+save)?)\s*:\s*",
                "; ",
                text,
                flags=re.IGNORECASE,
            ).strip(" ;")
            return text

        def _clip(value: str, limit: int = 420) -> str:
            text = " ".join(str(value or "").split())
            if len(text) <= limit:
                return text
            candidate = text[:limit]
            for marker in (". ", "; ", ", "):
                index = candidate.rfind(marker)
                if index >= 160:
                    return candidate[: index + len(marker.rstrip())].rstrip()
            return candidate.rstrip()

        def _sentence(value: str) -> str:
            text = _clip(value).rstrip()
            if not text or text.endswith((".", "!", "?")):
                return text
            return f"{text}."

        def _is_save_ready_positive(value: str) -> bool:
            text = " ".join(str(value or "").lower().split())
            return any(
                term in text
                for term in (
                    "good enough",
                    "save-ready",
                    "save ready",
                    "final signoff",
                    "verdict: good",
                    "one last polish",
                )
            )

        save_ready = str(getattr(output_check, "next_action", "") or "") == "save_preset"
        match_summary = _without_label(str(getattr(output_check, "match_summary", "") or ""))
        missing_items = getattr(output_check, "missing_traits", []) or []
        missing_text = _without_label(str(missing_items[0] if missing_items else ""))
        if save_ready and _is_save_ready_positive(missing_text):
            missing_text = ""
        explicit_next_change = next(
            (
                _without_label(str(item))
                for item in missing_items
                if "next prompt" in str(item).lower() or "next change" in str(item).lower()
            ),
            "",
        )
        next_change = explicit_next_change
        if not next_change:
            next_change = _without_label(str(getattr(output_check, "prompt_delta", "") or ""))
        if next_change.lower().startswith("ask the user"):
            next_change = ""
        if save_ready and _is_save_ready_positive(next_change):
            next_change = ""
        if next_change and not explicit_next_change:
            next_change = _without_label(next_change)
        if "concrete visual traits" in match_summary.lower() and not missing_text and not next_change:
            return "\n".join(
                [
                    "I could not produce a usable visual comparison yet.",
                    "- Missing: the comparison response only returned a score or generic verdict, not concrete visible traits.",
                    "- Next: retry the comparison with trait-specific matches and misses before spending another refinement run.",
                    "Want me to retry the comparison, or save based on your visual approval?",
                ]
            )
        bullets: list[str] = []
        if match_summary:
            bullets.append(f"Matches: {_clip(match_summary)}")
        if missing_text:
            bullets.append(f"Improve: {_clip(missing_text)}")
        if next_change:
            bullets.append(f"Prompt tweak: {_sentence(next_change)}")
        if bullets:
            positive_but_tweakable = _is_save_ready_positive(match_summary) and next_change
            closing = (
                "If you like this result, I can save it as the Media Preset."
                if save_ready
                else "If you like this result, I can save it as the Media Preset."
                if positive_but_tweakable
                else "Want me to save it, or run one more refinement?"
                if str(getattr(output_check, "next_action", "") or "") == "ask_user"
                else "Want me to update the prompt and run one more test?"
            )
            return "\n".join(["I compared the latest output against the attached refs.", *[f"- {bullet}" for bullet in bullets[:3]], closing])

    cleaned_lines: list[str] = []
    for line in provider_text.splitlines():
        cleaned = line.strip(" -\t")
        if not cleaned:
            continue
        if len(cleaned) > 260:
            cleaned_lines.extend(part.strip(" -\t") for part in re.split(r"(?<=[.!?])\s+", cleaned) if part.strip())
        else:
            cleaned_lines.append(cleaned)
    lowered = provider_text.lower()
    bullets = [
        line
        for line in cleaned_lines
        if len(line) <= 260
        and not line.lower().startswith(("prompt", "```", "want a reviewable", "do you want", "i can prepare", "apply it"))
    ][:3]
    if not bullets:
        bullets = [
            "the latest output is usable, but the reference style needs to be weighted harder",
            "the next step should be a focused test prompt update, not a saved preset yet",
        ]
    return "\n".join(
        [
            "I compared the latest output against the attached refs.",
            *[f"- {bullet}" for bullet in bullets[:2]],
            (
                "If you approve it, tell me to create the Media Preset from this result."
                if "good enough" in lowered or "ready to save" in lowered or "create the preset" in lowered
                else "I can update the prompt now. Review the change, then test it again."
            ),
        ]
    )


def _sandbox_refinement_chat_text(text: str, workflow: Optional[GraphWorkflow]) -> str | None:
    if not workflow:
        return None
    candidate = plan_graph_from_message(text, workflow, [])
    if not any(operation.op == "set_node_field" for operation in candidate.operations):
        return None
    lowered = text.lower()
    missing: list[str] = []
    if "element" in lowered or "missing" in lowered:
        missing.append("some reference details are still underweighted")
    if "style" in lowered or "closer" in lowered:
        missing.append("the reference style needs to be weighted more strongly")
    if "proportion" in lowered or "scale" in lowered:
        missing.append("the subject proportions and silhouette need clearer direction")
    if "era" in lowered or "year" in lowered or "period" in lowered:
        missing.append("the time-period details need to read more explicitly")
    if "fashion" in lowered or "photo" in lowered:
        missing.append("it should move further away from fashion-photo realism")
    if not missing:
        missing.append("the draft prompt can be tightened before the next test run")
    return (
        "I agree it is close, but not locked yet.\n"
        f"- {missing[0]}\n"
        "- I can update the Draft preset prompt in this workflow without running or saving anything.\n"
        "I can prepare that prompt update now; add it when it looks right."
    )


def _deterministic_chat_text(
    text: str,
    workflow: Optional[GraphWorkflow],
    attachments: Optional[list[dict]] = None,
    *,
    latest_run_available: bool = False,
    message_history: list[dict] | None = None,
) -> tuple[str, dict] | None:
    if latest_run_available and _output_comparison_request(text):
        return None
    if is_story_project_request(text):
        return None
    if workflow and is_full_prompt_request(text) and (not is_story_project_request(text) or _character_sheet_prompt_lookup_request(text)):
        prompt_text = _workflow_draft_preset_prompt_text(workflow)
        if prompt_text:
            return (
                f"Here is the current graph prompt:\n\n```text\n{prompt_text}\n```",
                {"mode": "deterministic_current_prompt", "suggested_action": "answer_question"},
            )
        return (
            "I do not see a graph prompt yet. Create the graph first, then ask me for the prompt.",
            {"mode": "deterministic_current_prompt_missing", "suggested_action": "clarify"},
        )
    if _preset_save_request(text):
        return (
            "I can save the approved Media Preset directly from Graph Studio. I will validate it first, refresh the graph catalog after save, and keep the editor page optional.",
            {"mode": "deterministic_preset_save_request", "suggested_action": "save_media_preset"},
        )
    if _recipe_save_request(text):
        return (
            "I can save the approved Prompt Recipe directly from Graph Studio. I will validate it first, refresh the graph catalog after save, and keep the editor page optional.",
            {"mode": "deterministic_recipe_save_request", "suggested_action": "save_prompt_recipe"},
        )
    if _wants_prior_style_context(text) and any(term in text.lower() for term in ("update", "refine", "adjust", "apply")):
        refinement_text = _sandbox_refinement_chat_text(text, workflow)
        if not refinement_text:
            refinement_text = (
                "I can prepare a prompt update for the current test graph. "
                "Add it when it looks right, then run the graph again."
            )
        return refinement_text, {"mode": "deterministic_preset_sandbox_refinement", "suggested_action": "create_graph_plan"}
    saved_preset_candidate = plan_graph_from_message(
        text,
        workflow or GraphWorkflow(name="Assistant graph", nodes=[], edges=[]),
        attachments or [],
    )
    if any(operation.node_type == "preset.render" for operation in saved_preset_candidate.operations):
        return (
            "I will prepare a saved Media Preset test graph using the exact preset key/id you provided. It will not run until you approve it.",
            {"mode": "deterministic_saved_preset_workflow_request", "suggested_action": "create_graph_plan"},
        )
    if _sandbox_creation_request(text):
        return (
            "I will create the test graph now. It will not run or save a preset until you choose that.",
            {"mode": "deterministic_preset_sandbox_request", "suggested_action": "create_graph_plan"},
        )
    refinement_text = _sandbox_refinement_chat_text(text, workflow)
    if refinement_text:
        return refinement_text, {"mode": "deterministic_preset_sandbox_refinement", "suggested_action": "create_graph_plan"}
    if test_run_request(text) and not is_reference_preset_request(text, attachments or []):
        return deterministic_run_request_reply(text, workflow, message_history or [])
    if _ambiguous_action_request(text):
        return (
            "Do you want me to run the current graph, or create the Media Preset draft from the approved result? Reply with `run it` or `create the preset`.",
            {"mode": "deterministic_clarify_action", "suggested_action": "clarify"},
        )
    return None


def _save_signature(kind: str, payload: AssistantDraftCreateRequest) -> str:
    workflow_id = payload.workflow.workflow_id if payload.workflow else None
    raw = json.dumps(
        {
            "kind": kind,
            "message": payload.message.strip(),
            "run_id": payload.run_id,
            "workflow_id": workflow_id,
            "assistant_mode": payload.assistant_mode,
        },
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _saved_artifact_from_session(session_id: str, *, kind: str, signature: str) -> dict[str, Any] | None:
    for message in reversed(store_assistant.list_assistant_messages(session_id)):
        payload = message.get("content_json") if isinstance(message.get("content_json"), dict) else {}
        if payload.get("save_signature") != signature:
            continue
        artifact = payload.get("saved_artifact") if isinstance(payload.get("saved_artifact"), dict) else {}
        if artifact.get("kind") != kind:
            continue
        artifact_id = str(artifact.get("id") or "")
        if kind == "media_preset" and artifact_id:
            return store.get_preset(artifact_id)
        if kind == "prompt_recipe" and artifact_id:
            return store.get_prompt_recipe(artifact_id)
    return None


def _record_saved_artifact(
    session_id: str,
    *,
    kind: str,
    capability: str,
    record: dict[str, Any],
    created: bool,
    signature: str,
) -> dict[str, Any]:
    if kind == "media_preset":
        label = str(record.get("label") or "Media Preset")
        artifact_id = str(record.get("preset_id") or "")
        artifact_key = str(record.get("key") or "")
        activity_kind = "media_preset_saved"
        content_text = f"Saved Media Preset: {label}."
    else:
        label = str(record.get("label") or "Prompt Recipe")
        artifact_id = str(record.get("recipe_id") or "")
        artifact_key = str(record.get("key") or "")
        activity_kind = "prompt_recipe_saved"
        content_text = f"Saved Prompt Recipe: {label}."
    if kind == "media_preset" and artifact_id:
        session = store_assistant.get_assistant_session(session_id)
        if session:
            summary_json = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
            builder_state = dict(summary_json.get("media_preset_builder") or {})
            variants = [variant for variant in builder_state.get("preset_variants", []) if isinstance(variant, dict)]
            variant = {"preset_id": artifact_id, "key": artifact_key, "label": label}
            variants = [item for item in variants if item.get("preset_id") != artifact_id and item.get("key") != artifact_key]
            variants.append(variant)
            builder_state = {
                **builder_state,
                "skill": "create_media_preset",
                "status": "saved",
                "latest_saved_preset_id": artifact_id,
                "preset_variants": variants[-6:],
            }
            store_assistant.create_or_update_assistant_session({**session, "summary_json": {**summary_json, "media_preset_builder": builder_state}})
    return store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "system_summary",
            "content_text": content_text,
            "content_json": {
                "activity_kind": activity_kind,
                "capability": capability,
                "created": created,
                "save_signature": signature,
                "saved_artifact": {
                    "kind": kind,
                    "id": artifact_id,
                    "key": artifact_key,
                    "label": label,
                },
            },
        }
    )


def _recipe_draft_message_for_save(message: str) -> str:
    cleaned = " ".join(str(message or "").split()).strip(" .")
    cleaned = re.sub(r"^(save|create|make|turn)\s+(this\s+)?(approved\s+)?", "", cleaned, flags=re.IGNORECASE).strip(" .")
    cleaned = re.sub(r"\s+(now|based on this|based upon this)$", "", cleaned, flags=re.IGNORECASE).strip(" .")
    if cleaned and cleaned == cleaned.lower():
        cleaned = cleaned.title()
    return cleaned or message


def _first_prompt_text(workflow: GraphWorkflow | None) -> str:
    if not workflow:
        return ""
    draft_prompt = ""
    first_prompt = ""
    for node in workflow.nodes:
        if node.type != "prompt.text":
            continue
        text = str((node.fields or {}).get("text") or "").strip()
        if not text:
            continue
        if not first_prompt:
            first_prompt = text
        metadata = node.metadata if isinstance(node.metadata, dict) else {}
        ui = metadata.get("ui") if isinstance(metadata.get("ui"), dict) else {}
        if str(ui.get("customTitle") or "").strip().lower() == "draft preset prompt":
            draft_prompt = text
            break
    return draft_prompt or first_prompt


def _preset_draft_message_for_save(message: str, workflow: GraphWorkflow | None) -> str:
    normalized = " ".join(str(message or "").lower().split())
    generic_save = normalized in {
        "save preset",
        "save preset now",
        "save this preset",
        "save this preset now",
        "create preset",
        "create preset now",
        "create this preset",
        "create this preset now",
    } or (_preset_save_request(message) and not re.search(r"\bcalled\b", normalized))
    if not generic_save:
        return message
    prompt_text = _first_prompt_text(workflow)
    if not prompt_text:
        return message
    title_match = re.match(r"^\s*([^:.\n]{4,80})\s*:", prompt_text)
    if not title_match:
        return message
    title = " ".join(title_match.group(1).split()).strip(" .,\"'")
    if not title or title.lower().startswith(("create ", "make ", "generate ", "use ")):
        return message
    return f"Create a Media Preset called {title}. {prompt_text[:180]} media preset"


def _deterministic_graph_plan_candidate(
    message: str,
    workflow: GraphWorkflow,
    attachments: list[dict],
    *,
    latest_run: dict | None = None,
    assistant_mode: str | None = None,
) -> AssistantGraphPlan | None:
    candidate = plan_graph_from_message(message, workflow, attachments, latest_run=latest_run)
    if candidate.capability != "plan_graph":
        return None
    if is_reference_preset_request(message, attachments) and wants_sandbox_example(message):
        return candidate
    lowered = " ".join(str(message or "").lower().split())
    if wants_sandbox_example(message) and any(
        term in lowered
        for term in (
            "extracted text style prompt",
            "extract the attached reference",
            "do not use the style reference image as a runtime image input",
            "without requiring the style reference image",
        )
    ):
        return candidate
    if any(operation.op == "set_node_field" for operation in candidate.operations):
        return candidate
    if any(operation.node_type == "preset.render" for operation in candidate.operations):
        return candidate
    node_types = {operation.node_type for operation in candidate.operations if operation.op == "add_node" and operation.node_type}
    has_image_model = any(node_type.startswith("model.") for node_type in node_types)
    has_common_output_chain = {"prompt.text", "preview.image", "media.save_image"}.issubset(node_types)
    if assistant_mode in {"graph", "preset"} and has_image_model and has_common_output_chain:
        return candidate
    return None


def _recent_user_message_context(message_history: list[dict[str, Any]] | None, current_text: str, *, limit: int = 5) -> str:
    values: list[str] = []
    for item in (message_history or [])[-limit:]:
        if item.get("role") != "user":
            continue
        text = " ".join(str(item.get("content_text") or "").split()).strip()
        if text and text not in values:
            values.append(text)
    current = " ".join(str(current_text or "").split()).strip()
    if current and current not in values:
        values.append(current)
    return "\n\n".join(values[-limit:])


def _character_sheet_plan_reply(graph_plan: AssistantGraphPlan) -> str:
    metadata = graph_plan.metadata if isinstance(graph_plan.metadata, dict) else {}
    raw_labels = metadata.get("variant_labels")
    labels = [str(label).strip() for label in raw_labels if str(label).strip()] if isinstance(raw_labels, list) else []
    if not labels:
        label = str(metadata.get("variant_label") or "").strip()
        labels = [label] if label else ["Variant 1"]

    raw_roles = metadata.get("reference_roles")
    role_lines: list[str] = []
    if isinstance(raw_roles, list):
        for item in raw_roles:
            if not isinstance(item, dict):
                continue
            reference_number = item.get("reference_number")
            role_label = str(item.get("role_label") or "").strip()
            if reference_number and role_label:
                role_lines.append(f"- Image reference {reference_number}: {role_label}")

    if len(labels) == 1:
        label_text = f"Character Sheet {labels[0]}"
    else:
        label_text = f"Character Sheet variants {', '.join(labels)}"
    branch_word = "branches" if len(labels) != 1 else "branch"
    lines = [
        f"I can build {label_text} as a local Character Sheet {branch_word}.",
    ]
    if role_lines:
        lines.extend(["", "Reference mapping:", *role_lines])
    lines.extend(["", "It will stay local for review. Add it only if the mapping and layout look right."])
    return "\n".join(lines)


def _character_sheet_plan_metadata(graph_plan: AssistantGraphPlan) -> dict[str, Any]:
    metadata = graph_plan.metadata if isinstance(graph_plan.metadata, dict) else {}
    return {
        "template_id": metadata.get("template_id"),
        "background_mode": metadata.get("background_mode"),
        "variant_label": metadata.get("variant_label"),
        "variant_count": metadata.get("variant_count"),
        "variant_labels": metadata.get("variant_labels"),
        "reference_roles": metadata.get("reference_roles"),
    }


def _deterministic_graph_mode_chat_text(
    text: str,
    workflow: Optional[GraphWorkflow],
    attachments: list[dict],
    *,
    assistant_mode: str | None,
    canvas_context: dict[str, Any] | None = None,
    latest_run: dict | None = None,
    message_history: list[dict[str, Any]] | None = None,
) -> tuple[str, dict] | None:
    if assistant_mode != "graph" or not workflow:
        return None
    selected_node_candidate = selected_node_field_edit_plan_from_context(text, workflow, canvas_context)
    if selected_node_candidate:
        if selected_node_candidate.operations:
            return (
                f"{selected_node_candidate.summary}\n\nIt stayed local: no run, save, or provider action happened.",
                {
                    "mode": "deterministic_selected_node_field_edit",
                    "suggested_action": "create_graph_plan",
                    "target_node_id": selected_node_candidate.metadata.get("target_node_id"),
                    "target_field": selected_node_candidate.metadata.get("target_field"),
                    "field_keys": selected_node_candidate.metadata.get("field_keys"),
                },
            )
        return (
            selected_node_candidate.summary,
            {
                "mode": "deterministic_selected_node_field_edit",
                "suggested_action": "create_graph_plan",
                "questions": selected_node_candidate.questions,
            },
        )
    if latest_run and _output_comparison_request(text):
        return None
    if _local_create_negated(text):
        return None
    character_sheet_candidate = character_sheet_graph_plan_from_workflow_request(
        text,
        workflow,
        context_message=_recent_user_message_context(message_history, text),
        canvas_context=canvas_context,
        attachments=attachments,
    )
    if character_sheet_candidate:
        if character_sheet_candidate.operations:
            return (
                _character_sheet_plan_reply(character_sheet_candidate),
                {
                    "mode": "deterministic_character_sheet_graph_request",
                    "suggested_action": "create_graph_plan",
                    **_character_sheet_plan_metadata(character_sheet_candidate),
                },
            )
        return (
            "I need one reference-role check before I build that Character Sheet graph.",
            {
                "mode": "deterministic_character_sheet_graph_request",
                "suggested_action": "create_graph_plan",
                "questions": character_sheet_candidate.questions,
            },
        )
    if is_story_project_request(text):
        return None
    candidate = _deterministic_graph_plan_candidate(
        text,
        workflow,
        attachments,
        latest_run=latest_run,
        assistant_mode=assistant_mode,
    )
    if not candidate or not candidate.operations:
        return None
    return (
        "I can build that graph. Check the layout, then add it if it looks right.",
        {
            "mode": "deterministic_graph_mode_plan_request",
            "suggested_action": "create_graph_plan",
        },
    )


def _is_preset_sandbox_plan(graph_plan: AssistantGraphPlan) -> bool:
    summary = str(graph_plan.summary or "").lower()
    if "sandbox" in summary and "preset" in summary:
        return True
    return any("actual " in str(warning).lower() and "image before running" in str(warning).lower() for warning in graph_plan.warnings)


def _is_storyboard_stills_plan(graph_plan: AssistantGraphPlan) -> bool:
    metadata = graph_plan.metadata if isinstance(graph_plan.metadata, dict) else {}
    return str(metadata.get("template_id") or "") == "story_gpt_image_2_storyboard_stills_v1"


def _allows_pending_user_input_apply(validation: GraphValidationResult, graph_plan: AssistantGraphPlan) -> bool:
    allows_pending_media = _is_preset_sandbox_plan(graph_plan) or _is_storyboard_stills_plan(graph_plan)
    if validation.valid or not allows_pending_media:
        return False
    allowed_codes = {"missing_media_reference", "missing_required_input"}
    for error in validation.errors:
        code = str(error.code or "")
        if code not in allowed_codes:
            return False
        if _is_storyboard_stills_plan(graph_plan) and code != "missing_media_reference":
            return False
        if code == "missing_required_input" and str(error.port_id or "") != "image_refs":
            return False
    return bool(validation.errors)


def _review_url(path: str, *, session_id: str, message_id: str) -> str:
    return f"{path}?assistantSession={session_id}&assistantMessage={message_id}"


def _compact_reference_style_contract(proposal: dict | None, attachments: list[dict]) -> dict[str, Any] | None:
    if not proposal:
        return None
    contract = proposal.get("preset_contract") if isinstance(proposal.get("preset_contract"), dict) else {}
    summary = proposal.get("visual_summary") if isinstance(proposal.get("visual_summary"), dict) else {}
    attachment_refs = [
        {
            "reference_id": str(attachment.get("reference_id") or ""),
            "label": str(attachment.get("label") or ""),
        }
        for attachment in attachments
        if is_image_attachment(attachment) and str(attachment.get("reference_id") or "").strip()
    ]
    return {
        "title": str(proposal.get("title") or "Reference Style Preset"),
        "reference_role": str(proposal.get("reference_role") or "inspiration"),
        "style": str(summary.get("style") or ""),
        "fixed_ingredients": [str(item) for item in (summary.get("fixed_ingredients") or [])[:6]],
        "variable_ingredients": [str(item) for item in (summary.get("variable_ingredients") or [])[:6]],
        "image_slots": [
            {
                "key": str(slot.get("key") or ""),
                "label": str(slot.get("label") or slot.get("key") or ""),
                "required": bool(slot.get("required")),
            }
            for slot in (contract.get("image_slots") or [])[:4]
            if isinstance(slot, dict)
        ],
        "fields": [
            {
                "key": str(field.get("key") or ""),
                "label": str(field.get("label") or field.get("key") or ""),
                "required": bool(field.get("required")),
            }
            for field in (contract.get("fields") or [])[:6]
            if isinstance(field, dict)
        ],
        "attachment_refs": attachment_refs[:ASSISTANT_IMAGE_ATTACHMENT_LIMIT],
    }


def _reference_style_contract_from_brief(brief: Any, attachments: list[dict]) -> dict[str, Any] | None:
    """Build the active workflow contract from the structured style brief.

    The style brief is the source of truth for prompt compilation. Using it
    here keeps prompt-quality scoring aligned with the actual workflow prompt,
    even when an older compact proposal contract remains in the session summary.
    """

    if not brief or not has_concrete_style_traits(brief):
        return None
    attachment_refs = [
        {
            "reference_id": str(attachment.get("reference_id") or ""),
            "label": str(attachment.get("label") or ""),
        }
        for attachment in attachments
        if is_image_attachment(attachment) and str(attachment.get("reference_id") or "").strip()
    ]
    fields = [
        {
            "key": field.key,
            "label": field.label,
            "required": field.required,
        }
        for field in brief.preset_contract.fields
    ]
    image_slots = [
        {
            "key": slot.key,
            "label": slot.label,
            "required": slot.required,
        }
        for slot in brief.preset_contract.image_slots
    ]
    return {
        "title": brief.preset_direction.title,
        "reference_role": "mixed" if image_slots else "inspiration",
        "style": brief.preset_direction.one_line_summary,
        "fixed_ingredients": [str(item) for item in (brief.fixed_style_traits or [])[:6]],
        "variable_ingredients": [field["label"] for field in fields[:6]],
        "image_slots": image_slots[:4],
        "fields": fields[:6],
        "attachment_refs": attachment_refs[:ASSISTANT_IMAGE_ATTACHMENT_LIMIT],
    }


def _wants_prior_style_context(message: str) -> bool:
    text = " ".join(str(message or "").lower().split())
    return any(term in text for term in ("update", "refine", "adjust", "push", "closer", "match", "style", "extracted")) and any(
        term in text for term in ("draft preset prompt", "sandbox prompt", "prompt", "style details", "inferred", "prior assistant style analysis", "prior assistant reference-style analysis")
    )


def _latest_reference_style_analysis(messages: list[dict]) -> str:
    for item in reversed(messages):
        if item.get("role") != "assistant":
            continue
        content_json = item.get("content_json") if isinstance(item.get("content_json"), dict) else {}
        if not content_json.get("preset_builder_proposal"):
            continue
        text = " ".join(str(item.get("content_text") or "").split())
        if not text:
            continue
        lowered = text.lower()
        if (
            "likely preset" not in lowered
            and "proposed image inputs" not in lowered
            and "extract the look" not in lowered
            and "style references are analyzed" not in lowered
            and "analysis-only style sources" not in lowered
            and "style-driven media preset" not in lowered
            and "style reference" not in lowered
        ):
            continue
        return text[:900]
    return ""


def _latest_reference_style_title(messages: list[dict]) -> str:
    analysis = _latest_reference_style_analysis(messages)
    if not analysis:
        return ""
    match = re.search(r"likely preset:\s*`([^`]{4,90})`", analysis, flags=re.IGNORECASE)
    if not match:
        match = re.search(r"likely preset:\s*([^.\n]{4,90})", analysis, flags=re.IGNORECASE)
    if not match:
        return ""
    return " ".join(match.group(1).split()).strip(" .,\"'")


def _latest_output_comparison_summary(messages: list[dict], run_id: str | None) -> str:
    for item in reversed(messages):
        if item.get("role") != "assistant":
            continue
        content_json = item.get("content_json") if isinstance(item.get("content_json"), dict) else {}
        if not content_json.get("output_aware"):
            continue
        if run_id and content_json.get("latest_run_id") and content_json.get("latest_run_id") != run_id:
            continue
        text = str(item.get("content_text") or "").strip()
        if not text:
            continue
        lines = [line.strip(" -\t") for line in text.splitlines() if line.strip(" -\t")]
        useful = [
            line
            for line in lines
            if not line.lower().startswith(("i compared", "i can prepare", "apply it"))
        ][:3]
        return "\n".join(useful)[:700]
    return ""


def _effective_preset_save_run_id(payload_run_id: str | None, summary_json: dict) -> str | None:
    run_id = str(payload_run_id or "").strip()
    if run_id:
        return run_id
    builder_state = summary_json.get("media_preset_builder") if isinstance(summary_json.get("media_preset_builder"), dict) else {}
    for key in ("latest_output_run_id", "latest_run_id"):
        candidate = str(builder_state.get(key) or "").strip()
        if candidate:
            return candidate
    output_check = builder_state.get("latest_output_check") if isinstance(builder_state.get("latest_output_check"), dict) else {}
    candidate = str(output_check.get("latest_run_id") or "").strip()
    return candidate or None


def _latest_image_output_asset_id(latest_run: dict | None) -> str:
    if not isinstance(latest_run, dict):
        return ""
    artifacts = latest_run.get("artifacts")
    if not isinstance(artifacts, list):
        return ""
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        asset_id = str(artifact.get("asset_id") or "").strip()
        if not asset_id:
            continue
        media_type = str(artifact.get("media_type") or artifact.get("kind") or "").lower()
        if media_type in {"", "image"}:
            return asset_id
    return ""


@router.post("/sessions", response_model=AssistantSession)
def create_session(payload: AssistantSessionCreateRequest) -> AssistantSession:
    workflow_snapshot = payload.workflow.model_dump(mode="json") if payload.workflow else {}
    record = store_assistant.create_or_update_assistant_session(
        {
            "owner_kind": payload.owner_kind,
            "owner_id": payload.owner_id,
            "provider_kind": payload.provider_kind,
            "provider_model_id": payload.provider_model_id,
            "title": payload.title or "Media assistant",
            "state_snapshot_json": {"workflow": workflow_snapshot} if workflow_snapshot else {},
        }
    )
    return _shape_session(record)


@router.get("/sessions", response_model=AssistantSessionListResponse)
def list_sessions(
    owner_kind: Optional[str] = Query(default=None),
    owner_id: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
) -> AssistantSessionListResponse:
    return AssistantSessionListResponse(
        items=[_shape_session(item) for item in store_assistant.list_assistant_sessions(owner_kind=owner_kind, owner_id=owner_id, limit=limit)]
    )


@router.get("/sessions/{session_id}", response_model=AssistantSession)
def get_session(session_id: str) -> AssistantSession:
    record = store_assistant.get_assistant_session(session_id)
    if not record:
        raise _not_found("assistant session")
    return _shape_session(record)


@router.get("/sessions/{session_id}/debug-trace")
def get_session_debug_trace(session_id: str) -> dict[str, Any]:
    record = store_assistant.get_assistant_session(session_id)
    if not record:
        raise _not_found("assistant session")
    messages = store_assistant.list_assistant_messages(session_id)
    usage_rows = store_assistant.list_assistant_turn_usage(session_id)
    trace_items: list[dict[str, Any]] = []
    for usage in usage_rows:
        usage_json = usage.get("usage_json") if isinstance(usage.get("usage_json"), dict) else {}
        skill_trace = usage_json.get("skill_trace") if isinstance(usage_json.get("skill_trace"), dict) else {}
        if skill_trace:
            trace_items.append(
                {
                    "assistant_turn_usage_id": usage.get("assistant_turn_usage_id"),
                    "created_at": usage.get("created_at"),
                    **sanitize_skill_trace(skill_trace),
                }
            )
    return {
        "assistant_session_id": session_id,
        "skill_manifests": assistant_skill_manifests(),
        "trace": trace_items,
        "turn_trace": [
            {
                "assistant_message_id": message.get("assistant_message_id"),
                "created_at": message.get("created_at"),
                **(
                    message.get("content_json", {}).get("assistant_turn_trace")
                    if isinstance(message.get("content_json"), dict)
                    and isinstance(message.get("content_json", {}).get("assistant_turn_trace"), dict)
                    else {}
                ),
            }
            for message in messages
            if message.get("role") == "assistant"
        ],
        "transcript_quality": audit_assistant_transcript(messages),
        "redacted_transcript": [
            {
                "assistant_message_id": message.get("assistant_message_id"),
                "role": message.get("role"),
                "content_text": str(message.get("content_text") or "")[:600],
                "assistant_turn_trace": (
                    message.get("content_json", {}).get("assistant_turn_trace")
                    if isinstance(message.get("content_json"), dict)
                    and isinstance(message.get("content_json", {}).get("assistant_turn_trace"), dict)
                    else None
                ),
                "created_at": message.get("created_at"),
            }
            for message in messages
        ],
    }


@router.post("/sessions/{session_id}/messages", response_model=AssistantSession)
def create_message(session_id: str, payload: AssistantMessageCreateRequest) -> AssistantSession:
    record = store_assistant.get_assistant_session(session_id)
    if not record:
        raise _not_found("assistant session")
    text = payload.content_text.strip()
    if not text:
        raise _bad_request("Message text is required.")
    attachments = store_assistant.list_assistant_attachments(session_id)
    attachment_counts = _attachment_counts(attachments)
    message_history = store_assistant.list_assistant_messages(session_id)
    summary_json = record.get("summary_json") if isinstance(record.get("summary_json"), dict) else {}
    state_snapshot_json = record.get("state_snapshot_json") if isinstance(record.get("state_snapshot_json"), dict) else {}
    intent_route = route_assistant_intent(text, attachments)
    if _should_keep_media_preset_builder_route(
        text,
        assistant_mode=payload.assistant_mode,
        summary_json=summary_json,
        attachments=attachments,
    ):
        intent_route = _media_preset_builder_followup_route(media_intent=bool(attachments))
    skill_manifest = manifest_for_legacy_skill_id(intent_route.skill.skill_id)
    preset_builder_proposal: dict | None = None
    context = build_assistant_context(payload.workflow, attachments, run_id=payload.run_id, canvas_context=payload.canvas_context)
    existing_story_project = _story_project_with_attachment_character_sheet(
        story_project_from_session(summary_json, state_snapshot_json),
        attachments,
    )
    if existing_story_project:
        context["story_project"] = existing_story_project
    context["assistant_intent"] = intent_route.to_dict()
    if payload.assistant_mode:
        context["assistant_mode"] = payload.assistant_mode
    latest_run = context.get("latest_graph_run") if isinstance(context.get("latest_graph_run"), dict) else None
    stored_builder_state = summary_json.get("media_preset_builder") if isinstance(summary_json.get("media_preset_builder"), dict) else {}
    stored_latest_output_asset_id = str(stored_builder_state.get("latest_output_asset_id") or "").strip()
    stored_latest_run_id = str(stored_builder_state.get("latest_output_run_id") or "").strip()
    latest_run_available = latest_run is not None or bool(stored_latest_output_asset_id)
    output_comparison = latest_run_available and _output_comparison_request(text)
    output_check = None
    skill_state_before = _media_preset_builder_status(summary_json)
    latest_output_asset_id = _latest_image_output_asset_id(latest_run) or stored_latest_output_asset_id
    latest_output_run_id = latest_run.get("run_id") if isinstance(latest_run, dict) else payload.run_id or stored_latest_run_id
    if latest_output_asset_id:
        builder_state = dict(summary_json.get("media_preset_builder") or {})
        if builder_state.get("skill") == "create_media_preset" or builder_state or payload.assistant_mode == "preset":
            builder_state = {
                **builder_state,
                "skill": "create_media_preset",
                "latest_output_asset_id": latest_output_asset_id,
                "latest_output_run_id": latest_output_run_id,
            }
            summary_json = {**summary_json, "media_preset_builder": builder_state}
            record = store_assistant.create_or_update_assistant_session({**record, "summary_json": summary_json})
    preset_loop_lane = preset_loop_start_lane_from_metadata(payload.metadata) or preset_loop_start_lane(text)
    if preset_loop_lane:
        summary_json = {
            **summary_json,
            "preset_loop": {
                "lane": preset_loop_lane,
                "locked": True,
                "source": "guided_loop_ui",
            },
        }
        record = store_assistant.create_or_update_assistant_session({**record, "summary_json": summary_json})
    locked_preset_loop_lane = preset_loop_lane_from_summary(summary_json)
    existing_reference_style_brief = _active_reference_style_brief_for_attachments(summary_json, attachments)
    cache_decision = "none"
    cache_reason = "no reusable style brief"
    if existing_reference_style_brief and has_concrete_style_traits(existing_reference_style_brief):
        cache_decision = "same_loop_reuse"
        cache_reason = "active session already has a concrete reference style brief"
    reference_style_prompt_only = _reference_style_prompt_only_request(text, attachments)
    context["assistant_prompt_route"] = (
        "story_project"
        if is_story_project_request(text)
        else _media_preset_prompt_route(
            text,
            attachments,
            assistant_mode=payload.assistant_mode,
            output_comparison=output_comparison,
            reference_style_prompt_only=reference_style_prompt_only,
        )
    )
    replacement_field_planning = context["assistant_prompt_route"] == "replacement_field_planning"
    image_slot_planning = context["assistant_prompt_route"] == "image_slot_planning"
    needs_reference_style_intake = (
        (reference_style_prompt_only or is_reference_preset_request(text, attachments) or _guided_reference_style_intake_request(
            text,
            attachments,
            assistant_mode=payload.assistant_mode,
            locked_lane=locked_preset_loop_lane,
        ))
        and any(is_image_attachment(attachment) for attachment in attachments)
        and not (existing_reference_style_brief and has_concrete_style_traits(existing_reference_style_brief))
    )
    requires_fresh_reference_analysis = needs_reference_style_intake or (
        payload.assistant_mode == "preset"
        and skill_manifest.skill_id == "media_preset_builder"
        and any(is_image_attachment(attachment) for attachment in attachments)
        and not (existing_reference_style_brief and has_concrete_style_traits(existing_reference_style_brief))
    )
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "user",
            "content_text": text,
            "content_json": {
                "attachment_ids": payload.attachment_ids,
                "context_node_count": len(context.get("node_catalog", [])),
                "intent_route": intent_route.to_dict(),
                "assistant_mode": payload.assistant_mode,
                "metadata": payload.metadata,
                "canvas_context_node_count": (context.get("canvas_context") or {}).get("node_count") if isinstance(context.get("canvas_context"), dict) else None,
                "preset_loop_lane": preset_loop_lane or locked_preset_loop_lane,
            },
        }
    )
    deterministic_run_reply = deterministic_run_request_reply(text, payload.workflow, message_history)
    if deterministic_run_reply:
        assistant_text, run_metadata = deterministic_run_reply
        store_assistant.create_assistant_message(
            {
                "assistant_session_id": session_id,
                "role": "assistant",
                "content_text": assistant_text,
                "content_json": _assistant_content_json(
                    {
                        **run_metadata,
                        "intent_route": intent_route.to_dict(),
                        "assistant_prompt_route": "workflow_run_confirmation",
                        "preset_loop_lane": preset_loop_lane or locked_preset_loop_lane,
                    },
                    assistant_text,
                ),
            }
        )
        return _shape_session(record)
    deterministic_canvas_reply = canvas_inventory_reply(text, context.get("canvas_context") if isinstance(context.get("canvas_context"), dict) else None)
    if deterministic_canvas_reply:
        assistant_text, canvas_metadata = deterministic_canvas_reply
        store_assistant.create_assistant_message(
            {
                "assistant_session_id": session_id,
                "role": "assistant",
                "content_text": assistant_text,
                "content_json": _assistant_content_json(
                    {
                        **canvas_metadata,
                        "intent_route": intent_route.to_dict(),
                        "assistant_prompt_route": "canvas_inventory",
                        "preset_loop_lane": preset_loop_lane or locked_preset_loop_lane,
                    },
                    assistant_text,
                ),
            }
        )
        return _shape_session(record)
    deterministic_preset_shape_reply = canvas_preset_shape_reply(text, context.get("canvas_context") if isinstance(context.get("canvas_context"), dict) else None)
    if deterministic_preset_shape_reply:
        assistant_text, preset_shape_metadata = deterministic_preset_shape_reply
        store_assistant.create_assistant_message(
            {
                "assistant_session_id": session_id,
                "role": "assistant",
                "content_text": assistant_text,
                "content_json": _assistant_content_json(
                    {
                        **preset_shape_metadata,
                        "intent_route": intent_route.to_dict(),
                        "assistant_prompt_route": "canvas_preset_shape",
                        "preset_loop_lane": preset_loop_lane or locked_preset_loop_lane,
                    },
                    assistant_text,
                ),
            }
        )
        return _shape_session(record)
    deterministic_selected_node_reply = _deterministic_graph_mode_chat_text(
        text,
        payload.workflow,
        attachments,
        assistant_mode=payload.assistant_mode,
        canvas_context=payload.canvas_context,
        latest_run=latest_run,
        message_history=message_history,
    )
    if deterministic_selected_node_reply and deterministic_selected_node_reply[1].get("mode") == "deterministic_selected_node_field_edit":
        assistant_text, selected_node_metadata = deterministic_selected_node_reply
        store_assistant.create_assistant_message(
            {
                "assistant_session_id": session_id,
                "role": "assistant",
                "content_text": assistant_text,
                "content_json": _assistant_content_json(
                    {
                        **selected_node_metadata,
                        "intent_route": intent_route.to_dict(),
                        "assistant_prompt_route": "selected_node_field_edit",
                        "preset_loop_lane": preset_loop_lane or locked_preset_loop_lane,
                    },
                    assistant_text,
                ),
            }
        )
        return _shape_session(record)
    if is_full_prompt_request(text) and (not is_story_project_request(text) or _character_sheet_prompt_lookup_request(text)):
        assistant_text, prompt_recall_metadata = prompt_recall_chat_reply(payload.workflow)
        if (
            not prompt_recall_metadata.get("prompt_found")
            and reference_style_prompt_only
            and any(is_image_attachment(attachment) for attachment in attachments)
        ):
            assistant_text = ""
        else:
            store_assistant.create_assistant_message(
                {
                    "assistant_session_id": session_id,
                    "role": "assistant",
                    "content_text": assistant_text,
                    "content_json": _assistant_content_json(
                        {
                            **prompt_recall_metadata,
                            "intent_route": intent_route.to_dict(),
                            "preset_loop_lane": preset_loop_lane or locked_preset_loop_lane,
                            "suggested_action": None,
                        },
                        assistant_text,
                    ),
                }
            )
            return _shape_session(record)
    provider_result: dict | None = None
    provider_error = ""
    provider_called = False
    provider_fallback_mode = ""
    raw_assistant_text = ""
    if (
        preset_loop_lane
        and not requires_fresh_reference_analysis
        and not replacement_field_planning
        and not image_slot_planning
        and not (
            any(is_image_attachment(attachment) for attachment in attachments)
            and is_reference_preset_request(text, attachments)
            and not (existing_reference_style_brief and has_concrete_style_traits(existing_reference_style_brief))
        )
    ):
        lane_start_proposal = build_preset_builder_proposal(text, attachments)
        deterministic_chat = (
            _preset_loop_start_reply(
                preset_loop_lane,
                reference_style_brief=existing_reference_style_brief,
                proposal=lane_start_proposal,
            ),
            {
                "mode": "deterministic_preset_loop_start",
                "suggested_action": "clarify",
                "preset_loop_lane": preset_loop_lane,
            },
        )
    else:
        deterministic_chat = preset_loop_drift_reply(text, locked_preset_loop_lane)
    if deterministic_chat is None:
        deterministic_chat = _deterministic_chat_text(
            text,
            payload.workflow,
            attachments,
            latest_run_available=latest_run_available,
            message_history=message_history,
        )
    if deterministic_chat is None:
        deterministic_chat = _deterministic_graph_mode_chat_text(
            text,
            payload.workflow,
            attachments,
            assistant_mode=payload.assistant_mode,
            canvas_context=payload.canvas_context,
            latest_run=latest_run,
            message_history=message_history,
        )
    missing_reference_style_for_sandbox = bool(
        deterministic_chat
        and deterministic_chat[1].get("mode") == "deterministic_preset_sandbox_request"
        and any(is_image_attachment(attachment) for attachment in attachments)
        and not (existing_reference_style_brief and has_concrete_style_traits(existing_reference_style_brief))
    )
    if deterministic_chat and (requires_fresh_reference_analysis or missing_reference_style_for_sandbox) and deterministic_chat[1].get("mode") == "deterministic_preset_sandbox_request":
        deterministic_chat = None
    if (
        deterministic_chat is None
        and replacement_field_planning
        and existing_reference_style_brief
        and has_concrete_style_traits(existing_reference_style_brief)
    ):
        alternative_brief = reference_style_brief_with_alternative_fields(existing_reference_style_brief)
        if alternative_brief and alternative_brief != existing_reference_style_brief:
            existing_reference_style_brief = alternative_brief
            deterministic_chat = (
                _replacement_field_planning_chat_text(alternative_brief),
                {
                    "mode": "deterministic_replacement_field_planning",
                    "assistant_prompt_route": "replacement_field_planning",
                    "suggested_action": "clarify",
                },
            )
    if (
        deterministic_chat is None
        and image_slot_planning
        and existing_reference_style_brief
        and has_concrete_style_traits(existing_reference_style_brief)
    ):
        requested_slots = infer_runtime_image_slots_from_text(text)
        updated_brief = _reference_style_brief_with_requested_image_slots(existing_reference_style_brief, requested_slots)
        if updated_brief and updated_brief != existing_reference_style_brief:
            existing_reference_style_brief = updated_brief
            deterministic_chat = (
                _image_slot_planning_chat_text(updated_brief),
                {
                    "mode": "deterministic_image_slot_planning",
                    "assistant_prompt_route": "image_slot_planning",
                    "suggested_action": "clarify",
                },
            )
    if deterministic_chat:
        assistant_text, deterministic_metadata = deterministic_chat
        raw_assistant_text = assistant_text
        provider_result = {"mode": deterministic_metadata.get("mode")}
    else:
        deterministic_metadata = {}
        preset_builder_proposal = (
            build_preset_builder_proposal(text, attachments)
            if not output_comparison
            and (
                is_reference_preset_request(text, attachments)
                or reference_style_prompt_only
                or _guided_reference_style_intake_request(
                    text,
                    attachments,
                    assistant_mode=payload.assistant_mode,
                    locked_lane=locked_preset_loop_lane,
                )
            )
            else None
        )
        try:
            with track_session(session_id) as cancel_event:
                provider_called = True
                provider_result = run_assistant_provider_chat(
                    session=record,
                    user_text=text,
                    context=context,
                    messages=message_history,
                    attachments=attachments,
                    cancel_event=cancel_event,
            )
            assistant_text = str(provider_result.get("generated_text") or "").strip()
            raw_assistant_text = assistant_text
            assistant_text = strip_provider_reference_style_payload(assistant_text)
            if not assistant_text:
                raise AssistantProviderChatError("Provider returned an empty answer.")
            if output_comparison:
                output_check = build_reference_style_output_check(
                    raw_assistant_text,
                    latest_output_asset_id=latest_output_asset_id,
                    reference_ids=[str(item.get("reference_id") or "") for item in attachments if str(item.get("reference_id") or "").strip()],
                )
                assistant_text = _compact_output_compare_reply(assistant_text, output_check=output_check)
        except AssistantRequestCancelled:
            updated = store_assistant.create_or_update_assistant_session({**record, "status": "active"})
            return _shape_session(updated)
        except AssistantProviderChatError as exc:
            provider_error = str(exc)
            if requires_fresh_reference_analysis or missing_reference_style_for_sandbox:
                provider_fallback_mode = "fresh_reference_analysis_failed"
                provider_result = {"mode": "provider_reference_analysis_failed"}
                preset_builder_proposal = None
                assistant_text = _fresh_reference_analysis_failed_text(provider_error)
            else:
                assistant_text = (
                    _compact_output_compare_reply("")
                    if output_comparison
                    else preset_builder_chat_text(preset_builder_proposal) if preset_builder_proposal else _fallback_chat_text(provider_error, route=intent_route)
                )
            if output_comparison:
                output_check = build_reference_style_output_check(
                    assistant_text,
                    latest_output_asset_id=latest_output_asset_id,
                    reference_ids=[str(item.get("reference_id") or "") for item in attachments if str(item.get("reference_id") or "").strip()],
                )
            raw_assistant_text = assistant_text
        except Exception as exc:
            # Provider adapters sit outside assistant persistence; keep chat outages from becoming 500s.
            provider_error = str(exc)
            if requires_fresh_reference_analysis or missing_reference_style_for_sandbox:
                provider_fallback_mode = "fresh_reference_analysis_failed"
                provider_result = {"mode": "provider_reference_analysis_failed"}
                preset_builder_proposal = None
                assistant_text = _fresh_reference_analysis_failed_text(provider_error)
            else:
                assistant_text = (
                    _compact_output_compare_reply("")
                    if output_comparison
                    else preset_builder_chat_text(preset_builder_proposal) if preset_builder_proposal else _fallback_chat_text(provider_error, route=intent_route)
                )
            if output_comparison:
                output_check = build_reference_style_output_check(
                    assistant_text,
                    latest_output_asset_id=latest_output_asset_id,
                    reference_ids=[str(item.get("reference_id") or "") for item in attachments if str(item.get("reference_id") or "").strip()],
                )
            raw_assistant_text = assistant_text
    provider_reply_suppressed = False
    reference_style_brief = None
    server_state_fallback_recovery = False
    provider_completed = bool((raw_assistant_text or assistant_text or "").strip()) and not provider_error
    if preset_builder_proposal and provider_completed:
        preset_builder_proposal = apply_provider_image_input_hint(preset_builder_proposal, raw_assistant_text or assistant_text)
    if preset_builder_proposal and provider_completed and any(is_image_attachment(attachment) for attachment in attachments):
        reference_style_brief = build_reference_style_brief(
            user_text=text,
            assistant_text=raw_assistant_text or assistant_text,
            proposal=preset_builder_proposal,
            attachments=attachments,
        )
    if (
        not (reference_style_brief and has_concrete_style_traits(reference_style_brief))
        and existing_reference_style_brief
        and has_concrete_style_traits(existing_reference_style_brief)
        and (
            preset_builder_proposal
            or needs_reference_style_intake
            or replacement_field_planning
            or image_slot_planning
            or _sandbox_creation_request(text)
            or wants_sandbox_example(text)
        )
    ):
        reference_style_brief = existing_reference_style_brief
        if provider_error or provider_fallback_mode:
            provider_fallback_mode = provider_fallback_mode or "server_state_replay"
            server_state_fallback_recovery = True
    if reference_style_brief and has_concrete_style_traits(reference_style_brief):
        reference_style_brief = _enforce_locked_lane_on_style_brief(
            reference_style_brief,
            preset_builder_proposal,
            locked_preset_loop_lane if locked_preset_loop_lane in {"image_to_image", "text_to_image"} else None,
        )
        if preset_builder_proposal:
            preset_builder_proposal = merge_reference_style_contract_into_proposal(preset_builder_proposal, reference_style_brief)
    prompt_only_compile_result = None
    if reference_style_prompt_only and reference_style_brief and has_concrete_style_traits(reference_style_brief):
        prompt_only_compile_result = compile_reference_style_t2i_prompt_result(
            reference_style_brief,
            fields=[field.model_dump(mode="json") for field in reference_style_brief.preset_contract.fields],
            saved_template=False,
        )
        if prompt_only_compile_result.prompt:
            assistant_text = (
                "Here is a full prompt from the attached reference style:\n\n"
                f"```text\n{prompt_only_compile_result.prompt}\n```"
            )
            deterministic_metadata = {
                **deterministic_metadata,
                "mode": "reference_style_prompt_only",
                "prompt_quality_score": prompt_only_compile_result.prompt_quality_score,
                "prompt_quality_passed": prompt_only_compile_result.prompt_quality_passed,
                "prompt_quality_issues": prompt_only_compile_result.prompt_quality_issues,
            }
    if not reference_style_prompt_only and preset_builder_proposal and _should_compact_preset_reply(assistant_text):
        provider_reply_suppressed = True
        assistant_text = preset_builder_chat_text(preset_builder_proposal)
    if (
        not reference_style_prompt_only
        and
        reference_style_brief
        and has_concrete_style_traits(reference_style_brief)
        and deterministic_metadata.get("mode") != "deterministic_preset_sandbox_request"
        and deterministic_metadata.get("mode") != "deterministic_replacement_field_planning"
        and deterministic_metadata.get("mode") != "deterministic_image_slot_planning"
    ):
        assistant_text = compact_style_brief_reply(reference_style_brief, preset_builder_proposal)
    reference_style_contract = _compact_reference_style_contract(preset_builder_proposal, attachments)
    current_attachment_hash = attachment_set_hash(attachments)
    current_workflow_tab_id = str(record.get("owner_id") or "")
    current_lane = preset_loop_lane or locked_preset_loop_lane or preset_loop_lane_from_summary(summary_json) or None
    current_skill_session_id = (
        build_skill_session_id(
            assistant_session_id=session_id,
            skill_id=skill_manifest.skill_id,
            workflow_tab_id=current_workflow_tab_id,
            lane=current_lane,
            attachment_hash=current_attachment_hash,
        )
        if skill_manifest.skill_id == "media_preset_builder"
        else None
    )
    if reference_style_contract or reference_style_brief or output_check:
        summary_json = dict(record.get("summary_json") or {})
        if isinstance(preset_builder_proposal, dict) and isinstance(preset_builder_proposal.get("skill_state"), dict):
            skill_state = dict(preset_builder_proposal["skill_state"])
            if current_skill_session_id:
                skill_state["skill_session_id"] = current_skill_session_id
            if current_lane:
                skill_state["lane"] = current_lane
            if current_workflow_tab_id:
                skill_state["workflow_tab_id"] = current_workflow_tab_id
            skill_state["attachment_set_hash"] = current_attachment_hash
            if reference_style_brief:
                skill_state["status"] = "reference_analysis"
                skill_state["style_brief_id"] = reference_style_brief.brief_id
                skill_state["style_brief_hash"] = reference_style_brief_hash(reference_style_brief)
                skill_state["field_choices"] = [field.model_dump(mode="json") for field in reference_style_brief.recommended_fields]
                skill_state["image_slot_choices"] = [slot.model_dump(mode="json") for slot in reference_style_brief.recommended_image_slots]
            summary_json["media_preset_builder"] = skill_state
        if reference_style_contract:
            summary_json["reference_style_contract"] = reference_style_contract
        if reference_style_brief:
            summary_json["reference_style_brief"] = reference_style_brief.model_dump(mode="json")
        if output_check:
            builder_state = dict(summary_json.get("media_preset_builder") or {})
            builder_state = {
                **builder_state,
                "skill": "create_media_preset",
                "status": "output_comparison",
                "latest_output_check": output_check.model_dump(mode="json"),
            }
            summary_json["media_preset_builder"] = builder_state
        record = store_assistant.create_or_update_assistant_session({**record, "summary_json": summary_json})
    if provider_error and not server_state_fallback_recovery:
        summary_json = dict(record.get("summary_json") or summary_json or {})
        builder_state = summary_json.get("media_preset_builder") if isinstance(summary_json.get("media_preset_builder"), dict) else {}
        stored_brief = parse_reference_style_brief(summary_json.get("reference_style_brief"))
        if (
            stored_brief
            and has_concrete_style_traits(stored_brief)
            and str(builder_state.get("workflow_tab_id") or "") == current_workflow_tab_id
        ):
            reference_style_brief = reference_style_brief or stored_brief
            provider_fallback_mode = provider_fallback_mode or "server_state_replay"
            server_state_fallback_recovery = True
            updated_builder_state = {
                **dict(builder_state),
                "fallback_recovery": "server_state_replay",
                "fallback_recovery_style_brief_id": stored_brief.brief_id,
            }
            summary_json["media_preset_builder"] = updated_builder_state
            record = store_assistant.create_or_update_assistant_session({**record, "summary_json": summary_json})
    if skill_manifest.skill_id == "media_preset_builder":
        provider_lifecycle = _provider_lifecycle_state(
            provider_result,
            provider_error=provider_error,
            provider_called=provider_called,
            fallback_mode=provider_fallback_mode or None,
        )
        if provider_lifecycle:
            summary_json = dict(record.get("summary_json") or summary_json or {})
            builder_state = dict(summary_json.get("media_preset_builder") or {})
            builder_state = {
                **builder_state,
                "skill": "create_media_preset",
                "skill_session_id": current_skill_session_id or builder_state.get("skill_session_id"),
                "lane": current_lane or builder_state.get("lane"),
                "workflow_tab_id": current_workflow_tab_id or builder_state.get("workflow_tab_id"),
                "attachment_set_hash": current_attachment_hash,
                "provider_lifecycle": provider_lifecycle,
                "provider_thread_id": provider_lifecycle.get("provider_thread_id") or builder_state.get("provider_thread_id"),
                "latest_provider_response_id": provider_lifecycle.get("provider_response_id") or builder_state.get("latest_provider_response_id"),
                "latest_provider_turn_id": provider_lifecycle.get("provider_turn_id") or builder_state.get("latest_provider_turn_id"),
                "provider_session_id": provider_lifecycle.get("provider_session_id") or builder_state.get("provider_session_id"),
            }
            if provider_fallback_mode == "fresh_reference_analysis_failed":
                builder_state["status"] = "reference_analysis_failed"
            if server_state_fallback_recovery:
                builder_state["fallback_recovery"] = "server_state_replay"
                if reference_style_brief:
                    builder_state["fallback_recovery_style_brief_id"] = reference_style_brief.brief_id
            summary_json["media_preset_builder"] = builder_state
            session_update = {**record, "summary_json": summary_json}
            if provider_lifecycle.get("provider_thread_id"):
                session_update["provider_thread_id"] = provider_lifecycle.get("provider_thread_id")
            record = store_assistant.create_or_update_assistant_session(session_update)
    skill_state_after = _media_preset_builder_status(summary_json)
    story_project_state = None
    if context.get("assistant_prompt_route") == "story_project" and assistant_text.strip():
        story_project_state = merge_story_project_state(
            existing_story_project,
            user_text=text,
            assistant_text=assistant_text,
        )
        summary_json = {**summary_json, "story_project": story_project_state}
        state_snapshot_json = {**state_snapshot_json, "story_project": story_project_state}
        record = store_assistant.create_or_update_assistant_session(
            {**record, "summary_json": summary_json, "state_snapshot_json": state_snapshot_json}
        )
    story_project_for_action = _story_project_with_attachment_character_sheet(story_project_state or existing_story_project, attachments)
    story_graph_action_plan = (
        story_graph_plan_from_state(message=text, story_project=story_project_for_action, workflow=payload.workflow, attachments=attachments, canvas_context=payload.canvas_context)
        if story_project_for_action
        else None
    )
    suggested_action = (
        "create_graph_plan"
        if output_comparison
        or (_sandbox_creation_request(text) and reference_style_brief and has_concrete_style_traits(reference_style_brief))
        or story_graph_action_plan is not None
        else None
    )
    response_preset_builder_proposal = None if reference_style_prompt_only else preset_builder_proposal
    assistant_message = store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": assistant_text,
            "content_json": _assistant_content_json(
                {
                    "mode": (provider_result or {}).get("mode") or "deterministic_fallback",
                    "provider_kind": (provider_result or {}).get("provider_kind") or record.get("provider_kind") or "codex_local",
                    "provider_model_id": (provider_result or {}).get("provider_model_id") or record.get("provider_model_id"),
                    "provider_response_id": (provider_result or {}).get("provider_response_id"),
                    "provider_error": provider_error or None,
                    "assistant_prompt_route": (provider_result or {}).get("assistant_prompt_route") or context.get("assistant_prompt_route"),
                    "loaded_prompt_assets": (provider_result or {}).get("loaded_prompt_assets") or [],
                    "system_prompt_char_count": (provider_result or {}).get("system_prompt_char_count"),
                    "intent_route": intent_route.to_dict(),
                    "preset_builder_proposal": response_preset_builder_proposal,
                    "media_preset_builder": (
                        response_preset_builder_proposal.get("skill_state")
                        if isinstance(response_preset_builder_proposal, dict) and isinstance(response_preset_builder_proposal.get("skill_state"), dict)
                        else None
                    ),
                    "reference_style_contract": reference_style_contract,
                    "reference_style_brief": reference_style_brief.model_dump(mode="json") if reference_style_brief else None,
                    "preset_loop_lane": preset_loop_lane or locked_preset_loop_lane,
                    "provider_reply_suppressed": provider_reply_suppressed or None,
                    "output_aware": output_comparison or None,
                    "output_check": output_check.model_dump(mode="json") if output_check else None,
                    "latest_run_id": latest_output_run_id if output_comparison else None,
                    "story_project": story_project_state,
                    "suggested_action": suggested_action,
                    **deterministic_metadata,
                },
                assistant_text,
            ),
        }
    )
    intent_route_json = intent_route.to_dict()
    contract_validation = (
        _media_preset_builder_contract_validation(
            user_message=text,
            assistant_mode=payload.assistant_mode,
            workflow_tab_id=str(record.get("owner_id") or "") or None,
            current_state=skill_state_before,
            requested_lane=preset_loop_lane or locked_preset_loop_lane,
            attachments=attachments,
            latest_run_id=latest_output_run_id if latest_output_run_id else None,
            latest_output_asset_id=latest_output_asset_id or None,
            summary_json=summary_json,
        )
        if skill_manifest.skill_id == "media_preset_builder"
        else {"status": "not_applicable"}
    )
    prompt_trace_result = None
    if reference_style_brief and has_concrete_style_traits(reference_style_brief):
        trace_fields = [field.model_dump(mode="json") for field in reference_style_brief.preset_contract.fields]
        trace_slots = [slot.model_dump(mode="json") for slot in reference_style_brief.preset_contract.image_slots]
        prompt_trace_result = compile_reference_style_prompt_result(
            reference_style_brief,
            fields=trace_fields,
            image_slots=trace_slots,
            saved_template=True,
        )
    builder_state_for_trace = summary_json.get("media_preset_builder") if isinstance(summary_json.get("media_preset_builder"), dict) else {}
    saved_preset_ids = []
    saved_preset_keys = []
    for item in builder_state_for_trace.get("saved_preset_ids") or []:
        if isinstance(item, str) and item.strip():
            saved_preset_ids.append(item.strip())
        elif isinstance(item, dict):
            preset_id = str(item.get("preset_id") or item.get("id") or "").strip()
            preset_key = str(item.get("key") or "").strip()
            if preset_id:
                saved_preset_ids.append(preset_id)
            if preset_key:
                saved_preset_keys.append(preset_key)
    if builder_state_for_trace.get("latest_saved_preset_id"):
        saved_preset_ids.append(str(builder_state_for_trace.get("latest_saved_preset_id")))
    output_comparison_summary = output_check.match_summary if output_check else None
    skill_trace = build_skill_trace(
        session_id=session_id,
        skill_session_id=current_skill_session_id,
        message_id=assistant_message["assistant_message_id"] if assistant_message else None,
        workflow_tab_id=str(record.get("owner_id") or "") or None,
        manifest=skill_manifest,
        intent_route=intent_route_json,
        contract_validation=contract_validation,
        state_before=skill_state_before,
        state_after=skill_state_after,
        attachments=attachments,
        cache_decision=cache_decision,
        cache_reason=cache_reason,
        provider_called=provider_called,
        provider_kind=(provider_result or {}).get("provider_kind") or record.get("provider_kind") or "codex_local",
        provider_model_id=(provider_result or {}).get("provider_model_id") or record.get("provider_model_id"),
        provider_session_id=(summary_json.get("media_preset_builder") or {}).get("provider_session_id")
        if isinstance(summary_json.get("media_preset_builder"), dict)
        else None,
        provider_thread_id=(summary_json.get("media_preset_builder") or {}).get("provider_thread_id")
        if isinstance(summary_json.get("media_preset_builder"), dict)
        else None,
        provider_turn_id=(summary_json.get("media_preset_builder") or {}).get("latest_provider_turn_id")
        if isinstance(summary_json.get("media_preset_builder"), dict)
        else None,
        provider_thread_reused=(summary_json.get("media_preset_builder") or {})
        .get("provider_lifecycle", {})
        .get("provider_thread_reused")
        if isinstance(summary_json.get("media_preset_builder"), dict)
        and isinstance((summary_json.get("media_preset_builder") or {}).get("provider_lifecycle"), dict)
        else None,
        provider_image_path_count=(provider_result or {}).get("provider_image_path_count"),
        provider_image_path_basenames=(provider_result or {}).get("provider_image_path_basenames") or [],
        provider_image_path_hashes=(provider_result or {}).get("provider_image_path_hashes") or [],
        provider_response_id=(provider_result or {}).get("provider_response_id"),
        fallback_mode=(summary_json.get("media_preset_builder") or {})
        .get("provider_lifecycle", {})
        .get("fallback_mode")
        if isinstance(summary_json.get("media_preset_builder"), dict)
        and isinstance((summary_json.get("media_preset_builder") or {}).get("provider_lifecycle"), dict)
        else None,
        prompt_quality_score=prompt_trace_result.prompt_quality_score if prompt_trace_result else None,
        prompt_quality_passed=prompt_trace_result.prompt_quality_passed if prompt_trace_result else None,
        prompt_quality_issues=prompt_trace_result.prompt_quality_issues if prompt_trace_result else [],
        fixmyphoto_planner_score=prompt_trace_result.fixmyphoto_planner_score if prompt_trace_result else None,
        fixmyphoto_planner_issues=prompt_trace_result.fixmyphoto_planner_issues if prompt_trace_result else [],
        generation_directness_score=prompt_trace_result.generation_directness_score if prompt_trace_result else None,
        generation_directness_issues=prompt_trace_result.generation_directness_issues if prompt_trace_result else [],
        prompt_contract_validation_status=prompt_trace_result.contract_validation_status if prompt_trace_result else None,
        prompt_contract_validation_issues=prompt_trace_result.contract_validation_issues if prompt_trace_result else [],
        repair_attempt_count=1 if prompt_trace_result and prompt_trace_result.prompt_quality_passed else 0 if prompt_trace_result else None,
        latest_run_id=latest_output_run_id if output_comparison else None,
        latest_output_asset_id=latest_output_asset_id or None,
        output_comparison_summary=output_comparison_summary,
        saved_preset_ids=saved_preset_ids,
        saved_preset_keys=saved_preset_keys,
        next_action=suggested_action or (provider_result or {}).get("mode") or "ask_user",
        assistant_prompt_route=(provider_result or {}).get("assistant_prompt_route") or context.get("assistant_prompt_route"),
        loaded_prompt_assets=(provider_result or {}).get("loaded_prompt_assets") or [],
        system_prompt_char_count=(provider_result or {}).get("system_prompt_char_count"),
    )
    usage = (provider_result or {}).get("usage") if isinstance((provider_result or {}).get("usage"), dict) else {}
    store_assistant.create_assistant_turn_usage(
        {
            "assistant_session_id": session_id,
            "assistant_message_id": assistant_message["assistant_message_id"] if assistant_message else None,
            "provider_kind": (provider_result or {}).get("provider_kind") or record.get("provider_kind") or "codex_local",
            "provider_model_id": (provider_result or {}).get("provider_model_id") or record.get("provider_model_id"),
            "provider_response_id": (provider_result or {}).get("provider_response_id"),
            "token_input_count": (provider_result or {}).get("prompt_tokens"),
            "token_output_count": (provider_result or {}).get("completion_tokens"),
            "image_count": attachment_counts["image"],
            "latency_ms": (provider_result or {}).get("latency_ms"),
            "cost_usd": 0.0 if ((provider_result or {}).get("provider_kind") == "codex_local") else float((provider_result or {}).get("cost") or 0.0),
            "usage_json": {
                "mode": (provider_result or {}).get("mode") or "deterministic_fallback",
                "context_node_count": len(context.get("node_catalog", [])),
                "attachment_counts": attachment_counts,
                "intent_route": intent_route_json,
                "contract_validation": contract_validation,
                "usage": usage,
                "provider_error": provider_error or None,
                "latest_run_id": latest_output_run_id if output_comparison else None,
                "output_aware": output_comparison or None,
                "skill_trace": skill_trace,
            },
        }
    )
    updated = store_assistant.create_or_update_assistant_session({**record, "status": "active"})
    return _shape_session(updated)


@router.post("/sessions/{session_id}/attachments", response_model=AssistantAttachment)
def create_attachment(session_id: str, payload: AssistantAttachmentCreateRequest) -> AssistantAttachment:
    if not store_assistant.get_assistant_session(session_id):
        raise _not_found("assistant session")
    reference = store.get_reference_media(payload.reference_id)
    if not reference:
        raise _not_found("reference media")
    existing_attachments = store_assistant.list_assistant_attachments(session_id)
    is_image_reference = str(reference.get("kind") or "").lower() == "image"
    if is_image_reference and len([item for item in existing_attachments if is_image_attachment(item)]) >= ASSISTANT_IMAGE_ATTACHMENT_LIMIT:
        raise _bad_request(f"Media Assistant accepts at most {ASSISTANT_IMAGE_ATTACHMENT_LIMIT} image reference(s).")
    attachment = store_assistant.create_assistant_attachment(
        {
            "assistant_session_id": session_id,
            "reference_id": payload.reference_id,
            "kind": str(reference.get("kind") or "image"),
            "label": payload.label or reference.get("original_filename"),
            "metadata_json": {
                "mime_type": reference.get("mime_type"),
                "width": reference.get("width"),
                "height": reference.get("height"),
                "duration_seconds": reference.get("duration_seconds"),
            },
        }
    )
    return AssistantAttachment(**attachment)


@router.delete("/sessions/{session_id}/attachments/{attachment_id}")
def delete_attachment(session_id: str, attachment_id: str) -> dict:
    if not store_assistant.get_assistant_session(session_id):
        raise _not_found("assistant session")
    store_assistant.delete_assistant_attachment(session_id, attachment_id)
    return {"ok": True}


@router.get("/sessions/{session_id}/media-inspection", response_model=AssistantMediaInspectionResponse)
def inspect_session_media(session_id: str) -> AssistantMediaInspectionResponse:
    if not store_assistant.get_assistant_session(session_id):
        raise _not_found("assistant session")
    attachments = store_assistant.list_assistant_attachments(session_id)
    return AssistantMediaInspectionResponse(
        attachment_counts=_attachment_counts(attachments),
        media_summary=build_attachment_summary(attachments),
    )


@router.post("/sessions/{session_id}/plans", response_model=AssistantPlanResponse)
def create_plan(session_id: str, payload: AssistantPlanCreateRequest) -> AssistantPlanResponse:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    workflow = materialize_workflow_defaults(payload.workflow)
    attachments = store_assistant.list_assistant_attachments(session_id)
    attachment_counts = _attachment_counts(attachments)
    message = payload.message or ""
    if not message:
        messages = store_assistant.list_assistant_messages(session_id)
        message = next((str(item.get("content_text") or "") for item in reversed(messages) if item.get("role") == "user"), "")
    selected_node_edit_candidate = selected_node_field_edit_plan_from_context(
        message,
        workflow,
        payload.canvas_context,
    )
    if is_graph_creation_negated(message):
        if selected_node_edit_candidate and selected_node_edit_candidate.operations:
            graph_plan = selected_node_edit_candidate
            planned_workflow = apply_graph_plan(workflow, graph_plan)
            workflow_validation = validate_workflow(planned_workflow)
            pricing = estimate_graph_workflow(planned_workflow)
            plan_record = store_assistant.create_or_update_assistant_plan(
                {
                    "assistant_session_id": session_id,
                    "status": "validated" if workflow_validation.valid else "failed",
                    "capability": graph_plan.capability,
                    "plan_json": graph_plan.model_dump(mode="json"),
                    "validation_json": workflow_validation.model_dump(mode="json"),
                    "pricing_json": pricing.model_dump(mode="json"),
                    "workflow_json": planned_workflow.model_dump(mode="json"),
                }
            )
            return AssistantPlanResponse(
                plan=AssistantPlan(**plan_record),
                graph_plan=graph_plan.model_dump(mode="json"),
                workflow=planned_workflow,
                validation=workflow_validation,
                pricing=pricing,
            )
        workflow_validation = validate_workflow(workflow)
        pricing = estimate_graph_workflow(workflow)
        graph_plan = AssistantGraphPlan(
            summary="I kept this as chat only and did not change the graph.",
            questions=["Ask me to create or add the graph when you want the canvas changed."],
            operations=[],
            warnings=[],
            requires_confirmation=True,
            metadata={"template_id": "chat_only_graph_change_negated", "graph_change_negated": True},
        )
        plan_record = store_assistant.create_or_update_assistant_plan(
            {
                "assistant_session_id": session_id,
                "status": "validated" if workflow_validation.valid else "failed",
                "capability": graph_plan.capability,
                "plan_json": graph_plan.model_dump(mode="json"),
                "validation_json": workflow_validation.model_dump(mode="json"),
                "pricing_json": pricing.model_dump(mode="json"),
                "workflow_json": workflow.model_dump(mode="json"),
            }
        )
        return AssistantPlanResponse(
            plan=AssistantPlan(**plan_record),
            graph_plan=graph_plan.model_dump(mode="json"),
            workflow=workflow,
            validation=workflow_validation,
            pricing=pricing,
        )
    prior_messages = store_assistant.list_assistant_messages(session_id)
    planning_message = message
    latest_run = build_latest_run_summary(payload.run_id)
    latest_comparison = (
        _latest_output_comparison_summary(prior_messages, payload.run_id)
        if latest_run and (_output_comparison_request(message) or _wants_prior_style_context(message))
        else ""
    )
    if latest_comparison:
        planning_message = f"{planning_message}\n\nPrior assistant output comparison:\n{latest_comparison}"
    summary_json = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    state_snapshot_json = session.get("state_snapshot_json") if isinstance(session.get("state_snapshot_json"), dict) else {}
    story_project = _story_project_with_attachment_character_sheet(
        story_project_from_session(summary_json, state_snapshot_json),
        attachments,
    )
    builder_state = summary_json.get("media_preset_builder") if isinstance(summary_json.get("media_preset_builder"), dict) else {}
    latest_output_check = builder_state.get("latest_output_check") if isinstance(builder_state.get("latest_output_check"), dict) else {}
    latest_prompt_delta = str(latest_output_check.get("prompt_delta") or "").strip()
    if latest_prompt_delta and _wants_prior_style_context(message) and not latest_comparison:
        planning_message = f"{planning_message}\n\nPrior assistant output comparison:\n{latest_prompt_delta}"
    preset_loop_lane = preset_loop_lane_from_summary(summary_json)
    preset_loop_instruction = preset_loop_planning_instruction(preset_loop_lane) if payload.assistant_mode == "preset" else ""
    if preset_loop_instruction and wants_sandbox_example(message):
        planning_message = f"{planning_message}\n\n{preset_loop_instruction}"
    reference_style_brief = parse_reference_style_brief(summary_json.get("reference_style_brief") if isinstance(summary_json, dict) else None)
    if not (reference_style_brief and has_concrete_style_traits(reference_style_brief)):
        cached_reference_style_brief = _cached_reference_style_brief_for_attachments(attachments)
        if cached_reference_style_brief:
            reference_style_brief = cached_reference_style_brief
            summary_json = {
                **summary_json,
                "reference_style_brief": cached_reference_style_brief.model_dump(mode="json"),
            }
            session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary_json})
    latest_visible_setup = _latest_visible_reference_style_setup(prior_messages)
    if latest_visible_setup and "Suggested setup" not in planning_message:
        planning_message = f"{planning_message}\n\nLatest visible assistant setup:\n{latest_visible_setup}"
    if reference_style_brief and latest_visible_setup:
        synced_reference_style_brief = sync_reference_style_brief_with_visible_setup(
            reference_style_brief,
            latest_visible_setup,
        )
        if synced_reference_style_brief and synced_reference_style_brief != reference_style_brief:
            reference_style_brief = synced_reference_style_brief
            summary_json = {
                **summary_json,
                "reference_style_brief": synced_reference_style_brief.model_dump(mode="json"),
            }
            session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary_json})
    if reference_style_brief and has_concrete_style_traits(reference_style_brief):
        reference_style_brief = _enforce_locked_lane_on_style_brief(
            reference_style_brief,
            None,
            preset_loop_lane if preset_loop_lane in {"image_to_image", "text_to_image"} else None,
        )
    stored_reference_style_contract = summary_json.get("reference_style_contract") if isinstance(summary_json, dict) else None
    reference_style_contract = (
        _reference_style_contract_from_brief(reference_style_brief, attachments)
        if reference_style_brief and has_concrete_style_traits(reference_style_brief)
        else stored_reference_style_contract
    )
    if (
        isinstance(reference_style_contract, dict)
        and wants_sandbox_example(message)
        and "preset" not in planning_message.lower()
    ):
        contract_slots = reference_style_contract.get("image_slots") if isinstance(reference_style_contract.get("image_slots"), list) else []
        if len(contract_slots) == 1:
            slot_label = str(contract_slots[0].get("label") or contract_slots[0].get("key") or "Personal Reference")
            planning_message = (
                f"{planning_message}\n\nUse the previously agreed reference-style Media Preset sandbox contract: exactly one subject image input named {slot_label}. "
                "Do not add a second image input."
            )
    if (
        reference_style_brief
        and has_concrete_style_traits(reference_style_brief)
        and (wants_sandbox_example(message) or _wants_prior_style_context(message))
    ):
        marker = encode_reference_style_brief_marker(reference_style_brief)
        if marker:
            planning_message = f"{planning_message}\n\n{marker}"
    elif reference_style_brief and _wants_prior_style_context(message):
        brief_analysis = reference_style_brief_to_analysis_text(reference_style_brief)
        if brief_analysis:
            planning_message = f"{planning_message}\n\nPrior assistant reference-style analysis:\n{brief_analysis}"
    prior_style_analysis = _latest_reference_style_analysis(prior_messages) if _wants_prior_style_context(message) and planning_message == message else ""
    if prior_style_analysis:
        planning_message = f"{planning_message}\n\nPrior assistant reference-style analysis:\n{prior_style_analysis}"
    _persist_user_prompt(session_id, message, capability="plan_graph")
    provider_result: dict | None = None
    provider_error = ""
    selected_node_edit_candidate = selected_node_edit_candidate or selected_node_field_edit_plan_from_context(
        planning_message,
        workflow,
        payload.canvas_context,
    )
    story_graph_candidate = (
        None
        if selected_node_edit_candidate
        else story_graph_plan_from_state(
            message=planning_message,
            story_project=story_project
            or (
                merge_story_project_state(
                    None,
                    user_text=planning_message,
                    assistant_text=planning_message,
                )
                if is_story_project_request(planning_message)
                else None
            ),
            workflow=workflow,
            attachments=attachments,
            canvas_context=payload.canvas_context,
        )
    )
    character_sheet_candidate = (
        None
        if selected_node_edit_candidate or story_graph_candidate
        else character_sheet_graph_plan_from_workflow_request(
            planning_message,
            workflow,
            context_message=_recent_user_message_context(prior_messages, message),
            canvas_context=payload.canvas_context,
            attachments=attachments,
        )
    )
    deterministic_candidate = selected_node_edit_candidate or story_graph_candidate or character_sheet_candidate or _deterministic_graph_plan_candidate(
        planning_message,
        workflow,
        attachments,
        latest_run=latest_run,
        assistant_mode=payload.assistant_mode,
    )
    if deterministic_candidate is not None:
        graph_plan = deterministic_candidate
    else:
        assistant_context = build_assistant_context(workflow, attachments, run_id=payload.run_id, canvas_context=payload.canvas_context)
        try:
            with track_session(session_id) as cancel_event:
                provider_result = run_provider_graph_plan(
                    session=session,
                    message=planning_message,
                    workflow=workflow,
                    context={
                        **assistant_context,
                        "assistant_mode": payload.assistant_mode,
                        **({"story_project": story_project} if story_project else {}),
                    },
                    attachments=attachments,
                    cancel_event=cancel_event,
                )
            graph_plan = provider_result["graph_plan"]
        except AssistantRequestCancelled:
            store_assistant.create_or_update_assistant_session({**session, "status": "active"})
            raise HTTPException(status_code=409, detail="Assistant planning was cancelled.")
        except AssistantProviderChatError as exc:
            provider_error = str(exc)
            graph_plan = plan_graph_from_message(planning_message, workflow, attachments, latest_run=latest_run)
        except Exception as exc:
            # Provider-backed planning should never block the deterministic planning path.
            provider_error = str(exc)
            graph_plan = plan_graph_from_message(planning_message, workflow, attachments, latest_run=latest_run)
    try:
        planned_workflow = apply_graph_plan(workflow, graph_plan) if graph_plan.operations else workflow
    except ValueError as exc:
        if provider_result is not None:
            provider_error = str(exc)
            provider_result = None
            graph_plan = plan_graph_from_message(planning_message, workflow, attachments, latest_run=latest_run)
            try:
                planned_workflow = apply_graph_plan(workflow, graph_plan) if graph_plan.operations else workflow
            except ValueError as fallback_exc:
                raise _bad_request(str(fallback_exc))
        else:
            raise _bad_request(str(exc))
    prompt_compile_result = None
    if reference_style_brief and has_concrete_style_traits(reference_style_brief):
        prompt_text = _workflow_draft_preset_prompt_text(planned_workflow)
        contract_fields = [field.model_dump(mode="json") for field in reference_style_brief.preset_contract.fields]
        contract_slots = [slot.model_dump(mode="json") for slot in reference_style_brief.preset_contract.image_slots]
        if isinstance(reference_style_contract, dict):
            if not contract_fields:
                contract_fields = reference_style_contract.get("fields") if isinstance(reference_style_contract.get("fields"), list) else []
            if not contract_slots:
                contract_slots = reference_style_contract.get("image_slots") if isinstance(reference_style_contract.get("image_slots"), list) else []
        if prompt_text:
            prompt_contract_fields = _field_contract_from_prompt_text(prompt_text)
            if prompt_contract_fields:
                contract_fields = prompt_contract_fields
            has_prompt_slots = "[[" in prompt_text
            has_workflow_image_inputs = any(node.type == "media.load_image" for node in planned_workflow.nodes)
            if not has_prompt_slots and not has_workflow_image_inputs:
                contract_slots = []
            prompt_compile_result = score_reference_style_prompt_text(
                prompt_text,
                reference_style_brief,
                fields=contract_fields,
                image_slots=contract_slots,
                saved_template=has_prompt_slots,
            )
    _stamp_prompt_quality_gate(graph_plan, planned_workflow, prompt_compile_result)
    validation = validate_workflow(planned_workflow)
    validation = _apply_prompt_quality_validation(validation, prompt_compile_result)
    layout_errors = graph_plan_layout_errors(workflow, planned_workflow, graph_plan)
    if layout_errors:
        validation = validation.model_copy(update={"valid": False, "errors": [*validation.errors, *layout_errors]})
    graph_plan.metadata["diff_summary"] = graph_plan_diff_summary(
        workflow,
        planned_workflow,
        graph_plan,
        validation=validation,
        layout_errors=layout_errors,
    )
    pricing = estimate_graph_workflow(planned_workflow)
    pending_user_input = _allows_pending_user_input_apply(validation, graph_plan)
    plan_record = store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session_id,
            "status": "validated" if validation.valid or pending_user_input else "failed",
            "capability": graph_plan.capability,
            "plan_json": graph_plan.model_dump(mode="json"),
            "validation_json": validation.model_dump(mode="json"),
            "pricing_json": pricing.model_dump(mode="json"),
            "workflow_json": planned_workflow.model_dump(mode="json"),
        }
    )
    store_assistant.create_assistant_turn_usage(
        {
            "assistant_session_id": session_id,
            "provider_kind": (provider_result or {}).get("provider_kind") or session.get("provider_kind") or "codex_local",
            "provider_model_id": (provider_result or {}).get("provider_model_id") or session.get("provider_model_id"),
            "provider_response_id": (provider_result or {}).get("provider_response_id"),
            "token_input_count": (provider_result or {}).get("prompt_tokens"),
            "token_output_count": (provider_result or {}).get("completion_tokens"),
            "image_count": attachment_counts["image"],
            "latency_ms": (provider_result or {}).get("latency_ms"),
            "cost_usd": 0.0 if ((provider_result or {}).get("provider_kind") == "codex_local") else float((provider_result or {}).get("cost") or 0.0),
            "usage_json": {
                "mode": (provider_result or {}).get("mode") or "deterministic_graph_plan",
                "assistant_plan_id": plan_record["assistant_plan_id"],
                "capability": graph_plan.capability,
                "attachment_counts": attachment_counts,
                "operation_count": len(graph_plan.operations),
                "validation_valid": validation.valid,
                "pending_user_input": pending_user_input or None,
                "provider_error": provider_error or None,
                "provider_attempts": (provider_result or {}).get("attempts"),
                "latest_run_id": payload.run_id,
                "output_aware": bool(latest_run) and _output_comparison_request(message) or None,
                "prompt_quality_score": prompt_compile_result.prompt_quality_score if prompt_compile_result else None,
                "prompt_quality_passed": prompt_compile_result.prompt_quality_passed if prompt_compile_result else None,
                "prompt_quality_issues": prompt_compile_result.prompt_quality_issues if prompt_compile_result else [],
                "fixmyphoto_planner_score": prompt_compile_result.fixmyphoto_planner_score if prompt_compile_result else None,
                "fixmyphoto_planner_issues": prompt_compile_result.fixmyphoto_planner_issues if prompt_compile_result else [],
                "generation_directness_score": prompt_compile_result.generation_directness_score if prompt_compile_result else None,
                "generation_directness_issues": prompt_compile_result.generation_directness_issues if prompt_compile_result else [],
                "prompt_field_keys": prompt_compile_result.field_keys if prompt_compile_result else [],
                "prompt_image_slot_keys": prompt_compile_result.image_slot_keys if prompt_compile_result else [],
                "prompt_contract_validation_status": prompt_compile_result.contract_validation_status if prompt_compile_result else None,
                "prompt_contract_validation_issues": prompt_compile_result.contract_validation_issues if prompt_compile_result else [],
                "usage": (provider_result or {}).get("usage") or {},
                "assistant_turn_trace": build_assistant_turn_trace(
                    {
                        "mode": (provider_result or {}).get("mode") or "deterministic_graph_plan",
                        "capability": graph_plan.capability,
                        "operation_count": len(graph_plan.operations),
                        "validation_valid": validation.valid,
                        "suggested_action": "create_graph_plan" if graph_plan.operations else None,
                        "requires_confirmation": graph_plan.requires_confirmation,
                        "warnings": graph_plan.warnings,
                        "questions": graph_plan.questions,
                    },
                    graph_plan.summary,
                ),
            },
        }
    )
    store_assistant.create_or_update_assistant_session({**session, "status": "plan_ready" if validation.valid or pending_user_input else "failed"})
    return AssistantPlanResponse(
        plan=AssistantPlan(**plan_record),
        graph_plan=graph_plan.model_dump(mode="json"),
        workflow=planned_workflow,
        validation=validation,
        pricing=pricing,
    )


@router.post("/sessions/{session_id}/recipe-drafts", response_model=AssistantPromptRecipeDraftResponse)
def create_prompt_recipe_draft(session_id: str, payload: AssistantDraftCreateRequest) -> AssistantPromptRecipeDraftResponse:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    message = payload.message.strip()
    if not message:
        raise _bad_request("Describe the recipe draft first.")
    _persist_user_prompt(session_id, message, capability="draft_prompt_recipe")
    attachments = store_assistant.list_assistant_attachments(session_id)
    try:
        result = draft_prompt_recipe(message, attachments)
    except Exception as exc:
        raise _bad_request(str(exc))
    assistant_message = store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "system_summary",
            "content_text": "I prepared a Prompt Recipe draft for review. It has not been saved.",
            "content_json": {
                "activity_kind": "prompt_recipe_draft_prepared",
                "capability": "draft_prompt_recipe",
                "review_draft": {
                    "kind": "prompt_recipe",
                    "draft": result["draft"].model_dump(mode="json"),
                    "validation_warnings": result["validation_warnings"],
                    "media_summary": result["media_summary"],
                },
            },
        }
    )
    return AssistantPromptRecipeDraftResponse(
        draft=result["draft"],
        validation_warnings=result["validation_warnings"],
        review_url=_review_url(
            "/presets/prompt-recipes/new",
            session_id=session_id,
            message_id=str(assistant_message["assistant_message_id"]),
        ),
        media_summary=result["media_summary"],
    )


@router.post("/sessions/{session_id}/preset-drafts", response_model=AssistantMediaPresetDraftResponse)
def create_media_preset_draft(session_id: str, payload: AssistantDraftCreateRequest) -> AssistantMediaPresetDraftResponse:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    message = payload.message.strip()
    if not message:
        raise _bad_request("Describe the media preset draft first.")
    _persist_user_prompt(session_id, message, capability="draft_media_preset")
    attachments = store_assistant.list_assistant_attachments(session_id)
    summary_json = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    style_brief = summary_json.get("reference_style_brief") if isinstance(summary_json, dict) else None
    effective_run_id = _effective_preset_save_run_id(payload.run_id, summary_json)
    try:
        result = draft_media_preset(message, attachments, workflow=payload.workflow, run_id=effective_run_id, style_brief=style_brief)
    except Exception as exc:
        raise _bad_request(str(exc))
    assistant_message = store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "system_summary",
            "content_text": "I prepared a Media Preset draft for review. It has not been saved.",
            "content_json": {
                "activity_kind": "media_preset_draft_prepared",
                "capability": "draft_media_preset",
                "review_draft": {
                    "kind": "media_preset",
                    "draft": result["draft"].model_dump(mode="json"),
                    "validation_warnings": result["validation_warnings"],
                    "media_summary": result["media_summary"],
                },
            },
        }
    )
    return AssistantMediaPresetDraftResponse(
        draft=result["draft"],
        validation_warnings=result["validation_warnings"],
        review_url=_review_url(
            "/presets/new",
            session_id=session_id,
            message_id=str(assistant_message["assistant_message_id"]),
        ),
        media_summary=result["media_summary"],
    )


@router.post("/sessions/{session_id}/preset-saves", response_model=AssistantArtifactSaveResponse)
def save_media_preset_from_assistant(session_id: str, payload: AssistantMediaPresetSaveRequest) -> AssistantArtifactSaveResponse:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    message = payload.message.strip()
    if not message:
        raise _bad_request("Describe the media preset to save first.")
    _persist_user_prompt(session_id, message, capability="save_media_preset")
    save_workflow = _resolved_preset_save_workflow(session_id, payload.workflow)
    signature = _save_signature("media_preset", payload)
    existing_saved = _saved_artifact_from_session(session_id, kind="media_preset", signature=signature)
    if existing_saved and _saved_preset_matches_workflow_fields(existing_saved, save_workflow):
        updated = store_assistant.create_or_update_assistant_session({**session, "status": "active"})
        return AssistantArtifactSaveResponse(
            capability="save_media_preset",
            artifact_kind="media_preset",
            created=False,
            record=existing_saved,
            message=f"Media Preset already saved: {existing_saved.get('label') or existing_saved.get('key')}.",
            assistant_session=_shape_session(updated),
        )
    attachments = store_assistant.list_assistant_attachments(session_id)
    summary_json = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    style_brief = summary_json.get("reference_style_brief") if isinstance(summary_json, dict) else None
    effective_run_id = _effective_preset_save_run_id(payload.run_id, summary_json)
    try:
        draft_message = _preset_draft_message_for_save(message, save_workflow)
        if draft_message == message and _preset_save_request(message):
            prior_title = _latest_reference_style_title(store_assistant.list_assistant_messages(session_id))
            if prior_title:
                draft_message = f"Create a Media Preset called {prior_title}. Use the approved sandbox result. {message}"
        draft = payload.draft or draft_media_preset(
            draft_message,
            attachments,
            workflow=save_workflow,
            run_id=effective_run_id,
            style_brief=style_brief,
        )["draft"]
        draft = reconcile_media_preset_draft_for_save(
            draft,
            draft_message,
            attachments,
            workflow=save_workflow,
            run_id=effective_run_id,
            style_brief=style_brief,
        )
        existing_preset = _existing_preset_for_assistant_draft(draft)
        if existing_preset:
            draft = draft.model_copy(update={"key": existing_preset["key"]})
            record = upsert_preset(draft, preset_id=str(existing_preset["preset_id"]))
            created = False
        else:
            record = upsert_preset(draft)
            created = True
    except ServiceError as exc:
        raise _bad_request(str(exc))
    except Exception as exc:
        raise _bad_request(str(exc))
    _record_saved_artifact(
        session_id,
        kind="media_preset",
        capability="save_media_preset",
        record=record,
        created=created,
        signature=signature,
    )
    updated = store_assistant.create_or_update_assistant_session({**session, "status": "active"})
    return AssistantArtifactSaveResponse(
        capability="save_media_preset",
        artifact_kind="media_preset",
        created=created,
        record=record,
        message=f"Saved Media Preset: {record.get('label') or record.get('key')}.",
        assistant_session=_shape_session(updated),
    )


@router.post("/sessions/{session_id}/recipe-saves", response_model=AssistantArtifactSaveResponse)
def save_prompt_recipe_from_assistant(session_id: str, payload: AssistantPromptRecipeSaveRequest) -> AssistantArtifactSaveResponse:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    message = payload.message.strip()
    if not message:
        raise _bad_request("Describe the Prompt Recipe to save first.")
    _persist_user_prompt(session_id, message, capability="save_prompt_recipe")
    signature = _save_signature("prompt_recipe", payload)
    existing_saved = _saved_artifact_from_session(session_id, kind="prompt_recipe", signature=signature)
    if existing_saved:
        updated = store_assistant.create_or_update_assistant_session({**session, "status": "active"})
        return AssistantArtifactSaveResponse(
            capability="save_prompt_recipe",
            artifact_kind="prompt_recipe",
            created=False,
            record=existing_saved,
            message=f"Prompt Recipe already saved: {existing_saved.get('label') or existing_saved.get('key')}.",
            assistant_session=_shape_session(updated),
        )
    attachments = store_assistant.list_assistant_attachments(session_id)
    try:
        draft_message = _recipe_draft_message_for_save(message)
        if payload.draft is None and character_sheet_prompt_recipe_request(draft_message):
            existing_character_sheet_recipe = store.get_prompt_recipe_by_key(CHARACTER_SHEET_TEMPLATE_ID)
            if existing_character_sheet_recipe:
                record = existing_character_sheet_recipe
                created = False
            else:
                draft = draft_prompt_recipe(draft_message, attachments)["draft"]
                record = upsert_prompt_recipe(draft)
                created = True
        else:
            draft = payload.draft or draft_prompt_recipe(draft_message, attachments)["draft"]
            existing_by_key = store.get_prompt_recipe_by_key(draft.key)
            if existing_by_key:
                record = existing_by_key
                created = False
            else:
                record = upsert_prompt_recipe(draft)
                created = True
    except ServiceError as exc:
        raise _bad_request(str(exc))
    except Exception as exc:
        raise _bad_request(str(exc))
    registry.invalidate()
    _record_saved_artifact(
        session_id,
        kind="prompt_recipe",
        capability="save_prompt_recipe",
        record=record,
        created=created,
        signature=signature,
    )
    updated = store_assistant.create_or_update_assistant_session({**session, "status": "active"})
    return AssistantArtifactSaveResponse(
        capability="save_prompt_recipe",
        artifact_kind="prompt_recipe",
        created=created,
        record=record,
        message=f"Saved Prompt Recipe: {record.get('label') or record.get('key')}.",
        assistant_session=_shape_session(updated),
    )


@router.post("/sessions/{session_id}/repair", response_model=AssistantRepairResponse)
def repair_graph_run(session_id: str, payload: AssistantRepairCreateRequest) -> AssistantRepairResponse:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise _not_found("assistant session")
    result = repair_plan_for_failed_run(payload.run_id, payload.workflow)
    if not result:
        raise _not_found("graph run")
    failed_run = result["summary"]
    graph_plan = result["graph_plan"]
    store_assistant.create_or_update_assistant_plan(
        {
            "assistant_session_id": session_id,
            "status": "validated" if result["validation"].valid else "failed",
            "capability": "repair_graph",
            "plan_json": graph_plan.model_dump(mode="json"),
            "validation_json": result["validation"].model_dump(mode="json"),
            "pricing_json": result["pricing"].model_dump(mode="json"),
            "workflow_json": result["workflow"].model_dump(mode="json"),
        }
    )
    store_assistant.create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": graph_plan.summary,
            "content_json": _assistant_content_json({"capability": "repair_graph", "run_id": payload.run_id}, graph_plan.summary),
        }
    )
    return AssistantRepairResponse(
        run_id=payload.run_id,
        status=str(failed_run.get("status") or "unknown"),
        summary=graph_plan.summary,
        failed_nodes=failed_run["failed_nodes"],
        graph_plan=graph_plan,
        workflow=result["workflow"],
        validation=result["validation"],
        pricing=result["pricing"],
    )


@router.post("/plans/{plan_id}/apply", response_model=AssistantPlanApplyResponse)
def apply_plan(plan_id: str, payload: AssistantPlanApplyRequest) -> AssistantPlanApplyResponse:
    plan = store_assistant.get_assistant_plan(plan_id)
    if not plan:
        raise _not_found("assistant plan")
    if str(plan.get("status") or "") not in {"validated", "applied"}:
        raise _bad_request("Only validated assistant plans can be applied.")
    plan_payload = plan.get("plan_json") if isinstance(plan.get("plan_json"), dict) else {}
    graph_plan = AssistantGraphPlan(**plan_payload)
    base_workflow = materialize_workflow_defaults(payload.workflow)
    try:
        workflow = apply_graph_plan(base_workflow, graph_plan) if graph_plan.operations else base_workflow
    except ValueError as exc:
        raise _bad_request(str(exc))
    validation = validate_workflow(workflow)
    layout_errors = graph_plan_layout_errors(base_workflow, workflow, graph_plan)
    if layout_errors:
        raise _bad_request(layout_errors[0].message)
    graph_plan.metadata["diff_summary"] = graph_plan_diff_summary(
        base_workflow,
        workflow,
        graph_plan,
        validation=validation,
        layout_errors=layout_errors,
    )
    pending_user_input = _allows_pending_user_input_apply(validation, graph_plan)
    if not validation.valid and not pending_user_input:
        raise _bad_request("Assistant plan no longer validates.")
    pricing = estimate_graph_workflow(workflow)
    updated = store_assistant.create_or_update_assistant_plan(
        {
            **plan,
            "status": "applied",
            "plan_json": graph_plan.model_dump(mode="json"),
            "validation_json": validation.model_dump(mode="json"),
            "pricing_json": pricing.model_dump(mode="json"),
            "workflow_json": workflow.model_dump(mode="json"),
            "applied_workflow_id": workflow.workflow_id,
        }
    )
    session = store_assistant.get_assistant_session(str(plan["assistant_session_id"]))
    if session:
        store_assistant.create_assistant_message(
            {
                "assistant_session_id": session["assistant_session_id"],
                "role": "system_summary",
                "content_text": "I applied the reviewed plan to the graph. It has not been run yet.",
                "content_json": {"plan_id": plan_id, "activity_kind": "graph_plan_applied"},
            }
        )
        store_assistant.create_or_update_assistant_session({**session, "status": "active"})
    return AssistantPlanApplyResponse(plan=AssistantPlan(**updated), workflow=workflow, validation=validation, pricing=pricing)


@router.post("/sessions/{session_id}/cancel", response_model=AssistantSession)
def cancel_session(session_id: str) -> AssistantSession:
    record = store_assistant.get_assistant_session(session_id)
    if not record:
        raise _not_found("assistant session")
    cancel_tracked_session(session_id)
    return _shape_session(store_assistant.create_or_update_assistant_session({**record, "status": "active"}))


@router.post("/sessions/{session_id}/archive", response_model=AssistantSession)
def archive_session(session_id: str) -> AssistantSession:
    try:
        return _shape_session(store_assistant.archive_assistant_session(session_id))
    except KeyError:
        raise _not_found("assistant session")
