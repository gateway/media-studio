from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field

from .. import store, store_assistant
from .artifact_recommendation import (
    ArtifactRecommendationContext,
    ProductionArtifactStage,
    RequestedArtifactOutput,
    recommend_saved_artifacts,
)


class RecommendSavedArtifactsArguments(BaseModel):
    stage: ProductionArtifactStage
    requested_output: RequestedArtifactOutput = "any"


class RecordArtifactRecommendationDecisionArguments(BaseModel):
    stage: ProductionArtifactStage
    decision: Literal["use", "direct"]
    artifact_kind: Optional[Literal["media_preset", "prompt_recipe"]] = None
    identity: Optional[str] = Field(default=None, max_length=160)


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
    existing = stages.get(options.stage)
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
            reference_count=sum(
                1
                for attachment in context.attachments
                if str(attachment.get("kind") or "image") == "image"
            ),
            story_context_available=bool(story_state),
        ),
        presets=store.list_presets(),
        recipes=store.list_prompt_recipes(status="active"),
    )
    items = [candidate.as_dict() for candidate in candidates]
    state = {
        "status": "offered" if items else "no_match",
        "requested_output": options.requested_output,
        "candidates": items,
        "offered_message_id": context.user_message_id,
    }
    stages[options.stage] = state
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
    existing = stages.get(options.stage)
    if not isinstance(existing, dict) or str(existing.get("status") or "") != "offered":
        raise ValueError("No saved-artifact recommendation is awaiting a decision for this stage.")

    if options.decision == "direct":
        state = {
            **existing,
            "status": "declined",
            "candidates": [],
            "decision_message_id": context.user_message_id,
        }
        stages[options.stage] = state
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
        raise ValueError("Select one of the exact saved artifacts that was offered for this stage.")
    state = {
        **existing,
        "status": "selected",
        "selected": selected,
        "decision_message_id": context.user_message_id,
    }
    stages[options.stage] = state
    _persist_recommendation_summary(context, {**recommendation, "stages": stages})
    return {
        "stage": options.stage,
        "status": "selected",
        "artifact_kind": selected["artifact_kind"],
        "identity": selected["identity"],
        "key": selected["key"],
        "label": selected["label"],
        "missing_required_inputs": selected.get("missing_required_inputs") or [],
        "provenance": {
            "source": "saved_artifact_catalog",
            "artifact_kind": selected["artifact_kind"],
            "identity": selected["identity"],
            "key": selected["key"],
        },
    }
