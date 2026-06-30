from __future__ import annotations

import re
from typing import Any, Dict, List


def _slug(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")


def _display_label(value: str) -> str:
    cleaned = " ".join(value.split()).strip()
    if cleaned and cleaned == cleaned.lower():
        return " / ".join(part.strip().title() for part in cleaned.split(" / "))
    return cleaned


def infer_runtime_image_slots_from_text(message: str) -> List[Dict[str, Any]]:
    """Infer explicit runtime image slots from normal user phrasing.

    Reference/style attachments are not runtime inputs. This helper only returns
    slots when the user asks for an image input/input image in the preset.
    """
    text = " ".join(str(message or "").split())
    lowered = text.lower()
    face_body_input = re.search(r"\bface\b.{0,40}\bbody\b.{0,30}\binputs?\b", lowered) or re.search(
        r"\binputs?\b.{0,30}\bface\b.{0,40}\bbody\b",
        lowered,
    )
    if "image input" not in lowered and "input image" not in lowered and not face_body_input:
        return []

    count_map = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
    }
    requested_count = 0
    count_match = re.search(r"\b(\d+|one|two|three|four|five)\s+(?:runtime\s+)?(?:image inputs?|input images?)\b", lowered)
    if count_match:
        raw_count = count_match.group(1)
        requested_count = int(raw_count) if raw_count.isdigit() else count_map.get(raw_count, 0)

    labels: List[str] = []
    if face_body_input:
        labels = ["Face Reference", "Body Reference"]

    named_match = re.search(
        r"\b(?:runtime\s+)?(?:image input|input image)s?\s+named\s+(.+?)(?:[.;]|\n|$)",
        text,
        flags=re.IGNORECASE,
    )
    if not labels and named_match:
        raw_names = named_match.group(1)
        raw_names = re.sub(r"\b(?:before|then|and then|with fields?|fields?)\b.*$", "", raw_names, flags=re.IGNORECASE).strip()
        labels = [part.strip(" `\"'.,;:-") for part in re.split(r"\s*,\s*|\s+\band\b\s+", raw_names) if part.strip(" `\"'.,;:-")]
        if requested_count > 1 and len(labels) == 1:
            words = labels[0].split()
            image_chunks: List[str] = []
            current_chunk: List[str] = []
            for word in words:
                current_chunk.append(word)
                if word.lower().strip(".,;:-") == "image":
                    image_chunks.append(" ".join(current_chunk))
                    current_chunk = []
            if len(image_chunks) == requested_count:
                labels = image_chunks

    if not labels:
        role_pair_match = re.search(
            r"\b(?:one|1|first|image\s*1)\s+(?:as|for|is)\s+(?:a|an|the\s+)?(.+?)\s+(?:and|,)\s+(?:one|1|second|image\s*2)\s+(?:as|for|is)\s+(?:a|an|the\s+)?(.+?)(?:[.;]|\n|$)",
            text,
            flags=re.IGNORECASE,
        )
        if role_pair_match:
            labels = [
                role_pair_match.group(1).strip(" `\"'.,;:-"),
                role_pair_match.group(2).strip(" `\"'.,;:-"),
            ]

    if not labels:
        role_match = re.search(
            r"\b(?:runtime\s+)?(?:image input|input image)s?\s+for\s+(?:the\s+)?(.+?)(?:[.;]|\n|$)",
            text,
            flags=re.IGNORECASE,
        )
        if role_match:
            raw_role = role_match.group(1)
            raw_role = re.sub(r"\b(?:before|then|and then|with fields?|fields?|plus|suggest|ask)\b.*$", "", raw_role, flags=re.IGNORECASE).strip()
            raw_role = re.sub(r"\s+or\s+", " / ", raw_role, flags=re.IGNORECASE)
            label = raw_role.strip(" `\"'.,;:-")
            if label:
                labels = [label]

    if not labels and requested_count > 0:
        labels = [f"Image Input {index + 1}" for index in range(requested_count)]

    normalized: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for index, label in enumerate(labels[:5]):
        cleaned_label = _display_label(label) or f"Image Input {index + 1}"
        cleaned_label = re.sub(r"^(?:and|or)\s+", "", cleaned_label, flags=re.IGNORECASE).strip() or f"Image Input {index + 1}"
        if cleaned_label.lower() == "face":
            cleaned_label = "Face Reference"
        elif cleaned_label.lower() in {"body", "full body", "full-body"}:
            cleaned_label = "Body Reference"
        key = _slug(cleaned_label) or f"image_{index + 1}"
        if key in seen:
            key = f"{key}_{index + 1}"
        seen.add(key)
        normalized.append({"key": key, "label": cleaned_label, "required": True})
    return normalized
