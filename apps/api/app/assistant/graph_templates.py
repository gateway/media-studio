from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List

from ..graph.registry import registry
from .schemas import AssistantGraphOperation, AssistantGraphPlan


TEMPLATE_SOURCE = "assistant_template_registry"
T2I_SANDBOX_TEMPLATE_ID = "preset_style_t2i_sandbox_v1"
I2I_SANDBOX_TEMPLATE_ID = "preset_style_i2i_sandbox_v1"
SAVED_PRESET_TEST_TEMPLATE_ID = "saved_media_preset_test_v1"
RECIPE_SANDBOX_TEMPLATE_ID = "prompt_recipe_style_sandbox_v1"
TEMPLATE_VERSION = "2026-06-01"


@dataclass(frozen=True)
class AssistantGraphTemplate:
    template_id: str
    mode: str
    purpose: str
    node_types: List[str]
    connections: List[tuple[str, str, str, str]]
    repeatable_blocks: List[str] = field(default_factory=list)


TEMPLATES: Dict[str, AssistantGraphTemplate] = {
    T2I_SANDBOX_TEMPLATE_ID: AssistantGraphTemplate(
        template_id=T2I_SANDBOX_TEMPLATE_ID,
        mode="text_to_image",
        purpose="Reference-style text-to-image test workflow",
        node_types=["utility.note", "prompt.text", "model.kie.gpt_image_2_text_to_image", "preview.image", "media.save_image"],
        connections=[("prompt", "text", "model", "prompt"), ("model", "image", "preview", "image"), ("model", "image", "save", "image")],
    ),
    I2I_SANDBOX_TEMPLATE_ID: AssistantGraphTemplate(
        template_id=I2I_SANDBOX_TEMPLATE_ID,
        mode="image_to_image",
        purpose="Reference-style image-to-image test workflow",
        node_types=["utility.note", "media.load_image", "prompt.text", "model.kie.gpt_image_2_image_to_image", "preview.image", "media.save_image"],
        connections=[("prompt", "text", "model", "prompt"), ("model", "image", "preview", "image"), ("model", "image", "save", "image")],
        repeatable_blocks=["runtime_image_input"],
    ),
    SAVED_PRESET_TEST_TEMPLATE_ID: AssistantGraphTemplate(
        template_id=SAVED_PRESET_TEST_TEMPLATE_ID,
        mode="saved_preset_test",
        purpose="Saved Media Preset verification workflow",
        node_types=["utility.note", "preset.render", "preview.image", "media.save_image"],
        connections=[("preset", "image", "preview", "image"), ("preset", "image", "save", "image")],
        repeatable_blocks=["runtime_image_input"],
    ),
    RECIPE_SANDBOX_TEMPLATE_ID: AssistantGraphTemplate(
        template_id=RECIPE_SANDBOX_TEMPLATE_ID,
        mode="prompt_recipe",
        purpose="Prompt Recipe image test workflow",
        node_types=["utility.note", "prompt.recipe", "model.kie.gpt_image_2_text_to_image", "preview.image", "media.save_image"],
        connections=[("recipe", "text", "model", "prompt"), ("model", "image", "preview", "image"), ("model", "image", "save", "image")],
    ),
}


def _hash_payload(value: Any) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()[:12]


def _template_metadata(template_id: str, *, slot_count: int, contract: Dict[str, Any], prompt: str = "") -> Dict[str, Any]:
    template = TEMPLATES[template_id]
    return {
        "source": TEMPLATE_SOURCE,
        "template_id": template.template_id,
        "template_version": TEMPLATE_VERSION,
        "template_mode": template.mode,
        "template_slot_count": slot_count,
        "contract_hash": _hash_payload(contract),
        "prompt_hash": _hash_payload(prompt),
    }


def validate_assistant_graph_templates(template_ids: Iterable[str] | None = None) -> List[str]:
    definitions = registry.definitions_by_type()
    errors: List[str] = []
    ids = list(template_ids or TEMPLATES.keys())
    for template_id in ids:
        template = TEMPLATES.get(template_id)
        if not template:
            errors.append(f"Unknown assistant graph template: {template_id}")
            continue
        for node_type in template.node_types:
            if node_type not in definitions:
                errors.append(f"{template_id} references missing node type {node_type}")
        for source_ref, source_port, target_ref, target_port in template.connections:
            source_type = _node_type_for_ref(template, source_ref)
            target_type = _node_type_for_ref(template, target_ref)
            if source_type in definitions:
                output_ports = {port.id for port in definitions[source_type].ports.get("outputs", [])}
                if source_port not in output_ports:
                    errors.append(f"{template_id} references missing output port {source_type}.{source_port}")
            if target_type in definitions:
                input_ports = {port.id for port in definitions[target_type].ports.get("inputs", [])}
                if target_port not in input_ports:
                    errors.append(f"{template_id} references missing input port {target_type}.{target_port}")
    return errors


