from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Literal, Sequence, Tuple


ArtifactKind = Literal["media_preset", "prompt_recipe"]
ProductionArtifactStage = Literal[
    "character_sheet",
    "environment",
    "storyboard",
    "video_prompt",
]
RequestedArtifactOutput = Literal["any", "image", "video", "prompt"]

RECOMMENDATION_LIMIT = 2
RECOMMENDATION_CONFIDENCE = 60

_INELIGIBLE_MARKERS = (
    "attachment",
    "debug",
    "fixture",
    "internal",
    "regression",
    "routing test",
    "smoke test",
    "test artifact",
)
_STAGE_PHRASES: Dict[ProductionArtifactStage, Tuple[str, ...]] = {
    "character_sheet": (
        "character sheet",
        "character reference",
        "character turnaround",
    ),
    "environment": (
        "environment sheet",
        "environment coverage",
        "environment plate",
        "location sheet",
    ),
    "storyboard": (
        "storyboard",
        "shot sequence",
    ),
    "video_prompt": (
        "seedance",
        "video director",
        "video prompt",
    ),
}
_STAGE_LABELS: Dict[ProductionArtifactStage, str] = {
    "character_sheet": "character-sheet stage",
    "environment": "environment stage",
    "storyboard": "storyboard stage",
    "video_prompt": "video-prompt stage",
}


@dataclass(frozen=True)
class ArtifactRecommendationContext:
    stage: ProductionArtifactStage
    requested_output: RequestedArtifactOutput = "any"
    reference_count: int = 0
    story_context_available: bool = False


@dataclass(frozen=True)
class SavedArtifactRecommendation:
    artifact_kind: ArtifactKind
    identity: str
    key: str
    label: str
    reason: str
    required_inputs: Tuple[str, ...]
    missing_required_inputs: Tuple[str, ...]
    score: int

    def as_dict(self) -> Dict[str, Any]:
        return {
            "artifact_kind": self.artifact_kind,
            "identity": self.identity,
            "key": self.key,
            "label": self.label,
            "reason": self.reason,
            "required_inputs": list(self.required_inputs),
            "missing_required_inputs": list(self.missing_required_inputs),
            "score": self.score,
        }


def _normalized_text(record: Dict[str, Any]) -> str:
    return " ".join(
        str(record.get(key) or "").strip().casefold()
        for key in ("key", "label", "description", "category", "output_format")
    )


def _explicit_eligibility(record: Dict[str, Any]) -> bool | None:
    for owner_key in ("rules_json", "default_options_json"):
        owner = record.get(owner_key) if isinstance(record.get(owner_key), dict) else {}
        value = owner.get("assistant_recommendation_eligible")
        if isinstance(value, bool):
            return value
    return None


def artifact_is_recommendation_eligible(record: Dict[str, Any]) -> bool:
    if str(record.get("status") or "").casefold() != "active":
        return False
    explicit = _explicit_eligibility(record)
    if explicit is not None:
        return explicit
    source_kind = str(record.get("source_kind") or "custom").casefold()
    if source_kind not in {"builtin", "built_in_override", "custom", "imported"}:
        return False
    text = _normalized_text(record)
    return not any(marker in text for marker in _INELIGIBLE_MARKERS)


def _is_output_compatible(
    kind: ArtifactKind,
    record: Dict[str, Any],
    requested_output: RequestedArtifactOutput,
) -> bool:
    if requested_output == "any":
        return True
    if kind == "prompt_recipe":
        category = str(record.get("category") or "").casefold()
        if requested_output == "video":
            return category == "video"
        if requested_output in {"image", "prompt"}:
            return category in {"image", "utility"}
        return False
    modes = {
        str(item).casefold()
        for item in record.get("applies_to_task_modes_json") or []
    }
    model_key = str(record.get("model_key") or "").casefold()
    if requested_output == "video":
        return bool(modes & {"text_to_video", "image_to_video", "reference_to_video"}) or "video" in model_key
    if requested_output == "image":
        return bool(modes & {"text_to_image", "image_edit", "image_to_image"}) or "image" in model_key
    return requested_output != "prompt"


