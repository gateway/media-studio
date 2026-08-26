from __future__ import annotations

from dataclasses import dataclass
import re
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

_TECHNICAL_ARTIFACT_TOKENS = frozenset(
    {"debug", "fixture", "internal", "regression", "test"}
)
_TECHNICAL_DESCRIPTIONS = frozenset(
    {
        "debug",
        "debug fixture",
        "deterministic planner test preset.",
        "saved i2i preset button routing regression.",
        "saved preset button routing regression.",
        "saved prompt recipe button routing regression.",
    }
)
_PURPOSE_INPUT_TOKENS = frozenset(
    {"brief", "character", "description", "environment", "scene", "story", "subject"}
)
_PURPOSE_STOPWORDS = frozenset(
    {
        "a", "an", "and", "for", "from", "image", "into", "of", "or", "prompt", "recipe",
        "sheet", "stage", "the", "to", "turn", "use", "video", "with",
    }
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
    purpose: str = ""
    story_values: Tuple[Tuple[str, str], ...] = ()
    references: Tuple[Tuple[str, str], ...] = ()


@dataclass(frozen=True)
class SavedArtifactRecommendation:
    artifact_kind: ArtifactKind
    identity: str
    key: str
    label: str
    reason: str
    required_inputs: Tuple[str, ...]
    missing_required_inputs: Tuple[str, ...]
    resolved_input_bindings: Tuple[Tuple[str, str, str], ...]
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
            "resolved_input_bindings": [
                {"input_key": key, "source": source, "value": value}
                for key, source, value in self.resolved_input_bindings
            ],
            "score": self.score,
        }


@dataclass(frozen=True)
class _ArtifactInput:
    key: str
    label: str
    input_kind: Literal["text", "image"]
    default_value: Any = None


def _normalized_text(record: Dict[str, Any]) -> str:
    return " ".join(
        str(record.get(key) or "").strip().casefold()
        for key in ("key", "label", "description", "category", "output_format")
    )


def _tokens(value: Any) -> frozenset[str]:
    return frozenset(
        token
        for token in re.split(r"[^a-z0-9]+", str(value or "").casefold())
        if token
    )


