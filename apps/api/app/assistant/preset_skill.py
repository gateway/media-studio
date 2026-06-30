from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal


MediaPresetBuilderStatus = Literal[
    "intake",
    "reference_analysis",
    "contract_proposal",
    "user_clarification",
    "sandbox_plan",
    "prompt_quality_gate",
    "sandbox_run",
    "output_comparison",
    "prompt_refinement",
    "approved_save",
    "saved_preset_verification",
    "signoff",
]

MEDIA_PRESET_BUILDER_LIFECYCLE: tuple[MediaPresetBuilderStatus, ...] = (
    "intake",
    "reference_analysis",
    "contract_proposal",
    "user_clarification",
    "sandbox_plan",
    "prompt_quality_gate",
    "sandbox_run",
    "output_comparison",
    "prompt_refinement",
    "approved_save",
    "saved_preset_verification",
    "signoff",
)

PROMPT_QUALITY_MIN_SCORE = 9

PROMPT_META_BLOCKLIST = (
    "media preset",
    "graph studio",
    "temporary test",
    "temporary sandbox",
    "runtime image input",
    "runtime image inputs",
    "runtime subject",
    "source image slot",
    "actual preset",
    "assistant",
    "chat context",
    "prior attached references",
    "prior references",
    "extract the reusable style",
    "extract the reusable visual style",
    "create a preset",
    "test workflow",
)

PROMPT_COMPILER_FINGERPRINTS = (
    "render it as",
    "shape the image with",
    "compose it with",
    "treat the subject as",
    "visual direction",
    "visual mechanics",
    "fixed visual style",
    "signature style locks",
    "image input:",
)


@dataclass(frozen=True)
class PromptQualityResult:
    score: int
    passed: bool
    issues: List[str] = field(default_factory=list)


def initial_media_preset_builder_state(
    *,
    status: MediaPresetBuilderStatus = "intake",
    lane: str | None = None,
    reference_image_ids: List[str] | None = None,
    field_choices: List[Dict[str, Any]] | None = None,
    image_slot_choices: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    return {
        "skill": "create_media_preset",
        "status": status,
        "reference_image_ids": reference_image_ids or [],
        "approved_lane": lane,
        "style_brief_id": None,
        "style_brief_hash": None,
        "preset_variants": [],
        "field_choices": field_choices or [],
        "image_slot_choices": image_slot_choices or [],
        "latest_sandbox_workflow_id": None,
        "latest_output_asset_id": None,
        "latest_output_run_id": None,
        "latest_saved_preset_id": None,
    }


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _word_set(value: Any) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]{3,}", str(value or "").lower()) if token}


def _normalized_words(value: Any) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", str(value or "").lower().replace("_", " "))
        if token
    }


def _contains_field_reference(prompt: str, key: str) -> bool:
    lowered = prompt.lower()
    if key in lowered or key.replace("_", " ") in lowered:
        return True
    key_words = _normalized_words(key)
    # Concrete test prompts should read like user-facing prose. Count a key as
    # covered when punctuation-heavy labels such as "Scene / Subject" still
    # provide every meaningful key token.
    return bool(key_words) and key_words.issubset(_normalized_words(prompt))


def _negative_context_before(prompt: str, index: int) -> bool:
    prefix = prompt[max(0, index - 90) : index].lower()
    return any(term in prefix for term in ("do not", "don't", "avoid", "unless", "must not", "never", "without"))


def _trait_coverage(prompt: str, traits: List[str]) -> int:
    prompt_words = _word_set(prompt)
    coverage = 0
    for trait in traits[:12]:
        trait_words = _word_set(trait)
        if not trait_words:
            continue
        # Short fragments are allowed, but they need at least one specific word
        # present in the compiled prompt to count as covered.
        if len(prompt_words & trait_words) >= min(2, len(trait_words)):
            coverage += 1
    return coverage


def _source_specific_overfit_issues(prompt: str, exclusions: List[str]) -> List[str]:
    issues: List[str] = []
    lowered = prompt.lower()
    for exclusion in exclusions[:12]:
        cleaned = _clean(exclusion).lower().strip(" .,:;")
        if not cleaned:
            continue
        match = re.search(re.escape(cleaned), lowered)
        if match and not _negative_context_before(lowered, match.start()):
            issues.append(f"source-specific detail appears as required style: {cleaned}")
    return issues


def score_preset_prompt(
    prompt: str,
    *,
    style_traits: List[str],
    field_keys: List[str],
    image_slot_keys: List[str],
    source_specific_exclusions: List[str] | None = None,
    saved_template: bool = False,
) -> PromptQualityResult:
    text = _clean(prompt)
    lowered = text.lower()
    issues: List[str] = []
    score = 0

    if len(text.split()) >= 45 and _trait_coverage(text, style_traits) >= 3:
        score += 2
    else:
        issues.append("prompt lacks enough concrete visual style traits")

    direct_image_slot_keys = [key for key in image_slot_keys if key]
    if direct_image_slot_keys:
        slot_hits = 0
        for key in direct_image_slot_keys:
            token = f"[[{key}]]"
            if saved_template and token in text:
                slot_hits += 1
            elif not saved_template and ("provided" in lowered and "image" in lowered):
                slot_hits += 1
        if slot_hits >= len(direct_image_slot_keys):
            score += 2
        else:
            issues.append("prompt does not clearly reference every approved image input")
    else:
        score += 2

    direct_field_keys = [key for key in field_keys if key]
    if direct_field_keys:
        if saved_template:
            field_hits = sum(1 for key in direct_field_keys if f"{{{{{key}}}}}" in text)
        else:
            field_hits = sum(1 for key in direct_field_keys if _contains_field_reference(text, key))
        if field_hits >= len(direct_field_keys):
            score += 1
        else:
            issues.append(
                "prompt omits approved form field placeholders"
                if saved_template
                else "prompt omits concrete guidance for approved form fields"
            )
    else:
        score += 1

    blocked = [term for term in PROMPT_META_BLOCKLIST if term in lowered]
    if not blocked:
        score += 1
    else:
        issues.append("prompt contains product or planning language: " + ", ".join(blocked[:3]))

    overfit_issues = _source_specific_overfit_issues(text, source_specific_exclusions or [])
    if not overfit_issues:
        score += 1
    else:
        issues.extend(overfit_issues[:3])

    if "do not" in lowered or "avoid" in lowered or "must not" in lowered:
        score += 1
    else:
        issues.append("prompt lacks negative constraints")

    if image_slot_keys:
        if any(term in lowered for term in ("preserve", "identity", "recognizable", "likeness", "provided image content")):
            score += 1
        else:
            issues.append("image-to-image prompt lacks identity/input preservation guidance")
    else:
        score += 1

    if any(term in lowered for term in ("palette", "composition", "texture", "lighting", "typography", "line", "shape", "mood")):
        score += 1
    else:
        issues.append("prompt does not name major style mechanics")

    for fingerprint in PROMPT_COMPILER_FINGERPRINTS:
        if fingerprint in lowered:
            issues.append(f"prompt contains compiler-sounding wording: {fingerprint}")
            score -= 1

    if re.match(r"^create an? [a-z0-9 -]{2,80}\s+using\b", lowered):
        issues.append("prompt starts with a compiler-style create/title/using wrapper")
        score -= 1

    if not saved_template and ("{{" in text or "[[" in text):
        issues.append("test workflow prompt still contains raw preset placeholders")
        score -= 1

    final_score = max(0, min(10, score))
    return PromptQualityResult(score=final_score, passed=final_score >= PROMPT_QUALITY_MIN_SCORE, issues=issues)
