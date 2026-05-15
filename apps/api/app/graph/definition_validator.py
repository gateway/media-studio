from __future__ import annotations

from typing import Iterable, Literal

from .schemas import GraphNodeDefinition


SUPPORTED_GRAPH_PORT_TYPES = {
    "any",
    "asset",
    "audio",
    "image",
    "job",
    "json",
    "reference_media",
    "text",
    "video",
}

SUPPORTED_GRAPH_FIELD_TYPES = {
    "asset_picker",
    "boolean",
    "bool",
    "color",
    "enum",
    "float",
    "float_range",
    "integer",
    "int_range",
    "number",
    "preset_picker",
    "reference_media_picker",
    "select",
    "text",
    "textarea",
    "timecode",
}

KNOWN_GRAPH_UI_TOKENS = {
    "asset",
    "audio",
    "blue",
    "bug",
    "cyan",
    "debug",
    "green",
    "image",
    "info",
    "json",
    "orange",
    "preset",
    "purple",
    "save",
    "sparkles",
    "text",
    "video",
    "yellow",
}


class GraphNodeDefinitionError(ValueError):
    pass


def _size_pair(definition: GraphNodeDefinition, key: str) -> tuple[float, float] | None:
    value = definition.ui.get(key)
    if not isinstance(value, dict):
        return None
    width = value.get("width")
    height = value.get("height")
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
        return None
    if width <= 0 or height <= 0:
        return None
    return float(width), float(height)


def _is_known_token(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    if value in KNOWN_GRAPH_UI_TOKENS:
        return True
    if value.startswith("#") and len(value) in {4, 7}:
        return all(character in "0123456789abcdefABCDEF" for character in value[1:])
    return False


def validate_node_definition(definition: GraphNodeDefinition) -> None:
    errors: list[str] = []
    if not definition.type.strip():
        errors.append("node type is required")
    if not definition.title.strip():
        errors.append(f"{definition.type}: title is required")
    if not definition.category.strip():
        errors.append(f"{definition.type}: category is required")

    for side in ("inputs", "outputs"):
        seen_ports: set[str] = set()
        for port in definition.ports.get(side, []):
            if not port.id.strip():
                errors.append(f"{definition.type}: {side} port id is required")
            if port.id in seen_ports:
                errors.append(f"{definition.type}: duplicate {side} port {port.id}")
            seen_ports.add(port.id)
            if port.type not in SUPPORTED_GRAPH_PORT_TYPES:
                errors.append(f"{definition.type}: unsupported port type {port.type}")
            if port.min < 0:
                errors.append(f"{definition.type}: port {port.id} has negative min")
            if port.max is not None and port.max < port.min:
                errors.append(f"{definition.type}: port {port.id} max is lower than min")
            for accepted_type in port.accepts:
                if accepted_type not in SUPPORTED_GRAPH_PORT_TYPES:
                    errors.append(f"{definition.type}: port {port.id} accepts unsupported type {accepted_type}")

    seen_fields: set[str] = set()
    for field in definition.fields:
        if field.id in seen_fields:
            errors.append(f"{definition.type}: duplicate field {field.id}")
        seen_fields.add(field.id)
        if not field.hidden and field.type not in SUPPORTED_GRAPH_FIELD_TYPES:
            errors.append(f"{definition.type}: unsupported field renderer {field.type}")
        if field.port_type and field.port_type not in SUPPORTED_GRAPH_PORT_TYPES:
            errors.append(f"{definition.type}: field {field.id} uses unsupported port type {field.port_type}")
        if field.visible_if is not None:
            if not isinstance(field.visible_if, dict) or not isinstance(field.visible_if.get("field"), str) or not field.visible_if.get("field"):
                errors.append(f"{definition.type}: field {field.id} visible_if must declare a field")
            elif field.visible_if.get("field") not in {candidate.id for candidate in definition.fields}:
                errors.append(f"{definition.type}: field {field.id} visible_if references unknown field {field.visible_if.get('field')}")

    min_size = _size_pair(definition, "min_size")
    default_size = _size_pair(definition, "default_size")
    max_size = _size_pair(definition, "max_size")
    if min_size is None:
        errors.append(f"{definition.type}: ui.min_size is required")
    if default_size is None:
        errors.append(f"{definition.type}: ui.default_size is required")
    if max_size is None:
        errors.append(f"{definition.type}: ui.max_size is required")
    if min_size and default_size and (default_size[0] < min_size[0] or default_size[1] < min_size[1]):
        errors.append(f"{definition.type}: ui.default_size must be greater than or equal to ui.min_size")
    if default_size and max_size and (max_size[0] < default_size[0] or max_size[1] < default_size[1]):
        errors.append(f"{definition.type}: ui.max_size must be greater than or equal to ui.default_size")

    for token_key in ("color", "accent", "icon"):
        if not _is_known_token(definition.ui.get(token_key)):
            errors.append(f"{definition.type}: ui.{token_key} must use a known token")

    if errors:
        raise GraphNodeDefinitionError("; ".join(errors))


def validate_node_definitions(definitions: Iterable[GraphNodeDefinition]) -> None:
    for definition in definitions:
        validate_node_definition(definition)


def compatible_node_definitions(
    definitions: Iterable[GraphNodeDefinition],
    *,
    port_type: str,
    direction: Literal["from_output", "from_input"],
) -> list[GraphNodeDefinition]:
    if port_type not in SUPPORTED_GRAPH_PORT_TYPES:
        raise GraphNodeDefinitionError(f"unsupported compatibility port type {port_type}")
    matches: list[GraphNodeDefinition] = []
    for definition in definitions:
        ports = definition.ports.get("inputs" if direction == "from_output" else "outputs", [])
        for port in ports:
            accepts = port.accepts or [port.type]
            if direction == "from_output" and (port_type in accepts or "any" in accepts):
                matches.append(definition)
                break
            if direction == "from_input" and (port.type == port_type or port.type == "any"):
                matches.append(definition)
                break
    return matches
