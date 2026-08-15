from __future__ import annotations

import re
from typing import Any, Dict, Iterable

from ..schemas import PresetUpsertRequest


_WORD_RE = re.compile(r"[a-z0-9]+")
_GENERIC_FIELD_LABELS = {
    "accent palette",
    "character role",
    "detail notes",
    "hero archetype",
    "hero brief",
    "optional notes",
    "scene brief",
    "style notes",
    "subject archetype",
    "subject brief",
}


def _normalized_words(value: Any) -> list[str]:
    return _WORD_RE.findall(str(value or "").lower())


def latest_reference_analysis(summary: Dict[str, Any]) -> Dict[str, Any] | None:
    cache = summary.get("reference_analysis_cache")
    if not isinstance(cache, dict):
        return None
    for entry in reversed(list(cache.values())):
        if (
            not isinstance(entry, dict)
            or not entry.get("reference_ids")
            or str(entry.get("goal") or "") not in {"preset_design", "style_reference"}
        ):
            continue
        analysis = entry.get("analysis")
        values = analysis.get("replaceable_elements") if isinstance(analysis, dict) else None
        if isinstance(values, list):
            return entry
    return None


def latest_replaceable_elements(
    summary: Dict[str, Any],
    *,
    analysis_id: str = "",
) -> list[str]:
    cache = summary.get("reference_analysis_cache")
    if not isinstance(cache, dict):
        return []
    entries = list(cache.values())
    if analysis_id:
        entries = [
            entry
            for entry in entries
            if isinstance(entry, dict)
            and str(entry.get("analysis_id") or "") == analysis_id
        ]
    else:
        approved = latest_reference_analysis(summary)
        if approved:
            entries = [approved]
    for entry in reversed(entries):
        analysis = entry.get("analysis") if isinstance(entry, dict) else None
        values = analysis.get("replaceable_elements") if isinstance(analysis, dict) else None
        if isinstance(values, list):
            return [str(value).strip() for value in values if str(value).strip()]
    return []


def validate_assistant_preset_fields(
    draft: PresetUpsertRequest,
    *,
    replaceable_elements: Iterable[str] = (),
    user_text: str = "",
) -> Dict[str, Any]:
    issues: list[str] = []
    if not 1 <= len(draft.input_schema_json) <= 3:
        issues.append("Use between one and three concrete text fields.")
    normalized_user_text = " ".join(_normalized_words(user_text))
    user_phrase_haystack = f" {normalized_user_text} "
    normalized_evidence = {
        " ".join(_normalized_words(value))
        for value in replaceable_elements
        if _normalized_words(value)
    }
    field_evidence = draft.rules_json.get("field_evidence")
    if normalized_evidence and not isinstance(field_evidence, dict):
        issues.append(
            "Reference-based fields need rules_json.field_evidence keyed by field key."
        )
        field_evidence = {}
    for field in draft.input_schema_json:
        key = str(field.get("key") or "").strip()
        label = str(field.get("label") or field.get("key") or "").strip()
        label_words = _normalized_words(label)
        placeholder = str(field.get("placeholder") or "").strip()
        help_text = str(field.get("help_text") or field.get("description") or "").strip()
        if not label or len(label_words) > 5:
            issues.append("Each field needs a short, user-facing label of at most five words.")
        if not placeholder:
            issues.append(f'Field "{label}" needs an example or input hint.')
        if len(_normalized_words(help_text)) < 3:
            issues.append(f'Field "{label}" must explain what it changes in the output.')
        normalized_label = " ".join(label_words)
        explicitly_requested = bool(
            normalized_label and f" {normalized_label} " in user_phrase_haystack
        )
        if normalized_label in _GENERIC_FIELD_LABELS and not explicitly_requested:
            issues.append(
                f'Field "{label}" is too broad. Name one concrete replaceable element instead.'
            )
        if normalized_evidence:
            evidence = " ".join(_normalized_words(field_evidence.get(key)))
            grounded_by_reference = evidence in normalized_evidence
            grounded_by_user = bool(
                evidence and f" {evidence} " in user_phrase_haystack
            )
            if not evidence or not (grounded_by_reference or grounded_by_user):
                issues.append(
                    f'Field "{label}" needs evidence from replaceable_elements or the user request.'
                )
    if issues:
        raise ValueError(" ".join(issues))
    return {
        "score": 10,
        "passed": True,
        "field_count": len(draft.input_schema_json),
        "evidence_count": len(field_evidence) if isinstance(field_evidence, dict) else 0,
    }