def _node_type_for_ref(template: AssistantGraphTemplate, ref: str) -> str:
    if ref == "note":
        return "utility.note"
    if ref == "image":
        return "media.load_image"
    if ref == "prompt":
        return "prompt.text"
    if ref == "model":
        return "model.kie.gpt_image_2_text_to_image" if template.mode in {"text_to_image", "prompt_recipe"} else "model.kie.gpt_image_2_image_to_image"
    if ref == "preset":
        return "preset.render"
    if ref == "recipe":
        return "prompt.recipe"
    if ref == "preview":
        return "preview.image"
    if ref == "save":
        return "media.save_image"
    return ""


def _note_body(title: str, lines: List[str], *, template_id: str) -> str:
    template = TEMPLATES.get(template_id)
    workflow_type = template.purpose if template else "Assistant test workflow"
    return "\n\n".join([f"### {title}", f"- Workflow type: {workflow_type}.", *lines])


def instantiate_preset_sandbox_template(
    *,
    template_id: str,
    base_x: float,
    title: str,
    prompt: str,
    model_type: str,
    model_label: str,
    image_slots: List[Dict[str, Any]],
    text_fields: List[Dict[str, Any]],
    warnings: List[str],
    style_reference_text_only: bool,
) -> AssistantGraphPlan:
    if template_id not in {T2I_SANDBOX_TEMPLATE_ID, I2I_SANDBOX_TEMPLATE_ID}:
        raise ValueError(f"Unsupported preset sandbox template: {template_id}")
    slot_count = len(image_slots)
    template = TEMPLATES[template_id]
    contract = {"title": title, "fields": text_fields, "image_slots": image_slots, "model_type": model_type}
    note_lines = [
        "- This is a template-created test workflow, not a saved Media Preset.",
        (
            "- The attached style reference has been converted into a text prompt; it is not wired as an image input."
            if style_reference_text_only
            else "- Attached style references stay in assistant context; pick separate subject images in the loaders."
        ),
        f"- Image inputs: {slot_count}. Fields: {len(text_fields)}.",
        "- Run only when the prompt and runtime inputs look right, then save the preset after approval.",
    ]
    operations: List[AssistantGraphOperation] = [
        AssistantGraphOperation(
            op="add_node",
            node_ref="note",
            node_type="utility.note",
            title="Test Workflow Guide",
            position={"x": base_x, "y": 0},
            fields={"body": _note_body(f"{title} test workflow", note_lines, template_id=template_id)},
        )
    ]
    group_refs = ["note"]
    if template_id == I2I_SANDBOX_TEMPLATE_ID:
        for index, slot in enumerate(image_slots):
            node_ref = str(slot.get("node_ref") or slot.get("key") or f"image_{index + 1}")
            label = str(slot.get("label") or slot.get("key") or f"Image Input {index + 1}")
            fields_payload: Dict[str, str] = {}
            reference_id = str(slot.get("reference_id") or "")
            if reference_id:
                fields_payload["reference_id"] = reference_id
            operations.append(
                AssistantGraphOperation(
                    op="add_node",
                    node_ref=node_ref,
                    node_type="media.load_image",
                    title=label,
                    position={"x": base_x, "y": 180 + (index * 360)},
                    fields=fields_payload,
                )
            )
            group_refs.append(node_ref)
    image_prompt_y = 640 + max(0, slot_count - 1) * 260
    operations.extend(
        [
            AssistantGraphOperation(
                op="add_node",
                node_ref="prompt",
                node_type="prompt.text",
                title="Draft preset prompt",
                position={"x": base_x, "y": 360} if template_id == T2I_SANDBOX_TEMPLATE_ID else {"x": base_x + 520, "y": image_prompt_y},
                fields={"text": prompt},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref="model",
                node_type=model_type,
                title=model_label,
                position={"x": base_x + 520, "y": 360} if template_id == T2I_SANDBOX_TEMPLATE_ID else {"x": base_x + 520, "y": 300},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref="preview",
                node_type="preview.image",
                title="Preview",
                position={"x": base_x + 1040, "y": 220} if template_id == T2I_SANDBOX_TEMPLATE_ID else {"x": base_x + 1040, "y": 180},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref="save",
                node_type="media.save_image",
                title="Save image",
                position={"x": base_x + 1040, "y": 740} if template_id == T2I_SANDBOX_TEMPLATE_ID else {"x": base_x + 1040, "y": 700},
            ),
            AssistantGraphOperation(op="connect_nodes", source_ref="prompt", source_port="text", target_ref="model", target_port="prompt"),
            AssistantGraphOperation(op="connect_nodes", source_ref="model", source_port="image", target_ref="preview", target_port="image"),
            AssistantGraphOperation(op="connect_nodes", source_ref="model", source_port="image", target_ref="save", target_port="image"),
        ]
    )
    group_refs.extend(["prompt", "model", "preview", "save"])
    if template_id == I2I_SANDBOX_TEMPLATE_ID:
        for slot in image_slots:
            node_ref = str(slot.get("node_ref") or slot.get("key") or "")
            if node_ref:
                operations.append(AssistantGraphOperation(op="connect_nodes", source_ref=node_ref, source_port="image", target_ref="model", target_port="image_refs"))
    operations.append(AssistantGraphOperation(op="group_nodes", group_ref="preset-sandbox", title="Preset test workflow", color="blue", node_refs=group_refs))
    metadata = _template_metadata(template_id, slot_count=slot_count, contract=contract, prompt=prompt)
    return AssistantGraphPlan(
        summary=f"Load {template.purpose} for {title} with {slot_count} image input{'s' if slot_count != 1 else ''} and {len(text_fields)} field{'s' if len(text_fields) != 1 else ''}.",
        operations=operations,
        warnings=warnings,
        metadata=metadata,
    )


