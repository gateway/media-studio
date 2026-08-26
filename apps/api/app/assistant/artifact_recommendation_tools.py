from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field

from .. import kie_adapter, store, store_assistant
from .artifact_recommendation import (
    ArtifactRecommendationContext,
    ProductionArtifactStage,
    RequestedArtifactOutput,
    recommend_saved_artifacts,
)


class RecommendSavedArtifactsArguments(BaseModel):
    stage: ProductionArtifactStage
    stage_instance_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    requested_output: RequestedArtifactOutput = "any"
    purpose: str = Field(min_length=1, max_length=500)


class RecordArtifactRecommendationDecisionArguments(BaseModel):
    stage: ProductionArtifactStage
    stage_instance_id: Optional[str] = Field(
        default=None,
        max_length=120,
        pattern=r"^[a-z0-9][a-z0-9_-]*$",
    )
    decision: Literal["use", "direct"]
    artifact_kind: Optional[Literal["media_preset", "prompt_recipe"]] = None
    identity: Optional[str] = Field(default=None, max_length=160)


class ArtifactRecommendationToolError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def _state_key(stage: str, stage_instance_id: str) -> str:
    return f"{stage}:{stage_instance_id}"


def _model_task_modes() -> Dict[str, tuple[str, ...]]:
    return {
        str(model.get("key") or ""): tuple(str(mode) for mode in model.get("task_modes") or [])
        for model in kie_adapter.list_models()
        if model.get("studio_exposed") is not False and str(model.get("key") or "")
    }


def _story_values(story_state: Any) -> tuple[tuple[str, str], ...]:
    if not isinstance(story_state, dict):
        return ()
    values: Dict[str, str] = {}
    premise = str(story_state.get("premise") or "").strip()
    visual_style = str(story_state.get("visual_style") or "").strip()
    if premise:
        values["story_brief"] = premise
        values["scene_brief"] = premise
    if visual_style:
        values["visual_style"] = visual_style
    characters = story_state.get("characters") or []
    character_text = "\n".join(
        " — ".join(
            value
            for value in (
                str(character.get("name") or "").strip(),
                str(character.get("description") or "").strip(),
            )
            if value
        )
        for character in characters
        if isinstance(character, dict)
    ).strip()
    if character_text:
        values["character_brief"] = character_text
        values["character_description"] = character_text
    environment_text = "\n".join(
        str(shot.get("environment") or "").strip()
        for shot in story_state.get("shots") or []
        if isinstance(shot, dict) and str(shot.get("environment") or "").strip()
    )
    if environment_text:
        values["environment_brief"] = environment_text
    storyboard_prompt = "\n".join(
        str(shot.get("prompt") or shot.get("story_beat") or "").strip()
        for shot in story_state.get("shots") or []
        if isinstance(shot, dict)
        and str(shot.get("prompt") or shot.get("story_beat") or "").strip()
    )
    if storyboard_prompt:
        values["source_prompt"] = storyboard_prompt
        values["storyboard_prompt_text"] = storyboard_prompt
    return tuple(sorted(values.items()))


def _references(attachments: Any) -> tuple[tuple[str, str], ...]:
    return tuple(
        (
            str(attachment.get("reference_id") or attachment.get("assistant_attachment_id") or ""),
            " ".join(
                value
                for value in (
                    str(attachment.get("label") or "").strip(),
                    str((attachment.get("metadata_json") or {}).get("role") or "").strip()
                    if isinstance(attachment.get("metadata_json"), dict)
                    else "",
                )
                if value
            ) or "reference image",
        )
        for attachment in attachments or []
        if str(attachment.get("kind") or "image") == "image"
        and str(attachment.get("reference_id") or attachment.get("assistant_attachment_id") or "")
    )


def _recommendation_summary(context: Any) -> Dict[str, Any]:
    summary = context.session.get("summary_json")
    if not isinstance(summary, dict):
        summary = {}
    recommendation = summary.get("kernel_artifact_recommendation")
    if not isinstance(recommendation, dict):
        recommendation = {}
    stages = recommendation.get("stages")
    return {
        **recommendation,
        "stages": dict(stages) if isinstance(stages, dict) else {},
    }


def _persist_recommendation_summary(context: Any, recommendation: Dict[str, Any]) -> None:
    summary = context.session.get("summary_json")
    if not isinstance(summary, dict):
        summary = {}
    stored = store_assistant.create_or_update_assistant_session(
        {
            **context.session,
            "summary_json": {
                **summary,
                "kernel_artifact_recommendation": recommendation,
            },
        }
    )
    context.session.update(stored)


