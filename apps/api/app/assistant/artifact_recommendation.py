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
    current_values: Tuple[Tuple[str, str], ...] = ()
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
    required: bool = False
    required_group: str | None = None
    default_value: Any = None


def _normalized_text(record: Dict[str, Any]) -> str:
    return " ".join(
        str(record.get(key) or "").strip().casefold()
        for key in ("key", "label", "description", "category", "output_format")
    )


def _producer_text(record: Dict[str, Any]) -> str:
    return " ".join(
        str(record.get(key) or "").strip().casefold()
        for key in ("key", "label")
    )


def _tokens(value: Any) -> frozenset[str]:
    return frozenset(
        token
        for token in re.split(r"[^a-z0-9]+", str(value or "").casefold())
        if token
    )


def _hard_excluded(record: Dict[str, Any]) -> bool:
    identity = re.sub(
        r"[^a-z0-9]+",
        "_",
        f"{record.get('key') or ''} {record.get('label') or ''}".casefold(),
    ).strip("_")
    notes = str(record.get("notes") or "").strip().casefold()
    description = str(record.get("description") or "").strip().casefold()
    return bool(
        identity.startswith("debug_")
        or re.search(r"(?:^|_)(?:internal|fixture)(?:_|$)", identity)
        or re.search(r"(?:^|_)(?:unit|integration|e2e)_test(?:_|$)", identity)
        or any(
            marker in f"_{identity}_"
            for marker in ("_deterministic_test_", "_attachment_test_", "_routing_test_", "_smoke_test_")
        )
        or notes.startswith("internal:")
        or "[internal]" in notes
        or notes in {"debug", "debug fixture", "regression fixture", "test fixture"}
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


def _artifact_inputs(kind: ArtifactKind, record: Dict[str, Any]) -> List[_ArtifactInput]:
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
        if not isinstance(field, dict) or field.get("enabled") is False:
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
                required=bool(field.get("required")),
                default_value=default_value,
            )
        )
    if kind == "media_preset":
        for slot in record.get("input_slots_json") or []:
            if not isinstance(slot, dict) or slot.get("enabled") is False:
                continue
            inputs.append(
                _ArtifactInput(
                    key=str(slot.get("key") or "reference_image"),
                    label=str(slot.get("label") or slot.get("key") or "Reference image"),
                    input_kind="image",
                    required=bool(slot.get("required")),
                    default_value=slot.get("default_value"),
                )
            )
    else:
        image_input = record.get("image_input_json") if isinstance(record.get("image_input_json"), dict) else {}
        if str(image_input.get("mode") or "none") != "none":
            max_files = max(1, int(image_input.get("max_files") or 1))
            roles = [
                str(role).strip()
                for role in image_input.get("reference_roles") or []
                if str(role).strip()
            ]
            required_group = "prompt_recipe_references" if bool(image_input.get("required")) else None
            for index in range(max_files):
                role = roles[index] if index < len(roles) else ""
                role_key = re.sub(r"[^a-z0-9]+", "_", role.casefold()).strip("_")
                if role_key:
                    key = f"reference_{role_key}"
                    label = f"{role.replace('_', ' ').title()} reference"
                elif max_files == 1:
                    key = "reference_image"
                    label = "Reference image"
                else:
                    key = f"reference_image_{index + 1}"
                    label = f"Reference image {index + 1}"
                inputs.append(
                    _ArtifactInput(
                        key=key,
                        label="Reference image" if required_group and index == 0 else label,
                        input_kind="image",
                        required=bool(required_group and index == 0),
                        required_group=required_group,
                    )
                )
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


def _resolve_inputs(
    inputs: Sequence[_ArtifactInput],
    context: ArtifactRecommendationContext,
) -> Tuple[Tuple[Tuple[str, str, str], ...], Tuple[str, ...]]:
    current_values = {str(key).casefold(): str(value) for key, value in context.current_values if str(value).strip()}
    story_values = {str(key).casefold(): str(value) for key, value in context.story_values if str(value).strip()}
    image_inputs = [item for item in inputs if item.input_kind == "image"]
    unused_references = list(enumerate(context.references))
    generic_reference_tokens = {"attachment", "image", "input", "media", "photo", "reference", "required", "optional"}
    resolved: List[Tuple[str, str, str]] = []
    missing: List[str] = []
    unresolved_images: List[_ArtifactInput] = []
    for item in inputs:
        if item.input_kind == "text":
            current_value = current_values.get(item.key.casefold())
            if current_value:
                resolved.append((item.key, "current_request", current_value[:1200]))
                continue
            exact_story_value = story_values.get(item.key.casefold())
            if exact_story_value:
                resolved.append((item.key, "story_state", exact_story_value[:1200]))
                continue
            if item.required and not _has_default(item.default_value):
                missing.append(item.label)
        elif context.references:
            input_tokens = _tokens(f"{item.key} {item.label}") - generic_reference_tokens
            matching_reference = next(
                (
                    (index, reference)
                    for index, reference in unused_references
                    if input_tokens & (_tokens(reference[1]) - generic_reference_tokens)
                ),
                None,
            )
            if matching_reference is not None:
                reference_index, reference = matching_reference
                resolved.append((item.key, "reference", reference[0]))
                unused_references = [entry for entry in unused_references if entry[0] != reference_index]
                continue
            unresolved_images.append(item)
        else:
            unresolved_images.append(item)

    for item in unresolved_images:
        if not unused_references:
            break
        reference_index, reference = unused_references.pop(0)
        resolved.append((item.key, "reference", reference[0]))

    resolved_image_keys = {
        key.casefold()
        for key, source, _value in resolved
        if source == "reference"
    }
    for item in image_inputs:
        if (
            item.required
            and not item.required_group
            and item.key.casefold() not in resolved_image_keys
            and not _has_default(item.default_value)
        ):
            missing.append(item.label)
    for group in {item.required_group for item in image_inputs if item.required_group}:
        grouped = [item for item in image_inputs if item.required_group == group]
        if not any(item.key.casefold() in resolved_image_keys for item in grouped):
            representative = next((item for item in grouped if item.required), grouped[0])
            if not _has_default(representative.default_value):
                missing.append(representative.label)
    return tuple(resolved), tuple(missing)


def _candidate_score(
    kind: ArtifactKind,
    record: Dict[str, Any],
    context: ArtifactRecommendationContext,
    resolved_count: int,
    missing_count: int,
) -> int:
    text = _normalized_text(record)
    producer_text = _producer_text(record)
    declared_stages = set()
    for owner_key in ("rules_json", "default_options_json"):
        owner = record.get(owner_key) if isinstance(record.get(owner_key), dict) else {}
        values = owner.get("assistant_recommendation_stages")
        if isinstance(values, list):
            declared_stages.update(str(stage) for stage in values)
    phrase_score = max(
        (
            85 if context.stage in declared_stages else 75
            for phrase in _STAGE_PHRASES[context.stage]
            if context.stage in declared_stages or phrase in producer_text
        ),
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
    inputs = _artifact_inputs(kind, record)
    required = [item for item in inputs if item.required]
    resolved, missing = _resolve_inputs(inputs, context)
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
    exclude_identities: Iterable[str] = (),
) -> List[SavedArtifactRecommendation]:
    resolved_model_task_modes = model_task_modes or {}
    excluded = set(exclude_identities)
    candidates = [
        candidate
        for kind, records in (("media_preset", presets), ("prompt_recipe", recipes))
        for record in records
        if (candidate := _recommendation(kind, record, context, resolved_model_task_modes)) is not None
        and candidate.identity not in excluded
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
