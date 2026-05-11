from __future__ import annotations

from typing import Any, Dict, List, Optional

from .. import kie_adapter, store
from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort


def _title_from_key(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", " ").replace("-", " ").split())


def _field_from_option(key: str, spec: Dict[str, Any]) -> Optional[GraphNodeField]:
    if spec.get("hidden_from_studio"):
        return None
    option_type = str(spec.get("type") or "text")
    field_type = "text"
    if option_type == "enum":
        field_type = "select"
    elif option_type == "bool":
        field_type = "boolean"
    elif option_type == "int_range":
        field_type = "integer"
    elif option_type == "float_range":
        field_type = "float"
    label = spec.get("label") or _title_from_key(key)
    return GraphNodeField(
        id=key,
        label=str(label),
        type=field_type,
        required=bool(spec.get("required")),
        default=spec.get("default"),
        options=list(spec.get("allowed") or []),
        min=spec.get("min"),
        max=spec.get("max"),
        help_text=spec.get("help_text") or spec.get("notes"),
        advanced=bool(spec.get("advanced")),
    )


class GraphNodeRegistry:
    def __init__(self) -> None:
        self._definitions: Optional[List[GraphNodeDefinition]] = None

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
        definitions = [
            GraphNodeDefinition(
                type="prompt.text",
                title="Prompt Text",
                description="Reusable text prompt that can feed one or more model prompt inputs.",
                category="Prompt",
                search_aliases=["prompt", "text", "caption", "description"],
                tags=["prompt", "text", "utility"],
                source={"kind": "system"},
                execution={"executor": "prompt.text", "mode": "sync", "cacheable": True, "output_node": False},
                ui={"default_size": {"width": 340, "height": 260}, "accent": "purple", "icon": "text"},
                ports={
                    "inputs": [],
                    "outputs": [GraphNodePort(id="text", label="Text", type="text")],
                },
                fields=[
                    GraphNodeField(
                        id="text",
                        label="Prompt",
                        type="textarea",
                        required=True,
                        default="",
                        placeholder="Write a reusable prompt...",
                    )
                ],
            ),
            GraphNodeDefinition(
                type="media.load_image",
                title="Load Image",
                description="Load an existing Media Studio asset or reference image.",
                category="Media",
                search_aliases=["asset", "reference", "input", "image"],
                tags=["media", "image", "input"],
                source={"kind": "system"},
                execution={"executor": "media.load_image", "mode": "sync", "cacheable": True, "output_node": False},
                ui={"default_size": {"width": 280, "height": 260}, "accent": "green", "icon": "image"},
                ports={
                    "inputs": [],
                    "outputs": [GraphNodePort(id="image", label="Image", type="image")],
                },
                fields=[
                    GraphNodeField(id="asset_id", label="Asset ID", type="asset_picker", required=False),
                    GraphNodeField(id="reference_id", label="Reference ID", type="reference_media_picker", required=False),
                ],
            ),
            GraphNodeDefinition(
                type="media.save_image",
                title="Save Image",
                description="Expose an image as a normal Media Studio graph output.",
                category="Media",
                search_aliases=["save", "output", "asset"],
                tags=["media", "image", "output"],
                source={"kind": "system"},
                execution={"executor": "media.save_image", "mode": "sync", "cacheable": False, "output_node": True},
                ui={"default_size": {"width": 260, "height": 180}, "accent": "yellow", "icon": "save"},
                ports={
                    "inputs": [GraphNodePort(id="image", label="Image", type="image", required=True, min=1, max=1, accepts=["image"])],
                    "outputs": [GraphNodePort(id="asset", label="Asset", type="asset")],
                },
                fields=[GraphNodeField(id="label", label="Label", type="text", required=False)],
            ),
        ]
        model = self._nano_banana_pro_model()
        if model:
            definitions.append(self._kie_model_definition(model))
        return definitions

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
        image_inputs = (raw.get("inputs") or {}).get("image") or {}
        max_images = int(image_inputs.get("required_max") or 0)
        fields = [
            GraphNodeField(
                id="prompt",
                label="Prompt",
                type="textarea",
                required=False,
                default="",
                placeholder="Describe the image to generate or edit...",
                connectable=True,
                port_type="text",
            )
        ]
        for key, option in (raw.get("options") or {}).items():
            field = _field_from_option(str(key), option if isinstance(option, dict) else {})
            if field:
                fields.append(field)
        return GraphNodeDefinition(
            type="model.kie.nano_banana_pro",
            title=str(model.get("label") or "Nano Banana Pro"),
            description="KIE image model node for prompt-guided image generation and editing.",
            category="Models/Image",
            search_aliases=["nano", "banana", "pro", "image", "edit", "generation"],
            tags=["model", "image", "kie"],
            source={
                "kind": "kie_model",
                "model_key": model.get("key"),
                "kie_spec_version": model.get("kie_spec_version"),
            },
            execution={"executor": "kie.model", "mode": "async", "cacheable": True, "output_node": False, "retryable": True},
            ui={"default_size": {"width": 360, "height": 520}, "accent": "blue", "icon": "sparkles", "show_preview": True},
            ports={
                "inputs": [
                    GraphNodePort(id="prompt", label="Prompt", type="text", required=False, max=1, accepts=["text"]),
                    GraphNodePort(
                        id="image_refs",
                        label="Reference Images",
                        type="image",
                        array=True,
                        min=int(image_inputs.get("required_min") or 0),
                        max=max_images or None,
                        required=bool(image_inputs.get("required_min") or 0),
                        accepts=["image"],
                    )
                ],
                "outputs": [
                    GraphNodePort(id="image", label="Image", type="image"),
                    GraphNodePort(id="job", label="Job", type="job", advanced=True),
                ],
            },
            fields=fields,
        )


registry = GraphNodeRegistry()
