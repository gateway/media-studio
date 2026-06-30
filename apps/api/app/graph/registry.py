from __future__ import annotations

from typing import Any, Dict, List, Optional

from .. import kie_adapter, store
from .definition_validator import validate_node_definitions
from .model_option_fields import (
    graph_field_from_model_option,
    is_seedance_model as _is_seedance_model,
    is_suno_model as _is_suno_model,
    is_supported_graph_model_option,
    normalized_model_key as _normalized_model_key,
    suno_graph_fields,
)
from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort
from .system_nodes import system_node_definitions


SUPPORTED_GRAPH_MODEL_INPUTS = {"image", "video", "audio"}
IMAGE_TASK_MODE_HINTS = {"text_to_image", "image_edit", "image_generation", "text_to_picture"}
VIDEO_TASK_MODE_HINTS = {
    "image_to_video",
    "text_to_video",
    "video_to_video",
    "motion_control",
    "i2v",
    "t2v",
    "v2v",
}
AUDIO_TASK_MODE_HINTS = {"text_to_audio", "video_to_audio", "audio_generation", "text_to_music", "music_generation"}
def _title_from_key(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", " ").replace("-", " ").split())


def _slug(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value.lower()).strip("_")


def _model_task_modes(model: Dict[str, Any]) -> List[str]:
    raw = model.get("raw") or {}
    task_modes = model.get("task_modes") or raw.get("task_modes") or []
    return [str(item).lower() for item in task_modes if item is not None]


def _graph_model_output_media_type(model: Dict[str, Any]) -> str:
    task_modes = set(_model_task_modes(model))
    model_key = str(model.get("key") or "").lower()
    raw = model.get("raw") or {}
    provider_model = str(raw.get("provider_model") or "").lower()
    hint_text = " ".join([model_key, provider_model])
    if task_modes.intersection(VIDEO_TASK_MODE_HINTS) or any(
        hint in hint_text for hint in ("image-to-video", "text-to-video", "video-to-video", "i2v", "t2v", "v2v")
    ):
        return "video"
    if task_modes.intersection(AUDIO_TASK_MODE_HINTS) or any(hint in hint_text for hint in ("audio", "music", "suno")):
        return "audio"
    media_types = set(str(item).lower() for item in (model.get("media_types") or []))
    if "video" in media_types:
        return "video"
    if "audio" in media_types:
        return "audio"
    return "image"


def _layout_ui(definition: GraphNodeDefinition) -> GraphNodeDefinition:
    ui = dict(definition.ui or {})
    default_size = ui.get("default_size") if isinstance(ui.get("default_size"), dict) else {}
    default_width = int(default_size.get("width") or 320)
    default_height = int(default_size.get("height") or 260)
    visible_fields = [field for field in definition.fields if not field.hidden and field.visible_if is None]
    visible_ports = [
        port
        for port in [*definition.ports.get("inputs", []), *definition.ports.get("outputs", [])]
        if not port.advanced and port.visible_if is None
    ]
    textarea_count = sum(1 for field in visible_fields if field.type == "textarea")
    preview = bool(ui.get("preview")) or definition.type.startswith("media.load_") or definition.type.startswith("media.save_")
    computed_min_height = 132 + len(visible_fields) * 52 + len(visible_ports) * 28 + textarea_count * 70 + (140 if preview else 0)
    computed_min_width = 260 if preview else 240
    if definition.category.startswith("Models/"):
        computed_min_width = max(computed_min_width, 340)
        computed_min_height = max(computed_min_height, 440)
    if definition.type == "preset.render":
        computed_min_width = max(computed_min_width, 340)
        computed_min_height = max(computed_min_height, 380)
    if definition.type == "prompt.recipe":
        computed_min_width = max(computed_min_width, 360)
        computed_min_height = max(computed_min_height, 420)

    min_width = max(computed_min_width, int(ui.get("min_width") or 0))
    min_height = max(computed_min_height, int(ui.get("min_height") or 0))
    default_width = max(default_width, min_width)
    default_height = max(default_height, min_height)
    accent = str(ui.get("accent") or "blue")
    ui["default_size"] = {"width": default_width, "height": default_height}
    ui.setdefault("min_size", {"width": min_width, "height": min_height})
    ui.setdefault("max_size", {"width": max(default_width, 860), "height": max(default_height, 1200)})
    ui.setdefault("color", accent)
    ui.setdefault("accent", accent)
    ui.setdefault("icon", "info")
    ui.setdefault("preview", preview)
    ui.setdefault("field_layout", "stack")
    definition.ui = ui
    return definition


def _model_image_ports(model_key: str, raw_inputs: Dict[str, Any], output_media_type: str) -> List[GraphNodePort]:
    image_input = raw_inputs.get("image") or {}
    required_min = int(image_input.get("required_min") or 0)
    raw_max = image_input.get("required_max")
    required_max = int((raw_max if raw_max not in (None, "") else image_input.get("required_min")) or 0)
    if required_min <= 0 and required_max <= 0:
        return []
    normalized_key = model_key.lower()
    if _is_seedance_model(model_key):
        image_limit = required_max or None
        return [
            GraphNodePort(
                id="start_frame",
                label="Start Frame",
                type="image",
                min=0,
                max=1,
                required=False,
                accepts=["image"],
                description="Optional opening frame. Do not mix Start/End Frames with reference images, videos, or audio.",
            ),
            GraphNodePort(
                id="end_frame",
                label="End Frame",
                type="image",
                min=0,
                max=1,
                required=False,
                accepts=["image"],
                description="Optional closing frame. Requires a Start Frame and cannot be mixed with multimodal references.",
            ),
            GraphNodePort(
                id="reference_images",
                label="Reference Images",
                type="image",
                array=True,
                min=0,
                max=image_limit,
                required=False,
                accepts=["image"],
                description="Reference images for multimodal reference-to-video. Do not mix with Start or End Frame inputs.",
            ),
        ]
    if output_media_type == "video" and required_max == 2 and "i2v" in normalized_key:
        return [
            GraphNodePort(
                id="start_frame",
                label="Start Frame",
                type="image",
                min=1,
                max=1,
                required=True,
                accepts=["image"],
                description="First image frame sent to the image-to-video model.",
            ),
            GraphNodePort(
                id="end_frame",
                label="End Frame",
                type="image",
                min=1 if required_min >= 2 else 0,
                max=1,
                required=required_min >= 2,
                accepts=["image"],
                description="Optional final image frame sent after the start frame.",
            ),
        ]
    label = "Reference Images"
    if output_media_type == "video" and required_max == 1:
        label = "Reference Image"
    return [
        GraphNodePort(
            id="image_refs",
            label=label,
            type="image",
            array=True,
            min=required_min,
            max=required_max or None,
            required=bool(required_min),
            accepts=["image"],
            description=f"Accepts {required_max or 'multiple'} image reference{'s' if (required_max or 0) != 1 else ''}.",
        )
    ]


class GraphNodeRegistry:
    def __init__(self) -> None:
        self._definitions: Optional[List[GraphNodeDefinition]] = None

    def invalidate(self) -> None:
        self._definitions = None

    def list_definitions(self, *, refresh: bool = False) -> List[GraphNodeDefinition]:
        if self._definitions is None or refresh:
            self._definitions = self._build_definitions()
            try:
                fingerprint = kie_adapter.model_diagnostics().get("kie_spec_version") or "unknown"
                store.cache_graph_node_definitions(
                    str(fingerprint),
                    [item.model_dump(mode="json") for item in self._definitions],
                )
            except Exception:
                pass
        return list(self._definitions)

    def get_definition(self, node_type: str) -> GraphNodeDefinition:
        for definition in self.list_definitions():
            if definition.type == node_type:
                return definition
        raise KeyError(node_type)

    def definitions_by_type(self) -> Dict[str, GraphNodeDefinition]:
        return {definition.type: definition for definition in self.list_definitions()}

    def _build_definitions(self) -> List[GraphNodeDefinition]:
        definitions = system_node_definitions()
        seen_model_nodes = {definition.type for definition in definitions}
        for model in self._graph_supported_models():
            definition = self._kie_model_definition(model)
            if definition.type in seen_model_nodes:
                continue
            definitions.append(definition)
            seen_model_nodes.add(definition.type)
        definitions = [_layout_ui(definition) for definition in definitions]
        validate_node_definitions(definitions)
        return definitions

    def _graph_supported_models(self) -> List[Dict[str, Any]]:
        models = kie_adapter.list_models()
        supported: List[Dict[str, Any]] = []
        for model in models:
            output_media_type = _graph_model_output_media_type(model)
            media_types = set(str(item).lower() for item in (model.get("media_types") or []))
            task_modes = set(_model_task_modes(model))
            raw = model.get("raw") or {}
            hint_text = f"{str(model.get('key') or '').lower()} {str(raw.get('provider_model') or '').lower()}"
            has_media_hint = (
                bool(media_types.intersection({"image", "video", "audio"}))
                or bool(task_modes.intersection(IMAGE_TASK_MODE_HINTS))
                or bool(task_modes.intersection(VIDEO_TASK_MODE_HINTS | AUDIO_TASK_MODE_HINTS))
                or any(hint in hint_text for hint in ("text-to-image", "image-edit", "image-to-video", "text-to-video", "video-to-video", "i2v", "t2v", "v2v", "music", "suno"))
            )
            if output_media_type not in {"image", "video", "audio"} or not has_media_hint:
                continue
            if model.get("studio_exposed") is False and output_media_type != "audio":
                continue
            raw_inputs = (model.get("raw") or {}).get("inputs") or {}
            unknown_input_types = set(raw_inputs.keys()).difference(SUPPORTED_GRAPH_MODEL_INPUTS)
            if unknown_input_types:
                continue
            supported.append(model)
        nano = self._nano_banana_pro_model()
        if nano and not any(item.get("key") == nano.get("key") for item in supported):
            supported.insert(0, nano)
        return supported

    def _nano_banana_pro_model(self) -> Optional[Dict[str, Any]]:
        models = kie_adapter.list_models()
        for key in ("nano-banana-pro", "nanobanana-pro", "nano_banana_pro"):
            match = next((item for item in models if item.get("key") == key), None)
            if match:
                return match
        return next(
            (
                item
                for item in models
                if "nano" in str(item.get("key") or "").lower()
                and "pro" in str(item.get("key") or "").lower()
                and "image" in (item.get("media_types") or ["image"])
            ),
            None,
        )

    def _kie_model_definition(self, model: Dict[str, Any]) -> GraphNodeDefinition:
        raw = model.get("raw") or {}
        raw_inputs = raw.get("inputs") or {}
        model_key = str(model.get("key") or "unknown-model")
        output_media_type = _graph_model_output_media_type(model)
        node_type = "model.kie.nano_banana_pro" if model_key in {"nano-banana-pro", "nanobanana-pro", "nano_banana_pro"} else f"model.kie.{_slug(model_key)}"
        is_suno_model = _is_suno_model(model_key)
        allowed_input_media_types = {"image"} if output_media_type == "image" else {"image", "video", "audio"} if output_media_type == "video" else {"audio", "video"}
        prompt_label = "Music Prompt" if output_media_type == "audio" else "Prompt"
        prompt_placeholder = (
            "Describe the song, paste lyrics, or connect prompt text..."
            if output_media_type == "audio"
            else "Describe the image to generate or edit..."
        )
        raw_options = raw.get("options") or {}
        if is_suno_model:
            fields = suno_graph_fields(raw_options)
        else:
            fields = [
                GraphNodeField(
                    id="prompt",
                    label=prompt_label,
                    type="textarea",
                    required=False,
                    default="",
                    placeholder=prompt_placeholder,
                    connectable=True,
                    port_type="text",
                )
            ]
            for key, option in raw_options.items():
                if not is_supported_graph_model_option(model_key, str(key)):
                    continue
                field = graph_field_from_model_option(str(key), option if isinstance(option, dict) else {})
                if field:
                    fields.append(field)
        input_ports = (
            [
                GraphNodePort(
                    id="song_description",
                    label="Song Description",
                    type="text",
                    required=False,
                    max=1,
                    accepts=["text"],
                    visible_if={"field": "custom_mode", "not_equals": True},
                ),
                GraphNodePort(
                    id="lyrics",
                    label="Lyrics",
                    type="text",
                    required=False,
                    max=1,
                    accepts=["text"],
                    visible_if={"field": "custom_mode", "equals": True},
                ),
            ]
            if is_suno_model
            else [GraphNodePort(id="prompt", label="Prompt", type="text", required=False, max=1, accepts=["text"])]
        )
        input_ports.extend(_model_image_ports(model_key, raw_inputs, output_media_type))
        for media_type in ("image", "video", "audio"):
            if media_type == "image":
                continue
            if media_type not in allowed_input_media_types:
                continue
            media_input = raw_inputs.get(media_type) or {}
            required_min = int(media_input.get("required_min") or 0)
            required_max = int(media_input.get("required_max") or 0)
            if required_min <= 0 and required_max <= 0:
                continue
            port_id = f"{media_type}_refs"
            port_label = f"{_title_from_key(media_type)} Refs" if media_type != "image" else "Reference Images"
            description = None
            if _is_seedance_model(model_key):
                port_id = f"reference_{media_type}s"
                port_label = "Reference Videos" if media_type == "video" else "Reference Audio"
                description = f"Optional Seedance reference {_title_from_key(media_type).lower()} inputs. Do not mix with Start or End Frame inputs."
            input_ports.append(
                GraphNodePort(
                    id=port_id,
                    label=port_label,
                    type=media_type,
                    array=True,
                    min=required_min,
                    max=required_max or None,
                    required=bool(required_min),
                    accepts=[media_type],
                    description=description,
                )
            )
        max_images = sum((port.max or 0) for port in input_ports if port.type == "image") or int((raw_inputs.get("image") or {}).get("required_max") or 0)
        output_ports = (
            [
                GraphNodePort(id="track_1", label="Music Track 1", type="music_track"),
                GraphNodePort(id="track_2", label="Music Track 2", type="music_track"),
                GraphNodePort(id="job", label="Job", type="job", advanced=True),
            ]
            if is_suno_model
            else [
                GraphNodePort(id=output_media_type, label=_title_from_key(output_media_type), type=output_media_type),
                *(
                    [
                        GraphNodePort(
                            id="image",
                            label="Last Frame",
                            type="image",
                            description="Still image returned when Output Last Frame is enabled.",
                            visible_if={"field": "return_last_frame", "equals": True},
                        )
                    ]
                    if _is_seedance_model(model_key) and output_media_type == "video"
                    else []
                ),
                GraphNodePort(id="job", label="Job", type="job", advanced=True),
            ]
        )
        return GraphNodeDefinition(
            type=node_type,
            title=str(model.get("label") or _title_from_key(model_key)),
            description=f"KIE {output_media_type} model node using Media Studio validation, pricing, submit, and polling.",
            help_text=(
                "Runs Suno music generation. Each output track includes audio, cover artwork, and provider metadata. Connect each track to Save Music Track."
                if is_suno_model
                else "Runs a KIE model. Credits are estimated from current fields and connected media before Run."
                if not _is_seedance_model(model_key)
                else "Runs Seedance 2.0. Use either Start/End Frames or multimodal references, not both in one run."
            ),
            category=f"Models/{_title_from_key(output_media_type)}",
            search_aliases=[part for part in [*_slug(model_key).split("_"), output_media_type, "kie", "model"] if part],
            tags=["model", output_media_type, "kie"],
            source={
                "kind": "kie_model",
                "model_key": model_key,
                "kie_spec_version": model.get("kie_spec_version"),
                "output_media_type": output_media_type,
                "task_modes": model.get("task_modes") or [],
            },
            execution={"executor": "kie.model", "mode": "async", "cacheable": True, "output_node": False, "retryable": True},
            limits={
                "max_input_images": max_images or None,
                "input_contract": {
                    "images": [
                        {
                            "id": port.id,
                            "label": port.label,
                            "required": port.required,
                            "min": port.min,
                            "max": port.max,
                            "description": port.description,
                        }
                        for port in input_ports
                        if port.type == "image"
                    ],
                    "videos": [
                        {
                            "id": port.id,
                            "label": port.label,
                            "required": port.required,
                            "min": port.min,
                            "max": port.max,
                            "description": port.description,
                        }
                        for port in input_ports
                        if port.type == "video"
                    ],
                    "audios": [
                        {
                            "id": port.id,
                            "label": port.label,
                            "required": port.required,
                            "min": port.min,
                            "max": port.max,
                            "description": port.description,
                        }
                        for port in input_ports
                        if port.type == "audio"
                    ],
                },
                "output_count": {"default": 1, "max": 1},
                "expected_outputs": {"music_tracks": 2} if is_suno_model else None,
            },
            ui={
                "default_size": {"width": 380, "height": 560},
                "accent": "cyan" if output_media_type == "video" else "audio" if output_media_type == "audio" else "blue",
                "icon": "video" if output_media_type == "video" else "audio" if output_media_type == "audio" else "sparkles",
            },
            ports={
                "inputs": input_ports,
                "outputs": output_ports,
            },
            fields=fields,
        )

registry = GraphNodeRegistry()
