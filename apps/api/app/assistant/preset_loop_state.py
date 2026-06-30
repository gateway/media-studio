from __future__ import annotations

from typing import Any, Literal

PresetLoopLane = Literal["text_to_image", "image_to_image", "both"]


def preset_loop_start_lane(text: str) -> PresetLoopLane | None:
    normalized = " ".join(str(text or "").lower().strip().split())
    if "start preset loop" not in normalized and not normalized.startswith("switch to "):
        return None
    if "both" in normalized:
        return "both"
    if "image-to-image" in normalized or "image to image" in normalized:
        return "image_to_image"
    if "text-to-image" in normalized or "text to image" in normalized:
        return "text_to_image"
    return None


def preset_loop_start_lane_from_metadata(metadata: dict[str, Any] | None) -> PresetLoopLane | None:
    if not isinstance(metadata, dict):
        return None
    lane = str(metadata.get("preset_loop_lane") or metadata.get("lane") or "").strip()
    if lane in {"text_to_image", "image_to_image", "both"}:
        return lane  # type: ignore[return-value]
    return None


def preset_loop_lane_from_summary(summary_json: dict[str, Any] | None) -> PresetLoopLane | None:
    preset_loop = summary_json.get("preset_loop") if isinstance(summary_json, dict) else None
    if not isinstance(preset_loop, dict) or not preset_loop.get("locked"):
        return None
    lane = str(preset_loop.get("lane") or "")
    if lane in {"text_to_image", "image_to_image", "both"}:
        return lane  # type: ignore[return-value]
    return None


def intent_like_preset_loop_lane(text: str) -> PresetLoopLane | None:
    normalized = " ".join(str(text or "").lower().strip().split())
    text_only_markers = (
        "text-to-image",
        "text to image",
        "text-only",
        "text only",
        "no runtime image input",
        "no runtime image inputs",
        "no image input",
        "no image inputs",
        "without runtime image input",
        "without runtime image inputs",
        "without image input",
        "without image inputs",
        "do not use any runtime image input",
        "do not use any runtime image inputs",
        "do not add media.load_image",
        "do not add runtime image input",
        "do not add runtime image inputs",
    )
    if any(marker in normalized for marker in text_only_markers):
        return "text_to_image"
    if "image-to-image" in normalized or "image to image" in normalized or "source image" in normalized or "image input" in normalized:
        return "image_to_image"
    return None


def preset_loop_drift_reply(text: str, locked_lane: PresetLoopLane | None) -> tuple[str, dict[str, Any]] | None:
    if locked_lane not in {"text_to_image", "image_to_image"}:
        return None
    explicit_lane = intent_like_preset_loop_lane(text)
    if not explicit_lane or explicit_lane == locked_lane:
        return None
    expected = "Text-to-Image" if locked_lane == "text_to_image" else "Image-to-Image"
    requested = "Text-to-Image" if explicit_lane == "text_to_image" else "Image-to-Image"
    return (
        f"This loop is currently locked to {expected}, but that sounds like {requested}. "
        f"Reply `switch to {requested}` if you want to change lanes; otherwise I will keep the current lane.",
        {
            "mode": "deterministic_preset_loop_lane_guard",
            "suggested_action": "clarify",
            "preset_loop_lane": locked_lane,
            "requested_lane": explicit_lane,
        },
    )


def preset_loop_planning_instruction(lane: PresetLoopLane | None) -> str:
    if lane == "text_to_image":
        return (
            "Locked preset-loop lane: text-to-image. Create a text-to-image test workflow. "
            "Do not add media.load_image nodes or image inputs. Treat attached reference images as style sources only."
        )
    if lane == "image_to_image":
        return (
            "Locked preset-loop lane: image-to-image. Create an image-to-image test workflow. "
            "Use a separate image input; if no count/name is specified, use exactly one input named Subject Image. "
            "Do not wire attached style references as subject images."
        )
    if lane == "both":
        return (
            "Locked preset-loop lane: both variants. Start with the image-to-image test workflow unless the user explicitly asks for text-to-image. "
            "Keep saved variant titles distinct."
        )
    return ""