def _hard_excluded(record: Dict[str, Any]) -> bool:
    identity_tokens = _tokens(f"{record.get('key') or ''} {record.get('label') or ''}")
    notes_tokens = _tokens(record.get("notes"))
    description = str(record.get("description") or "").strip().casefold()
    return bool(
        identity_tokens & _TECHNICAL_ARTIFACT_TOKENS
        or notes_tokens & _TECHNICAL_ARTIFACT_TOKENS
        or description in _TECHNICAL_DESCRIPTIONS
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
    if _hard_excluded(record):
        return False
    explicit = _explicit_eligibility(record)
    if explicit is not None:
        return explicit
    source_kind = str(record.get("source_kind") or "custom").casefold()
    if source_kind not in {"builtin", "built_in_override", "custom", "imported"}:
        return False
    return True


def _is_output_compatible(
    kind: ArtifactKind,
    record: Dict[str, Any],
    requested_output: RequestedArtifactOutput,
    model_task_modes: Dict[str, Tuple[str, ...]],
) -> bool:
    if requested_output == "any":
        return True
    if kind == "prompt_recipe":
        category = str(record.get("category") or "").casefold()
        if requested_output == "video":
            return category == "video"
        if requested_output == "prompt":
            return category in {"image", "utility", "video"}
        if requested_output == "image":
            return category in {"image", "utility"}
        return False
    modes = {
        str(item).casefold()
        for item in (
            record.get("applies_to_task_modes_json")
            or model_task_modes.get(str(record.get("model_key") or ""), ())
        )
    }
    model_key = str(record.get("model_key") or "").casefold()
    if requested_output == "video":
        return bool(modes & {"text_to_video", "image_to_video", "reference_to_video"}) or "video" in model_key
    if requested_output == "image":
        return bool(modes & {"text_to_image", "image_edit", "image_to_image"}) or "image" in model_key
    return requested_output != "prompt"


def _required_inputs(kind: ArtifactKind, record: Dict[str, Any]) -> List[_ArtifactInput]:
    inputs: List[_ArtifactInput] = []
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
        default_value = field.get("default_value") if "default_value" in field else field.get("default")
        inputs.append(
            _ArtifactInput(
                key=key or re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_"),
                label=label,
                input_kind="image" if input_kind in {"image", "file", "media"} else "text",
                default_value=default_value,
            )
        )
    if kind == "media_preset":
        for slot in record.get("input_slots_json") or []:
            if not isinstance(slot, dict) or not bool(slot.get("required")):
                continue
            inputs.append(
                _ArtifactInput(
                    key=str(slot.get("key") or "reference_image"),
                    label=str(slot.get("label") or slot.get("key") or "Reference image"),
                    input_kind="image",
                    default_value=slot.get("default_value"),
                )
            )
    else:
        image_input = record.get("image_input_json") if isinstance(record.get("image_input_json"), dict) else {}
        if bool(image_input.get("required")) and str(image_input.get("mode") or "none") != "none":
            inputs.append(_ArtifactInput(key="reference_image", label="Reference image", input_kind="image"))
    deduped: List[_ArtifactInput] = []
    seen = set()
    for item in inputs:
        normalized = item.key.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(item)
    return deduped


def _has_default(value: Any) -> bool:
    return value is not None and (not isinstance(value, str) or bool(value.strip()))


def _purpose_can_fill(item: _ArtifactInput, context: ArtifactRecommendationContext) -> bool:
    if not context.purpose.strip():
        return False
    if item.key.casefold() == "user_prompt":
        return True
    field_tokens = _tokens(f"{item.key} {item.label}")
    stage_tokens = {
        "character_sheet": {"brief", "character", "description", "subject"},
        "environment": {"brief", "environment"},
        "storyboard": {"brief", "scene", "story"},
        "video_prompt": set(),
    }[context.stage]
    return bool(field_tokens & _PURPOSE_INPUT_TOKENS & stage_tokens)


def _resolve_inputs(
    required: Sequence[_ArtifactInput],
    context: ArtifactRecommendationContext,
) -> Tuple[Tuple[Tuple[str, str, str], ...], Tuple[str, ...]]:
    story_values = {str(key).casefold(): str(value) for key, value in context.story_values if str(value).strip()}
    image_inputs = [item for item in required if item.input_kind == "image" and not _has_default(item.default_value)]
    resolved: List[Tuple[str, str, str]] = []
    missing: List[str] = []
    for item in required:
        if _has_default(item.default_value):
            resolved.append((item.key, "default", str(item.default_value)))
            continue
        if item.input_kind == "text":
            exact_story_value = story_values.get(item.key.casefold())
            if exact_story_value:
                resolved.append((item.key, "story_state", exact_story_value[:1200]))
                continue
            if _purpose_can_fill(item, context):
                resolved.append((item.key, "current_request", context.purpose.strip()[:1200]))
                continue
        elif context.references:
            input_tokens = _tokens(f"{item.key} {item.label}")
            matching_reference = next(
                (
                    reference
                    for reference in context.references
                    if input_tokens & _tokens(reference[1])
                ),
                None,
            )
            if matching_reference is None and len(image_inputs) == 1:
                matching_reference = context.references[0]
            if matching_reference is not None:
                resolved.append((item.key, "reference", matching_reference[0]))
                continue
        missing.append(item.label)
    return tuple(resolved), tuple(missing)


def _candidate_score(
    kind: ArtifactKind,
    record: Dict[str, Any],
    context: ArtifactRecommendationContext,
    resolved_count: int,
    missing_count: int,
) -> int:
    text = _normalized_text(record)
    phrase_score = max(
        (75 for phrase in _STAGE_PHRASES[context.stage] if phrase in text),
        default=0,
    )
    if not phrase_score:
        return 0
    purpose_tokens = _tokens(context.purpose) - _PURPOSE_STOPWORDS
    record_tokens = _tokens(text) - _PURPOSE_STOPWORDS
    purpose_overlap = len(purpose_tokens & record_tokens)
    priority = max(0, int(record.get("priority") or 0))
    score = phrase_score + min(20, purpose_overlap * 4) + min(15, priority // 50)
    score += min(3, resolved_count) - min(12, missing_count * 3)
    return score


def _recommendation(
    kind: ArtifactKind,
    record: Dict[str, Any],
    context: ArtifactRecommendationContext,
    model_task_modes: Dict[str, Tuple[str, ...]],
) -> SavedArtifactRecommendation | None:
    if not artifact_is_recommendation_eligible(record):
        return None
    if not _is_output_compatible(kind, record, context.requested_output, model_task_modes):
        return None
    required = _required_inputs(kind, record)
    resolved, missing = _resolve_inputs(required, context)
    score = _candidate_score(kind, record, context, len(resolved), len(missing))
    if score < RECOMMENDATION_CONFIDENCE:
        return None
    identity_key = "preset_id" if kind == "media_preset" else "recipe_id"
    identity = str(record.get(identity_key) or "").strip()
    key = str(record.get("key") or identity).strip()
    label = str(record.get("label") or key).strip()
    if not identity or not label:
        return None
    reason = f"Matches the {_STAGE_LABELS[context.stage]}"
    if required:
        reason += f" and declares {len(required)} required input{'s' if len(required) != 1 else ''}"
    return SavedArtifactRecommendation(
        artifact_kind=kind,
        identity=identity,
        key=key,
        label=label,
        reason=reason + ".",
        required_inputs=tuple(item.label for item in required),
        missing_required_inputs=missing,
        resolved_input_bindings=resolved,
        score=score,
    )


def recommend_saved_artifacts(
    context: ArtifactRecommendationContext,
    *,
    presets: Iterable[Dict[str, Any]],
    recipes: Iterable[Dict[str, Any]],
    model_task_modes: Dict[str, Tuple[str, ...]] | None = None,
) -> List[SavedArtifactRecommendation]:
    resolved_model_task_modes = model_task_modes or {}
    candidates = [
        candidate
        for kind, records in (("media_preset", presets), ("prompt_recipe", recipes))
        for record in records
        if (candidate := _recommendation(kind, record, context, resolved_model_task_modes)) is not None
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