def instantiate_saved_preset_template(
    *,
    base_x: float,
    preset: Dict[str, Any],
    image_slots: List[Dict[str, Any]],
    text_fields: List[Dict[str, Any]],
    field_values: Dict[str, str],
    image_loader_fields: List[Dict[str, str]],
    warnings: List[str],
) -> AssistantGraphPlan:
    label = str(preset.get("label") or "Media Preset")
    preset_id = str(preset.get("preset_id") or "")
    model_key = str(preset.get("default_model_key") or "")
    slot_count = len(image_slots)
    note_lines = [
        "- Review the preset text fields before running.",
        (
            f"- Attach the actual image for {', '.join(str(slot.get('label') or slot.get('key') or 'Reference') for slot in image_slots)} before running."
            if image_slots
            else "- Required text fields are prefilled with example values for a smoke run."
        ),
        "- Assistant reference/style images are not auto-used as subject images.",
        "- Use Preview to verify the output, then Save image when it looks right.",
    ]
    fields = {"preset_id": preset_id, "preset_model_key": model_key}
    for field in text_fields:
        key = str(field.get("key") or "").strip()
        if key:
            fields[f"text__{_slug_for_field(key)}"] = field_values.get(key, "")
    operations: List[AssistantGraphOperation] = [
        AssistantGraphOperation(
            op="add_node",
            node_ref="note",
            node_type="utility.note",
            title="Guide",
            position={"x": base_x, "y": 0},
            fields={"body": _note_body(label, note_lines, template_id=SAVED_PRESET_TEST_TEMPLATE_ID)},
        )
    ]
    group_refs = ["note"]
    for index, slot in enumerate(image_slots):
        key = str(slot.get("key") or "").strip()
        label_text = str(slot.get("label") or key or f"Reference {index + 1}")
        node_ref = f"image_{index + 1}"
        operations.append(
            AssistantGraphOperation(
                op="add_node",
                node_ref=node_ref,
                node_type="media.load_image",
                title=label_text,
                position={"x": base_x, "y": 300 + (index * 520)},
                fields=image_loader_fields[index] if index < len(image_loader_fields) else {},
            )
        )
        group_refs.append(node_ref)
    operations.extend(
        [
            AssistantGraphOperation(
                op="add_node",
                node_ref="preset",
                node_type="preset.render",
                title=label,
                position={"x": base_x + 520, "y": 420},
                fields=fields,
            ),
            AssistantGraphOperation(op="add_node", node_ref="preview", node_type="preview.image", title="Preview", position={"x": base_x + 1040, "y": 300}),
            AssistantGraphOperation(op="add_node", node_ref="save", node_type="media.save_image", title="Save image", position={"x": base_x + 1040, "y": 820}),
            AssistantGraphOperation(op="connect_nodes", source_ref="preset", source_port="image", target_ref="preview", target_port="image"),
            AssistantGraphOperation(op="connect_nodes", source_ref="preset", source_port="image", target_ref="save", target_port="image"),
        ]
    )
    group_refs.extend(["preset", "preview", "save"])
    for index, slot in enumerate(image_slots):
        key = str(slot.get("key") or "").strip()
        if key:
            operations.append(
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=f"image_{index + 1}",
                    source_port="image",
                    target_ref="preset",
                    target_port=f"slot__{_slug_for_field(key)}",
                )
            )
    operations.append(AssistantGraphOperation(op="group_nodes", group_ref="preset-workflow", title=label, color="blue", node_refs=group_refs))
    contract = {"preset_id": preset_id, "key": preset.get("key"), "fields": text_fields, "image_slots": image_slots}
    input_summary = (
        f"{slot_count} image input{'s' if slot_count != 1 else ''}, preview, and save output"
        if image_slots
        else "preset fields, preview, and save output"
    )
    return AssistantGraphPlan(
        summary=f"Load saved Media Preset test template for {label} with {input_summary}.",
        operations=operations,
        warnings=warnings,
        metadata=_template_metadata(SAVED_PRESET_TEST_TEMPLATE_ID, slot_count=slot_count, contract=contract),
    )


def _slug_for_field(value: str) -> str:
    import re

    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")