def recommend_saved_artifacts_tool(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = RecommendSavedArtifactsArguments.model_validate(arguments)
    recommendation = _recommendation_summary(context)
    stages = recommendation["stages"]
    state_key = _state_key(options.stage, options.stage_instance_id)
    existing = stages.get(state_key)
    if isinstance(existing, dict):
        status = str(existing.get("status") or "")
        if status == "declined":
            return {
                "stage": options.stage,
                "status": "declined",
                "candidates": [],
                "direct_construction_available": True,
                "searched": False,
            }
        if status in {"offered", "selected", "no_match"}:
            return {
                **existing,
                "stage": options.stage,
                "direct_construction_available": True,
                "searched": False,
            }

    story_state = context.session.get("summary_json") or {}
    story_state = story_state.get("kernel_story_state") if isinstance(story_state, dict) else None
    candidates = recommend_saved_artifacts(
        ArtifactRecommendationContext(
            stage=options.stage,
            requested_output=options.requested_output,
            purpose=options.purpose,
            story_values=_story_values(story_state),
            references=_references(context.attachments),
        ),
        presets=store.list_presets(),
        recipes=store.list_prompt_recipes(status="active"),
        model_task_modes=_model_task_modes(),
    )
    items = [candidate.as_dict() for candidate in candidates]
    state = {
        "status": "offered" if items else "no_match",
        "requested_output": options.requested_output,
        "stage": options.stage,
        "stage_instance_id": options.stage_instance_id,
        "purpose": options.purpose,
        "candidates": items,
        "offered_message_id": context.user_message_id,
    }
    stages[state_key] = state
    _persist_recommendation_summary(
        context,
        {**recommendation, "stages": stages},
    )
    return {
        "stage": options.stage,
        **state,
        "direct_construction_available": True,
        "searched": True,
    }


def record_artifact_recommendation_decision(
    arguments: BaseModel,
    context: Any,
) -> Dict[str, Any]:
    options = RecordArtifactRecommendationDecisionArguments.model_validate(arguments)
    recommendation = _recommendation_summary(context)
    stages = recommendation["stages"]
    if options.stage_instance_id:
        state_key = _state_key(options.stage, options.stage_instance_id)
        existing = stages.get(state_key)
    else:
        state_key, existing = next(
            (
                (key, state)
                for key, state in reversed(list(stages.items()))
                if isinstance(state, dict)
                and str(state.get("stage") or "") == options.stage
                and str(state.get("status") or "") == "offered"
            ),
            ("", None),
        )
    if not isinstance(existing, dict) or str(existing.get("status") or "") != "offered":
        raise ArtifactRecommendationToolError(
            code="artifact_recommendation_not_pending",
            message="No saved-artifact recommendation is awaiting a decision for this stage instance.",
        )

    if options.decision == "direct":
        state = {
            **existing,
            "status": "declined",
            "candidates": [],
            "decision_message_id": context.user_message_id,
        }
        stages[state_key] = state
        _persist_recommendation_summary(context, {**recommendation, "stages": stages})
        return {
            "stage": options.stage,
            "status": "declined",
            "direct_construction_available": True,
        }

    identity = str(options.identity or "").strip()
    artifact_kind = str(options.artifact_kind or "").strip()
    selected = next(
        (
            item
            for item in existing.get("candidates") or []
            if isinstance(item, dict)
            and str(item.get("identity") or "") == identity
            and str(item.get("artifact_kind") or "") == artifact_kind
        ),
        None,
    )
    if selected is None:
        raise ArtifactRecommendationToolError(
            code="artifact_recommendation_selection_invalid",
            message="Select one of the exact saved artifacts that was offered for this stage instance.",
        )
    state = {
        **existing,
        "status": "selected",
        "selected": selected,
        "decision_message_id": context.user_message_id,
    }
    stages[state_key] = state
    _persist_recommendation_summary(context, {**recommendation, "stages": stages})
    return {
        "stage": options.stage,
        "status": "selected",
        "artifact_kind": selected["artifact_kind"],
        "identity": selected["identity"],
        "key": selected["key"],
        "label": selected["label"],
        "missing_required_inputs": selected.get("missing_required_inputs") or [],
        "resolved_input_bindings": selected.get("resolved_input_bindings") or [],
        "provenance": {
            "source": "saved_artifact_catalog",
            "artifact_kind": selected["artifact_kind"],
            "identity": selected["identity"],
            "key": selected["key"],
        },
    }