def _required_inputs(kind: ArtifactKind, record: Dict[str, Any]) -> List[Tuple[str, str]]:
    inputs: List[Tuple[str, str]] = []
    fields: Sequence[Any]
    if kind == "media_preset":
        fields = record.get("input_schema_json") or []
    else:
        fields = [
            *(record.get("input_variables_json") or []),
            *(record.get("custom_fields_json") or []),
        ]
    for field in fields:
        if not isinstance(field, dict) or not bool(field.get("required")):
            continue
        key = str(field.get("key") or field.get("id") or "").strip()
        label = str(field.get("label") or key or "Required field").strip()
        input_kind = str(field.get("input_kind") or field.get("type") or "text").casefold()
        inputs.append((label, "image" if input_kind in {"image", "file", "media"} else "text"))
    if kind == "media_preset":
        for slot in record.get("input_slots_json") or []:
            if not isinstance(slot, dict) or not bool(slot.get("required")):
                continue
            inputs.append((str(slot.get("label") or slot.get("key") or "Reference image"), "image"))
    else:
        image_input = record.get("image_input_json") if isinstance(record.get("image_input_json"), dict) else {}
        if bool(image_input.get("required")) and str(image_input.get("mode") or "none") != "none":
            inputs.append(("Reference image", "image"))
    deduped: List[Tuple[str, str]] = []
    seen = set()
    for label, input_kind in inputs:
        normalized = label.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append((label, input_kind))
    return deduped


def _candidate_score(
    kind: ArtifactKind,
    record: Dict[str, Any],
    context: ArtifactRecommendationContext,
) -> int:
    text = _normalized_text(record)
    phrase_score = max(
        (75 for phrase in _STAGE_PHRASES[context.stage] if phrase in text),
        default=0,
    )
    if not phrase_score:
        return 0
    score = phrase_score
    if kind == "prompt_recipe":
        score += 25
    elif context.stage == "character_sheet" and str(record.get("category") or "").casefold() == "character":
        score += 20
    if context.story_context_available:
        score += 2
    if context.reference_count:
        score += 1
    return score


def _recommendation(
    kind: ArtifactKind,
    record: Dict[str, Any],
    context: ArtifactRecommendationContext,
) -> SavedArtifactRecommendation | None:
    if not artifact_is_recommendation_eligible(record):
        return None
    if not _is_output_compatible(kind, record, context.requested_output):
        return None
    score = _candidate_score(kind, record, context)
    if score < RECOMMENDATION_CONFIDENCE:
        return None
    identity_key = "preset_id" if kind == "media_preset" else "recipe_id"
    identity = str(record.get(identity_key) or "").strip()
    key = str(record.get("key") or identity).strip()
    label = str(record.get("label") or key).strip()
    if not identity or not label:
        return None
    required = _required_inputs(kind, record)
    missing = [
        label
        for label, input_kind in required
        if (
            input_kind == "image" and context.reference_count <= 0
        ) or (
            input_kind == "text" and not context.story_context_available
        )
    ]
    reason = f"Matches the {_STAGE_LABELS[context.stage]}"
    if required:
        reason += f" and declares {len(required)} required input{'s' if len(required) != 1 else ''}"
    return SavedArtifactRecommendation(
        artifact_kind=kind,
        identity=identity,
        key=key,
        label=label,
        reason=reason + ".",
        required_inputs=tuple(label for label, _input_kind in required),
        missing_required_inputs=tuple(missing),
        score=score,
    )


def recommend_saved_artifacts(
    context: ArtifactRecommendationContext,
    *,
    presets: Iterable[Dict[str, Any]],
    recipes: Iterable[Dict[str, Any]],
) -> List[SavedArtifactRecommendation]:
    candidates = [
        candidate
        for kind, records in (("media_preset", presets), ("prompt_recipe", recipes))
        for record in records
        if (candidate := _recommendation(kind, record, context)) is not None
    ]
    candidates.sort(
        key=lambda item: (
            -item.score,
            item.label.casefold(),
            item.artifact_kind,
            item.identity,
        )
    )
    return candidates[:RECOMMENDATION_LIMIT]
