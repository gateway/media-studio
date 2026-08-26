from __future__ import annotations

import hashlib
import re
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
    available_input_keys: list[str] = Field(default_factory=list, max_length=8)


class RecordArtifactRecommendationDecisionArguments(BaseModel):
    stage: ProductionArtifactStage
    stage_instance_id: Optional[str] = Field(
        default=None,
        max_length=120,
        pattern=r"^[a-z0-9][a-z0-9_-]*$",
    )
    decision: Literal["use", "direct", "alternatives"]
    artifact_kind: Optional[Literal["media_preset", "prompt_recipe"]] = None
    identity: Optional[str] = Field(default=None, max_length=160)


class ArtifactRecommendationToolError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


_STAGE_INPUT_KEYS = {
    "character_sheet": {"character_brief", "character_description", "subject", "user_prompt"},
    "environment": {"environment_brief", "scene_brief", "user_prompt"},
    "storyboard": {"scene_brief", "story_brief", "user_prompt"},
    "video_prompt": {"source_prompt", "storyboard_prompt_text", "user_prompt"},
}
_MAX_STAGE_INSTANCES = 8
_MAX_STAGE_ALIASES = 4
_MAX_STORY_VALUE_CHARS = 1200


def _state_key(
    arguments: RecommendSavedArtifactsArguments,
    context: Any,
    stages: Dict[str, Any],
) -> str:
    summary = context.session.get("summary_json") if isinstance(context.session.get("summary_json"), dict) else {}
    plan = summary.get("production_plan") if isinstance(summary.get("production_plan"), dict) else {}
    plan_step_ids = {
        str(step.get("step_id") or step.get("id") or "")
        for step in plan.get("steps") or []
        if isinstance(step, dict)
    }
    if arguments.stage_instance_id in plan_step_ids:
        return f"{arguments.stage}:plan:{arguments.stage_instance_id}"
    existing_alias_key = next(
        (
            key
            for key, state in reversed(list(stages.items()))
            if isinstance(state, dict)
            and str(state.get("stage") or "") == arguments.stage
            and str(state.get("stage_instance_id") or "") == arguments.stage_instance_id
        ),
        None,
    )
    if existing_alias_key:
        return existing_alias_key
    normalized_purpose = re.sub(r"\s+", " ", arguments.purpose.strip().casefold())
    purpose_hash = hashlib.sha256(
        f"{arguments.stage}\n{normalized_purpose}".encode("utf-8")
    ).hexdigest()[:16]
    return f"{arguments.stage}:purpose:{purpose_hash}"


def _current_values(arguments: RecommendSavedArtifactsArguments, context: Any) -> tuple[tuple[str, str], ...]:
    allowed = _STAGE_INPUT_KEYS[arguments.stage]
    user_text = str(getattr(context, "user_text", "") or "").strip()
    return tuple(
        (key, user_text[:1200])
        for key in dict.fromkeys(arguments.available_input_keys)
        if key in allowed and user_text
    )


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
    return tuple(
        sorted((key, value[:_MAX_STORY_VALUE_CHARS]) for key, value in values.items())
    )


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


def _recommendation_candidates(
    recommendation_context: Dict[str, Any],
    *,
    exclude_identities: list[str] | None = None,
) -> list[Dict[str, Any]]:
    context = ArtifactRecommendationContext(
        stage=recommendation_context["stage"],
        requested_output=recommendation_context["requested_output"],
        purpose=str(recommendation_context.get("purpose") or ""),
        current_values=tuple(tuple(item) for item in recommendation_context.get("current_values") or []),
        story_values=tuple(tuple(item) for item in recommendation_context.get("story_values") or []),
        references=tuple(tuple(item) for item in recommendation_context.get("references") or []),
    )
    return [
        candidate.as_dict()
        for candidate in recommend_saved_artifacts(
            context,
            presets=store.list_presets(),
            recipes=store.list_prompt_recipes(status="active"),
            model_task_modes=_model_task_modes(),
            exclude_identities=exclude_identities or [],
        )
    ]


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
    state_key = _state_key(options, context, stages)
    existing = stages.get(state_key)
    if isinstance(existing, dict):
        aliases = list(
            dict.fromkeys(
                [
                    *(str(alias) for alias in existing.get("stage_instance_aliases") or [] if str(alias)),
                    str(existing.get("stage_instance_id") or ""),
                    options.stage_instance_id,
                ]
            )
        )[-_MAX_STAGE_ALIASES:]
        if aliases != existing.get("stage_instance_aliases"):
            existing = {**existing, "stage_instance_aliases": aliases}
            stages[state_key] = existing
            _persist_recommendation_summary(context, {**recommendation, "stages": stages})
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
    recommendation_context = {
        "stage": options.stage,
        "requested_output": options.requested_output,
        "purpose": options.purpose,
        "current_values": list(_current_values(options, context)),
        "story_values": list(_story_values(story_state)),
        "references": list(_references(context.attachments)),
    }
    items = _recommendation_candidates(recommendation_context)
    state = {
        "status": "offered" if items else "no_match",
        "requested_output": options.requested_output,
        "stage": options.stage,
        "stage_instance_id": options.stage_instance_id,
        "stage_instance_aliases": [options.stage_instance_id],
        "stage_key": state_key,
        "purpose": options.purpose,
        "recommendation_context": recommendation_context,
        "excluded_identities": [],
        "candidates": items,
        "offered_message_id": context.user_message_id,
    }
    stages[state_key] = state
    while len(stages) > _MAX_STAGE_INSTANCES:
        stages.pop(next(iter(stages)))
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
        state_key, existing = next(
            (
                (key, state)
                for key, state in reversed(list(stages.items()))
                if isinstance(state, dict)
                and str(state.get("stage") or "") == options.stage
                and options.stage_instance_id
                in {
                    str(state.get("stage_instance_id") or ""),
                    *(str(alias) for alias in state.get("stage_instance_aliases") or []),
                }
                and str(state.get("status") or "") == "offered"
            ),
            ("", None),
        )
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

    if options.decision == "alternatives":
        excluded = [
            *(
                str(identity)
                for identity in existing.get("excluded_identities") or []
                if str(identity)
            ),
            *(
                str(candidate.get("identity") or "")
                for candidate in existing.get("candidates") or []
                if isinstance(candidate, dict) and str(candidate.get("identity") or "")
            ),
        ]
        recommendation_context = existing.get("recommendation_context")
        if not isinstance(recommendation_context, dict):
            raise ArtifactRecommendationToolError(
                code="artifact_recommendation_context_missing",
                message="The saved-artifact search context is no longer available; continue with direct construction.",
                retryable=False,
            )
        items = _recommendation_candidates(
            recommendation_context,
            exclude_identities=list(dict.fromkeys(excluded)),
        )
        state = {
            **existing,
            "status": "offered" if items else "no_match",
            "candidates": items,
            "excluded_identities": list(dict.fromkeys(excluded)),
            "decision_message_id": context.user_message_id,
        }
        stages[state_key] = state
        _persist_recommendation_summary(context, {**recommendation, "stages": stages})
        return {
            "stage": options.stage,
            "stage_instance_id": existing.get("stage_instance_id"),
            "status": state["status"],
            "candidates": items,
            "direct_construction_available": True,
            "searched": True,
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
