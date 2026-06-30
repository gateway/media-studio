from __future__ import annotations

import pytest

from app import store
from app.assistant.character_sheet_recipe import (
    CharacterSheetPromptError,
    ROLE_BODY_SHAPE,
    ROLE_CLOTHING_STYLE_WORLD,
    ROLE_FACE_IDENTITY,
    ROLE_TEMPLATE_LAYOUT,
    ROLE_WEAPON_PROP,
    character_sheet_graph_plan_from_roles,
    character_sheet_graph_plan_from_workflow_request,
    character_sheet_prompt_recipe_draft,
    character_sheet_prompt_recipe_external_variables,
    character_sheet_v3_prompt_recipe_draft,
    character_sheet_reference_roles_from_workflow,
    character_sheet_role_clarification_question,
    compile_character_sheet_prompt,
    normalize_character_sheet_creative_brief,
)
from app.assistant.graph_plan import apply_graph_plan
from app.assistant.selected_node_edit import selected_node_field_edit_plan_from_context
from app.graph.prompt_recipe_catalog import prompt_recipe_dynamic_fields
from app.graph.schemas import GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode
from app.service_prompt_recipe_validation import validate_prompt_recipe_payload


@pytest.fixture(autouse=True)
def _bootstrap_character_sheet_schema() -> None:
    store.bootstrap_schema()


def _node(node_id: str, node_type: str, title: str, fields: dict | None = None) -> GraphWorkflowNode:
    return GraphWorkflowNode(
        id=node_id,
        type=node_type,
        fields=fields or {},
        metadata={"ui": {"customTitle": title}},
    )


def _edge(source: str, target: str = "gpt", *, port: str = "image_refs") -> GraphWorkflowEdge:
    return GraphWorkflowEdge(
        id=f"edge-{source}-{target}-{port}",
        source=source,
        source_port="image",
        target=target,
        target_port=port,
    )


def _workflow(nodes: list[GraphWorkflowNode], edges: list[GraphWorkflowEdge]) -> GraphWorkflow:
    return GraphWorkflow(schema_version=1, name="Character Sheet Test", nodes=nodes, edges=edges, metadata={})


def _title(node: GraphWorkflowNode) -> str:
    ui = node.metadata.get("ui") if isinstance(node.metadata.get("ui"), dict) else {}
    return str(ui.get("customTitle") or node.type)


def _group_bounds(workflow: GraphWorkflow, title: str) -> dict:
    groups = workflow.metadata.get("groups") if isinstance(workflow.metadata, dict) else []
    return next(group["bounds"] for group in groups if isinstance(group, dict) and group.get("title") == title)


def _bounds_overlap(first: dict, second: dict) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def _validate_character_sheet_draft(draft):
    existing = store.get_prompt_recipe_by_key(draft.key)
    recipe_id = existing.get("recipe_id") if existing else None
    return validate_prompt_recipe_payload(draft, recipe_id=recipe_id)


def test_character_sheet_role_mapping_preserves_actual_edge_order() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("body"), _edge("face")],
    )

    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    assert [(role.reference_number, role.source_node_id, role.role_key) for role in roles] == [
        (1, "body", ROLE_BODY_SHAPE),
        (2, "face", ROLE_FACE_IDENTITY),
    ]
    assert all(role.confidence == "high" for role in roles)


def test_character_sheet_role_mapping_dedupes_duplicate_reference_edges() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("recipe", "prompt.recipe", "Character Sheet v1 Recipe"),
        ],
        [
            _edge("face", "recipe"),
            _edge("body", "recipe"),
            GraphWorkflowEdge(
                id="edge-face-recipe-image-refs-duplicate",
                source="face",
                source_port="image",
                target="recipe",
                target_port="image_refs",
            ),
        ],
    )

    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="recipe")

    assert [(role.reference_number, role.source_node_id, role.role_key, role.needs_clarification) for role in roles] == [
        (1, "face", ROLE_FACE_IDENTITY, False),
        (2, "body", ROLE_BODY_SHAPE, False),
    ]


def test_character_sheet_prompt_for_two_refs_has_no_stale_third_reference() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    prompt = compile_character_sheet_prompt(
        roles,
        user_prompt="Make Sadi an adult warrior wizard escaping a castle dungeon.",
        character_name="Sadi",
        age="26",
    )

    assert "[image reference 1] = FACE / IDENTITY LOCK" in prompt
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt
    assert "No extra clothing/style/world reference was provided" in prompt
    assert "image reference 3" not in prompt.lower()


def test_character_sheet_prompt_scopes_third_clothing_world_ref() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("style", "media.load_image", "Clothing / World Style Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body"), _edge("style")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    prompt = compile_character_sheet_prompt(
        roles,
        user_prompt="Use a destroyed spaceport outfit direction.",
    )

    assert roles[2].role_key == ROLE_CLOTHING_STYLE_WORLD
    assert "[image reference 3] = CLOTHING / STYLE / WORLD LOCK" in prompt
    assert "Do not copy body shape, skin tone, face, hair, age impression, or identity from this reference" in prompt


def test_character_sheet_mapper_asks_for_unclear_extra_ref() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("extra", "media.load_image", "Load Image"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body"), _edge("extra")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    question = character_sheet_role_clarification_question(roles)

    assert roles[2].needs_clarification is True
    assert question == "What should image reference 3 control: clothing/style, weapon/prop, environment/world, template/layout, or something else?"
    with pytest.raises(CharacterSheetPromptError, match="image reference 3"):
        compile_character_sheet_prompt(roles, user_prompt="Make a clean character sheet.")


def test_character_sheet_prompt_scopes_template_layout_ref() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("template", "media.load_image", "Approved Character Sheet Template Layout Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body"), _edge("template")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    prompt = compile_character_sheet_prompt(
        roles,
        user_prompt="Make Steve a weathered outlaw engineer.",
        character_name="Steve",
    )

    assert roles[2].role_key == ROLE_TEMPLATE_LAYOUT
    assert "[image reference 3] = TEMPLATE / LAYOUT LOCK" in prompt
    assert "Use only for character-sheet board geometry" in prompt
    assert "must not override character identity, body, outfit, props, story content, printed name, or age" in prompt
    assert "FIXED BOARD GEOMETRY" in prompt
    assert "left vertical title strip takes about 14-18% of the canvas" in prompt


def test_character_sheet_mapper_supports_fourth_weapon_or_prop_ref() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("style", "media.load_image", "Clothing Style Ref"),
            _node("weapon", "media.load_image", "Magic Staff Weapon Prop Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body"), _edge("style"), _edge("weapon")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    prompt = compile_character_sheet_prompt(
        roles,
        user_prompt="Make Sadi a fantasy battle mage.",
    )

    assert roles[3].role_key == ROLE_WEAPON_PROP
    assert "[image reference 4] = WEAPON / PROP LOCK" in prompt
    assert "Use only for weapon, prop, product, accessory" in prompt


def test_character_sheet_creative_brief_normalizes_broad_adult_direction() -> None:
    brief = normalize_character_sheet_creative_brief(
        "Make her more sexy and badass as a beaten-up RPG warrior wizard."
    )

    assert "adult, self-possessed confidence" in brief
    assert "tasteful fitted styling" in brief
    assert "confident and dangerous" in brief
    assert "intricate RPG fantasy design language" in brief
    assert "scratches, dirt, torn fabric, small blood marks" in brief


def test_character_sheet_prompt_sanitizes_missing_reference_mentions_in_user_prompt() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    prompt = compile_character_sheet_prompt(
        roles,
        user_prompt="Use [image reference 3] for armor styling and make her more sexy and badass.",
    )

    assert "image reference 3" not in prompt.lower()
    assert "the appropriate available reference" in prompt
    assert "adult, self-possessed confidence" in prompt


def test_character_sheet_prompt_recipe_draft_uses_external_role_blocks() -> None:
    draft = character_sheet_prompt_recipe_draft()
    validated = _validate_character_sheet_draft(draft)

    assert validated["key"] == "character_sheet_reference_v1"
    assert validated["label"] == "Character Sheet v1"
    assert validated["image_input_json"] == {
        "enabled": True,
        "required": True,
        "mode": "direct_reference",
        "analysis_variable": "image_analysis",
        "max_files": 4,
    }
    assert "{{reference_role_block}}" in validated["system_prompt_template"]
    assert "{{reference_priority_rule}}" in validated["system_prompt_template"]
    assert "{{background_mode_block}}" in validated["system_prompt_template"]
    input_keys = [item["key"] for item in validated["input_variables_json"]]
    assert input_keys == [
        "user_prompt",
        "character_name",
        "age",
        "variant_label",
        "reference_role_block",
        "reference_priority_rule",
        "background_mode_block",
    ]
    assert validated["rules_json"]["requires_ordered_image_refs"] is True


def test_character_sheet_prompt_recipe_draft_preserves_output_contract() -> None:
    draft = character_sheet_prompt_recipe_draft()
    validated = _validate_character_sheet_draft(draft)
    template = validated["system_prompt_template"]

    assert "Treat character names as labels only" in template
    assert "visual identity must come from the mapped image references" in template
    assert "4 large full-body views labeled FRONT, 3/4 FRONT, SIDE, and BACK" in template
    assert "Use a fixed 16:9 production-board blueprint for every character sheet" in template
    assert "Fixed layout zones" in template
    assert "PANEL 01 identity-lock face crops stay in the upper middle" in template
    assert "PANEL 03 expression crops stay in the upper right" in template
    assert "PANEL 02 full-body views stay in the center row" in template
    assert "If a template/layout reference is provided" in template
    assert "Do not shuffle sections" in template
    assert "Visible text is strictly limited to" in template
    assert "Allowed panel titles only" in template
    assert "The title strip is not a profile table" in template
    assert "PANEL 04 CHARACTER DETAILS means visual crop panels only" in template
    assert "Do not add biography, lore paragraphs, stats, specialties" in template
    assert "height/build/alignment blocks" in template
    assert "capability lists" in template
    assert "instead of long text blocks on the sheet" in template


def test_character_sheet_prompt_recipe_draft_uses_generic_character_name_default() -> None:
    draft = character_sheet_prompt_recipe_draft()
    validated = _validate_character_sheet_draft(draft)

    character_name = next(item for item in validated["input_variables_json"] if item["key"] == "character_name")

    assert character_name["default_value"] == "Character"
    assert "Sadi" not in character_name["default_value"]
    assert "Sadie" not in character_name["default_value"]


def test_character_sheet_v3_recipe_uses_golden_prompt_contract() -> None:
    draft = character_sheet_v3_prompt_recipe_draft()
    validated = _validate_character_sheet_draft(draft)
    template = validated["system_prompt_template"]

    assert validated["key"] == "character_sheet_reference_v3"
    assert validated["label"] == "Character Sheet v3"
    assert validated["version"] == "3"
    assert validated["output_format"] == "single_prompt"
    assert validated["image_input_json"] == {
        "enabled": True,
        "required": True,
        "mode": "direct_reference",
        "analysis_variable": "image_analysis",
        "max_files": 4,
    }
    assert "Return only the finished image-generation prompt" in template
    assert "Do not include markdown fences, commentary, JSON, or analysis" in template
    assert "If exactly two images are connected" in template
    assert "Do not mention [image reference 3]" in template
    assert "If three or more images are connected" in template
    assert "CLOTHING / STYLE / WORLD LOCK" in template
    assert "Premium film studio character board" in template
    assert "thin yellow neon UI accents" in template
    assert "FULL-BODY PROPORTION PRIORITY" in template
    assert "Do not squash, compress, shorten, stretch, or crop the body to fit a panel" in template
    assert "reduce PANEL 05 style/mood panel size before reducing the hero or full-body views" in template
    assert "FULL-BODY SPACE ALLOCATION" in template
    assert "Reserve the largest continuous inspection area for PANEL 02" in template
    assert "PANEL 02 - FULL BODY VIEWS: 4 dominant extra-large full-body neutral views labeled FRONT, 3/4 FRONT, SIDE, BACK" in template
    assert "Panel 02 must visibly occupy more room than Panel 05" in template
    assert "PANEL 05 - STYLE / MOOD: 2 small thumbnail-scale supporting same-pose portraits" in template
    assert "compact lighting note or narrow support strip" in template
    assert "much smaller than the full-body views" in template
    assert "Visible text is strictly limited to" in template
    assert "Do not add profile tables, stat cards" in template


def test_character_sheet_v3_recipe_exposes_only_simple_user_fields() -> None:
    draft = character_sheet_v3_prompt_recipe_draft()
    validated = _validate_character_sheet_draft(draft)

    input_keys = [item["key"] for item in validated["input_variables_json"]]
    assert input_keys == ["user_prompt", "character_name", "age"]
    assert validated["custom_fields_json"] == []
    assert validated["rules_json"]["supports_optional_style_world_ref"] is True

    character_name = next(item for item in validated["input_variables_json"] if item["key"] == "character_name")
    assert character_name["default_value"] == "Character"
    assert "Sadi" not in character_name["default_value"]
    assert "Sadie" not in character_name["default_value"]


def test_character_sheet_compiled_prompt_blocks_profile_card_drift() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    prompt = compile_character_sheet_prompt(
        roles,
        user_prompt="Make Sadi a futuristic Western warrior wizard gunslinger.",
        background_mode="clean_white_reference",
        variant_label="Recipe Smoke Review",
    )

    assert "PANEL 02 - FULL BODY VIEWS: 4 large full-body neutral views labeled FRONT, 3/4 FRONT, SIDE, BACK" in prompt
    assert "VISIBLE TEXT CONTRACT" in prompt
    assert "Visible text is strictly limited to" in prompt
    assert "profile tables, stat cards, quote blocks" in prompt
    assert "PANEL 04 CHARACTER DETAILS means visual crop panels only" in prompt
    assert "No biography, lore paragraphs, stats, specialties" in prompt
    assert "height/build/alignment blocks" in prompt
    assert "capability lists" in prompt


def test_character_sheet_compiled_prompt_defaults_to_generic_character_name() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    prompt = compile_character_sheet_prompt(
        roles,
        user_prompt="Make an original desert marshal with luminous spell inlays.",
    )

    assert 'titled "Character"' in prompt
    assert "INFO BLOCK: Include only NAME - Character" in prompt
    assert "Character names are labels only" in prompt
    assert "visual identity must come from the mapped image references" in prompt
    assert "Sadi" not in prompt
    assert "Sadie" not in prompt


def test_character_sheet_recipe_internal_blocks_are_hidden_from_dynamic_fields() -> None:
    draft = character_sheet_prompt_recipe_draft()
    validated = _validate_character_sheet_draft(draft)
    fields = prompt_recipe_dynamic_fields(
        [
            {
                "recipe_id": "prompt-recipe-character-sheet-test",
                "input_variables": validated["input_variables_json"],
                "custom_fields": validated["custom_fields_json"],
            }
        ]
    )
    field_ids = {field.id for field in fields}

    assert {"user_prompt", "character_name", "age", "variant_label", "background_mode"}.issubset(field_ids)
    assert "reference_role_block" not in field_ids
    assert "reference_priority_rule" not in field_ids
    assert "background_mode_block" not in field_ids


def test_character_sheet_recipe_external_variables_match_compiler_blocks() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    variables = character_sheet_prompt_recipe_external_variables(roles, background_mode="clean_white_reference")

    assert "[image reference 1] = FACE / IDENTITY LOCK" in variables["reference_role_block"]
    assert "[image reference 2] = BODY / SHAPE LOCK" in variables["reference_role_block"]
    assert "Face, hair, age impression" in variables["reference_priority_rule"]
    assert "Clean white or light neutral production reference sheet" in variables["background_mode_block"]


def test_character_sheet_graph_plan_reuses_refs_and_preserves_reference_order() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref", {"reference_id": "ref-face"}),
            _node("body", "media.load_image", "Body Shape Ref", {"reference_id": "ref-body"}),
            _node("existing-gpt", "model.kie.gpt_image_2_image_to_image", "Existing GPT Image 2"),
        ],
        [_edge("face", "existing-gpt"), _edge("body", "existing-gpt")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="existing-gpt")

    plan = character_sheet_graph_plan_from_roles(
        roles,
        user_prompt="Make Sadi a glamorous warrior wizard in a castle dungeon.",
        variant_label="Variant 2",
    )
    planned = apply_graph_plan(workflow, plan)
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet GPT Image 2 - Variant 2")
    prompt = next(node for node in planned.nodes if _title(node) == "Character Sheet Prompt - Variant 2")
    incoming_sources = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert plan.metadata["template_id"] == "character_sheet_reference_v1"
    assert incoming_sources == ["face", "body"]
    assert model.fields["aspect_ratio"] == "16:9"
    assert model.fields["resolution"] == "2K"
    assert "[image reference 1] = FACE / IDENTITY LOCK" in prompt.fields["text"]
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt.fields["text"]
    assert "image reference 3" not in prompt.fields["text"].lower()
    groups = [group for group in planned.metadata["groups"] if group.get("title") == "Character Sheet Variant 2"]
    assert len(groups) == 1
    assert "face" not in set(groups[0]["node_ids"])
    assert "body" not in set(groups[0]["node_ids"])


def test_character_sheet_graph_plan_uses_spaced_branch_columns() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref", {"reference_id": "ref-face"}),
            _node("body", "media.load_image", "Body Shape Ref", {"reference_id": "ref-body"}),
        ],
        [],
    )
    plan = character_sheet_graph_plan_from_workflow_request(
        "Create a character sheet graph from the current face and body refs. "
        "I want Sadie in futuristic Western gear with a cyber-cowgirl outfit, leather duster, holsters, and neon trim.",
        workflow,
    )

    assert plan is not None
    positions = {operation.node_ref: operation.position for operation in plan.operations if operation.node_ref}

    assert positions["character-sheet-variant-1-note"]["x"] < positions["character-sheet-variant-1-prompt"]["x"]
    assert positions["character-sheet-variant-1-prompt"]["x"] < positions["character-sheet-variant-1-model"]["x"]
    assert positions["character-sheet-variant-1-model"]["x"] < positions["character-sheet-variant-1-preview"]["x"]
    assert positions["character-sheet-variant-1-save"]["x"] == positions["character-sheet-variant-1-preview"]["x"]
    assert positions["character-sheet-variant-1-save"]["y"] - positions["character-sheet-variant-1-preview"]["y"] >= 600


def test_character_sheet_graph_plan_asks_before_ambiguous_extra() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("extra", "media.load_image", "Load Image"),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2"),
        ],
        [_edge("face"), _edge("body"), _edge("extra")],
    )
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id="gpt")

    plan = character_sheet_graph_plan_from_roles(
        roles,
        user_prompt="Make a character sheet.",
        variant_label="Variant 1",
    )

    assert plan.operations == []
    assert plan.questions == [
        "What should image reference 3 control: clothing/style, weapon/prop, environment/world, template/layout, or something else?"
    ]
    assert plan.metadata["blocked_reason"] == "ambiguous_reference_role"


def test_character_sheet_workflow_request_reuses_clean_face_body_load_nodes() -> None:
    workflow = _workflow(
        [
            _node("body", "media.load_image", "Body Shape Ref", {"reference_id": "ref-body"}),
            _node("face", "media.load_image", "Face Lock Ref", {"reference_id": "ref-face"}),
        ],
        [],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Create a local Character Sheet branch from the current face and body refs. "
        "Make her more sexy and badass as a warrior wizard escaping a castle dungeon. Do not run or save.",
        workflow,
    )
    planned = apply_graph_plan(workflow, plan)
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet GPT Image 2 - Variant 1")
    prompt = next(node for node in planned.nodes if _title(node) == "Character Sheet Prompt - Variant 1")
    incoming_sources = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert plan is not None
    assert plan.metadata["template_id"] == "character_sheet_reference_v1"
    assert incoming_sources == ["face", "body"]
    assert "[image reference 1] = FACE / IDENTITY LOCK" in prompt.fields["text"]
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt.fields["text"]
    assert "image reference 3" not in prompt.fields["text"].lower()
    assert "character sheet branch" not in prompt.fields["text"].lower()
    assert "current face and body refs" not in prompt.fields["text"].lower()
    assert "adult, self-possessed confidence" in prompt.fields["text"]
    assert "intricate RPG fantasy design language" in prompt.fields["text"]


def test_character_sheet_workflow_request_selects_clean_white_background_mode() -> None:
    workflow = _workflow(
        [
            _node("body", "media.load_image", "Body Shape Ref", {"reference_id": "ref-body"}),
            _node("face", "media.load_image", "Face Lock Ref", {"reference_id": "ref-face"}),
        ],
        [],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Create a clean white Character Sheet branch from the current face and body refs. "
        "Make Sadi a futuristic western hero with a high-tech duster and confident stance.",
        workflow,
    )
    planned = apply_graph_plan(workflow, plan)
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet GPT Image 2 - Clean White 1")
    prompt = next(node for node in planned.nodes if _title(node) == "Character Sheet Prompt - Clean White 1")
    note = next(node for node in planned.nodes if _title(node) == "Character Sheet Notes - Clean White 1")
    incoming_sources = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert plan is not None
    assert plan.metadata["background_mode"] == "clean_white_reference"
    assert plan.metadata["variant_label"] == "Clean White 1"
    assert incoming_sources == ["face", "body"]
    assert "[image reference 1] = FACE / IDENTITY LOCK" in prompt.fields["text"]
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt.fields["text"]
    assert "Clean white or light neutral production reference sheet" in prompt.fields["text"]
    assert "dark near-black background" not in prompt.fields["text"]
    assert "character sheet branch" not in prompt.fields["text"].lower()
    assert "clean white branch now" not in prompt.fields["text"].lower()
    assert "Background mode: clean_white_reference" in note.fields["body"]


def test_character_sheet_duplicate_clean_white_variant_preserves_refs_and_spacing() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref", {"reference_id": "ref-face"}),
            _node("body", "media.load_image", "Body Shape Ref", {"reference_id": "ref-body"}),
        ],
        [],
    )

    first_plan = character_sheet_graph_plan_from_workflow_request(
        "Create a clean white character sheet from the current face and body refs. "
        "Make Sadi a futuristic Western gunslinger with a high-tech duster.",
        workflow,
    )
    first_workflow = apply_graph_plan(workflow, first_plan)
    second_plan = character_sheet_graph_plan_from_workflow_request(
        "Create another clean white character sheet variant from the same face and body refs. "
        "This time make the outfit more elegant outlaw queen with chrome embroidery.",
        first_workflow,
        context_message=(
            "Can you make a clean white character sheet from the two image refs already on the canvas? "
            "I want Sadie as a futuristic Western gunslinger with a high-tech duster.\n\n"
            "Use the first image as FACE / IDENTITY LOCK. Use the second image as BODY / SHAPE LOCK. "
            "There is no third style image; build the Western outfit and world from my text brief. "
            "Please build the clean white branch now."
        ),
    )
    second_workflow = apply_graph_plan(first_workflow, second_plan)

    first_model = next(node for node in second_workflow.nodes if _title(node) == "Character Sheet GPT Image 2 - Clean White 1")
    second_model = next(node for node in second_workflow.nodes if _title(node) == "Character Sheet GPT Image 2 - Clean White 2")
    first_sources = [
        edge.source for edge in second_workflow.edges if edge.target == first_model.id and edge.target_port == "image_refs"
    ]
    second_sources = [
        edge.source for edge in second_workflow.edges if edge.target == second_model.id and edge.target_port == "image_refs"
    ]
    second_prompt = next(node for node in second_workflow.nodes if _title(node) == "Character Sheet Prompt - Clean White 2")
    first_bounds = _group_bounds(second_workflow, "Character Sheet Clean White 1")
    second_bounds = _group_bounds(second_workflow, "Character Sheet Clean White 2")

    assert first_plan is not None
    assert second_plan is not None
    assert first_plan.metadata["variant_label"] == "Clean White 1"
    assert second_plan.metadata["variant_label"] == "Clean White 2"
    assert first_sources == ["face", "body"]
    assert second_sources == ["face", "body"]
    assert "[image reference 1] = FACE / IDENTITY LOCK" in second_prompt.fields["text"]
    assert "[image reference 2] = BODY / SHAPE LOCK" in second_prompt.fields["text"]
    assert "image reference 3" not in second_prompt.fields["text"].lower()
    assert "same face and body refs" not in second_prompt.fields["text"].lower()
    assert "character sheet variant" not in second_prompt.fields["text"].lower()
    assert "there is no third style image" not in second_prompt.fields["text"].lower()
    assert "futuristic western gunslinger" not in second_prompt.fields["text"].lower()
    assert "elegant outlaw queen" in second_prompt.fields["text"]
    assert not _bounds_overlap(first_bounds, second_bounds)
    assert second_bounds["x"] > first_bounds["x"]


def test_character_sheet_multi_variant_followup_preserves_refs_and_spreads_branches() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref", {"reference_id": "ref-face"}),
            _node("body", "media.load_image", "Body Shape Ref", {"reference_id": "ref-body"}),
        ],
        [],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Create two more clean white character sheet variations from the same face and body refs. "
        "Make her a desert star marshal with polished chrome and luminous turquoise stitch details.",
        workflow,
    )
    planned = apply_graph_plan(workflow, plan)
    first_model = next(node for node in planned.nodes if _title(node) == "Character Sheet GPT Image 2 - Clean White 1")
    second_model = next(node for node in planned.nodes if _title(node) == "Character Sheet GPT Image 2 - Clean White 2")
    first_prompt = next(node for node in planned.nodes if _title(node) == "Character Sheet Prompt - Clean White 1")
    second_prompt = next(node for node in planned.nodes if _title(node) == "Character Sheet Prompt - Clean White 2")
    first_sources = [edge.source for edge in planned.edges if edge.target == first_model.id and edge.target_port == "image_refs"]
    second_sources = [edge.source for edge in planned.edges if edge.target == second_model.id and edge.target_port == "image_refs"]
    first_bounds = _group_bounds(planned, "Character Sheet Clean White 1")
    second_bounds = _group_bounds(planned, "Character Sheet Clean White 2")

    assert plan is not None
    assert plan.metadata["variant_count"] == 2
    assert plan.metadata["variant_labels"] == ["Clean White 1", "Clean White 2"]
    assert first_sources == ["face", "body"]
    assert second_sources == ["face", "body"]
    assert "Create two more" not in first_prompt.fields["text"]
    assert "Create two more" not in second_prompt.fields["text"]
    assert "image reference 3" not in first_prompt.fields["text"].lower()
    assert "image reference 3" not in second_prompt.fields["text"].lower()
    assert "desert star marshal" in first_prompt.fields["text"]
    assert "desert star marshal" in second_prompt.fields["text"]
    assert "Variant exploration 1" in first_prompt.fields["text"]
    assert "Variant exploration 2" in second_prompt.fields["text"]
    assert not _bounds_overlap(first_bounds, second_bounds)
    assert second_bounds["x"] > first_bounds["x"]


def test_character_sheet_branch_edit_uses_selected_branch_reference_mapping() -> None:
    workflow = _workflow(
        [
            _node("face-a", "media.load_image", "Face Lock Ref A", {"reference_id": "ref-face-a"}),
            _node("body-a", "media.load_image", "Body Shape Ref A", {"reference_id": "ref-body-a"}),
            _node("prompt-a", "prompt.text", "Character Sheet Prompt - Variant 1", {"text": "Prompt A"}),
            _node("gpt-a", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2 - Variant 1"),
            _node("preview-a", "preview.image", "Character Sheet Preview - Variant 1"),
            _node("save-a", "media.save_image", "Save Character Sheet - Variant 1"),
            _node("face-b", "media.load_image", "Face Lock Ref B", {"reference_id": "ref-face-b"}),
            _node("body-b", "media.load_image", "Body Shape Ref B", {"reference_id": "ref-body-b"}),
            _node("prompt-b", "prompt.text", "Character Sheet Prompt - Variant 2", {"text": "Prompt B"}),
            _node("gpt-b", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2 - Variant 2"),
            _node("preview-b", "preview.image", "Character Sheet Preview - Variant 2"),
            _node("save-b", "media.save_image", "Save Character Sheet - Variant 2"),
        ],
        [
            _edge("face-a", "gpt-a"),
            _edge("body-a", "gpt-a"),
            _edge("face-b", "gpt-b"),
            _edge("body-b", "gpt-b"),
        ],
    )
    workflow.metadata = {
        "groups": [
            {"id": "group-a", "title": "Character Sheet Variant 1", "node_ids": ["prompt-a", "gpt-a", "preview-a", "save-a"]},
            {"id": "group-b", "title": "Character Sheet Variant 2", "node_ids": ["prompt-b", "gpt-b", "preview-b", "save-b"]},
        ]
    }
    canvas_context = {
        "selection_available": True,
        "selected_node_ids": ["prompt-b"],
        "selected_group_ids": [],
    }

    assert (
        selected_node_field_edit_plan_from_context(
            "Duplicate this branch and make her a neon dungeon cyborg queen. Do not run or save.",
            workflow,
            canvas_context,
        )
        is None
    )
    plan = character_sheet_graph_plan_from_workflow_request(
        "Duplicate this branch and make her a neon dungeon cyborg queen. Do not run or save.",
        workflow,
        canvas_context=canvas_context,
    )
    assert plan is not None
    planned = apply_graph_plan(workflow, plan)
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet GPT Image 2 - Variant 3")
    prompt = next(node for node in planned.nodes if _title(node) == "Character Sheet Prompt - Variant 3")
    incoming_sources = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert plan.metadata["branch_aware_duplicate"] is True
    assert plan.metadata["source_branch_target_node_id"] == "gpt-b"
    assert plan.metadata["source_branch_title"] == "Character Sheet Variant 2"
    assert incoming_sources == ["face-b", "body-b"]
    assert "neon dungeon cyborg queen" in prompt.fields["text"]
    assert "duplicate this branch" not in prompt.fields["text"].lower()
    assert "[image reference 1] = FACE / IDENTITY LOCK" in prompt.fields["text"]
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt.fields["text"]


def test_character_sheet_branch_edit_falls_back_to_clean_load_refs_when_selected_target_is_noisy() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref", {"reference_id": "ref-face"}),
            _node("body", "media.load_image", "Body Shape Ref", {"reference_id": "ref-body"}),
            _node("recipe", "prompt.recipe", "Character Sheet v1 Recipe", {"user_prompt": "Old prompt"}),
            _node("noise", "prompt.text", "Prompt Text", {"text": "Not an image role"}),
        ],
        [
            _edge("face", "recipe"),
            _edge("body", "recipe"),
            GraphWorkflowEdge(
                id="edge-noise-recipe-image-refs",
                source="noise",
                source_port="text",
                target="recipe",
                target_port="image_refs",
            ),
        ],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Duplicate this branch and make this version a pearl-white cybernetic battle mage.",
        workflow,
        canvas_context={
            "selection_available": True,
            "selected_node_ids": ["recipe"],
            "selected_group_ids": [],
        },
    )
    assert plan is not None
    planned = apply_graph_plan(workflow, plan)
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet GPT Image 2 - Variant 1")
    incoming_sources = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert incoming_sources == ["face", "body"]
    assert plan.metadata["branch_aware_duplicate"] is True
    assert plan.metadata["reference_roles"] == [
        {"reference_number": 1, "source_node_id": "face", "role_key": ROLE_FACE_IDENTITY, "role_label": "FACE / IDENTITY LOCK", "confidence": "high"},
        {"reference_number": 2, "source_node_id": "body", "role_key": ROLE_BODY_SHAPE, "role_label": "BODY / SHAPE LOCK", "confidence": "high"},
    ]


def test_character_sheet_branch_edit_defaults_two_untitled_load_refs_to_face_and_body() -> None:
    workflow = _workflow(
        [
            _node("first-ref", "media.load_image", "Load Image", {"reference_id": "ref-a"}),
            _node("second-ref", "media.load_image", "Load Image", {"reference_id": "ref-b"}),
            _node("recipe", "prompt.recipe", "Character Sheet v1 Recipe", {"user_prompt": "Old prompt"}),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "GPT Image 2 - Character Sheet"),
            _node("noise", "prompt.text", "Prompt Text", {"text": "Not an image role"}),
        ],
        [
            _edge("first-ref", "recipe"),
            _edge("second-ref", "recipe"),
            _edge("first-ref", "gpt"),
            _edge("second-ref", "gpt"),
            GraphWorkflowEdge(
                id="edge-recipe-gpt-prompt",
                source="recipe",
                source_port="text",
                target="gpt",
                target_port="prompt",
            ),
            GraphWorkflowEdge(
                id="edge-noise-recipe-image-refs",
                source="noise",
                source_port="text",
                target="recipe",
                target_port="image_refs",
            ),
        ],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Duplicate this branch and make this version a moonlit cyber-witch knight.",
        workflow,
        canvas_context={
            "selection_available": True,
            "selected_node_ids": ["recipe"],
            "selected_group_ids": [],
        },
    )

    assert plan is not None
    assert plan.operations
    assert plan.metadata["reference_roles"] == [
        {
            "reference_number": 1,
            "source_node_id": "first-ref",
            "role_key": ROLE_FACE_IDENTITY,
            "role_label": "FACE / IDENTITY LOCK",
            "confidence": "medium",
        },
        {
            "reference_number": 2,
            "source_node_id": "second-ref",
            "role_key": ROLE_BODY_SHAPE,
            "role_label": "BODY / SHAPE LOCK",
            "confidence": "medium",
        },
    ]


def test_character_sheet_branch_edit_uses_single_branch_when_selection_context_is_missing() -> None:
    workflow = _workflow(
        [
            _node("first-ref", "media.load_image", "Load Image", {"reference_id": "ref-a"}),
            _node("second-ref", "media.load_image", "Load Image", {"reference_id": "ref-b"}),
            _node("recipe", "prompt.recipe", "Character Sheet v1 Recipe", {"user_prompt": "Old prompt"}),
            _node("gpt", "model.kie.gpt_image_2_image_to_image", "GPT Image 2 - Character Sheet"),
            _node("noise", "prompt.text", "Prompt Text", {"text": "Not an image role"}),
        ],
        [
            _edge("first-ref", "recipe"),
            _edge("second-ref", "recipe"),
            _edge("first-ref", "gpt"),
            _edge("second-ref", "gpt"),
            GraphWorkflowEdge(
                id="edge-recipe-gpt-prompt",
                source="recipe",
                source_port="text",
                target="gpt",
                target_port="prompt",
            ),
            GraphWorkflowEdge(
                id="edge-noise-recipe-image-refs",
                source="noise",
                source_port="text",
                target="recipe",
                target_port="image_refs",
            ),
        ],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Duplicate this branch and make this version a starlit cyber-witch knight.",
        workflow,
        canvas_context={},
    )

    assert plan is not None
    assert plan.operations
    assert plan.metadata["branch_aware_duplicate"] is True
    assert plan.metadata["source_branch_target_node_id"] == "gpt"
    assert plan.metadata["reference_roles"][0]["source_node_id"] == "first-ref"
    assert plan.metadata["reference_roles"][0]["role_key"] == ROLE_FACE_IDENTITY
    assert plan.metadata["reference_roles"][1]["source_node_id"] == "second-ref"
    assert plan.metadata["reference_roles"][1]["role_key"] == ROLE_BODY_SHAPE


def test_character_sheet_branch_edit_asks_when_selection_has_multiple_branches() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Face Lock Ref"),
            _node("body", "media.load_image", "Body Shape Ref"),
            _node("gpt-a", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2 - Variant 1"),
            _node("gpt-b", "model.kie.gpt_image_2_image_to_image", "Character Sheet GPT Image 2 - Variant 2"),
        ],
        [_edge("face", "gpt-a"), _edge("body", "gpt-a"), _edge("face", "gpt-b"), _edge("body", "gpt-b")],
    )
    workflow.metadata = {
        "groups": [
            {"id": "group-a", "title": "Character Sheet Variant 1", "node_ids": ["gpt-a"]},
            {"id": "group-b", "title": "Character Sheet Variant 2", "node_ids": ["gpt-b"]},
        ]
    }

    plan = character_sheet_graph_plan_from_workflow_request(
        "Duplicate this branch and make her more cybernetic.",
        workflow,
        canvas_context={
            "selection_available": True,
            "selected_node_ids": [],
            "selected_group_ids": ["group-a", "group-b"],
        },
    )

    assert plan is not None
    assert plan.operations == []
    assert plan.metadata["blocked_reason"] == "multiple_selected_character_sheet_branches"


def test_character_sheet_role_confirmation_uses_prior_creative_brief_without_setup_leak() -> None:
    workflow = _workflow(
        [
            _node("first", "media.load_image", "Load Image A", {"reference_id": "ref-a"}),
            _node("second", "media.load_image", "Load Image B", {"reference_id": "ref-b"}),
        ],
        [],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Use the first image as FACE / IDENTITY LOCK. Use the second image as BODY / SHAPE LOCK. "
        "There is no third style image; build the Western outfit and world from my text brief. "
        "Please build the clean white branch now.",
        workflow,
        context_message=(
            "Can you make a clean white character sheet from the two image refs already on the canvas? "
            "I want Sadie as a futuristic Western gunslinger with a high-tech duster, chrome holsters, "
            "and dusty frontier sci-fi confidence."
        ),
    )
    planned = apply_graph_plan(workflow, plan)
    prompt = next(node for node in planned.nodes if _title(node) == "Character Sheet Prompt - Clean White 1")

    assert plan is not None
    assert plan.metadata["variant_label"] == "Clean White 1"
    assert "futuristic Western gunslinger" in prompt.fields["text"]
    assert "chrome holsters" in prompt.fields["text"]
    assert "there is no third style image" not in prompt.fields["text"].lower()
    assert "clean white branch now" not in prompt.fields["text"].lower()


def test_character_sheet_workflow_request_asks_when_load_nodes_are_ambiguous() -> None:
    workflow = _workflow(
        [
            _node("first", "media.load_image", "Load Image A", {"reference_id": "ref-a"}),
            _node("second", "media.load_image", "Load Image B", {"reference_id": "ref-b"}),
        ],
        [],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Create a local Character Sheet branch from these refs. Do not run or save.",
        workflow,
    )

    assert plan is not None
    assert plan.operations == []
    assert plan.questions == ["Which image node should be the face lock, and which should be the body lock?"]
    assert plan.metadata["blocked_reason"] == "missing_reference_roles"


def test_character_sheet_v3_workflow_request_uses_prompt_recipe_node() -> None:
    workflow = _workflow(
        [
            _node("face", "media.load_image", "Sadi Face / Identity Ref", {"reference_id": "ref-face"}),
            _node("body", "media.load_image", "Sadi Body / Shape Ref", {"reference_id": "ref-body"}),
        ],
        [],
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Create a local unsaved Character Sheet v3 workflow from these refs. "
        "Use image reference 1 as face identity and image reference 2 as body shape. "
        "Creative brief: Sadi as a fantasy ranger princess with emerald amulet. Do not run or save.",
        workflow,
    )
    planned = apply_graph_plan(workflow, plan)
    recipe = next(node for node in planned.nodes if _title(node) == "Character Sheet v3 Recipe - Variant 1")
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet v3 GPT Image 2 - Variant 1")
    incoming_recipe_refs = [edge.source for edge in planned.edges if edge.target == recipe.id and edge.target_port == "image_refs"]
    incoming_model_refs = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert plan is not None
    assert plan.operations
    assert plan.metadata["template_id"] == "character_sheet_reference_v3"
    assert recipe.type == "prompt.recipe"
    assert recipe.fields["recipe_id"] in {"character_sheet_reference_v3", "recipe_792c82b7acf3"}
    assert recipe.fields["recipe_category"] == "image"
    assert "fantasy ranger princess" in recipe.fields["user_prompt"]
    assert recipe.fields["character_name"] == "Sadi"
    assert incoming_recipe_refs == ["face", "body"]
    assert incoming_model_refs == ["face", "body"]
    assert model.fields["aspect_ratio"] == "16:9"
    assert model.fields["resolution"] == "2K"


def test_character_sheet_v3_placeholder_request_builds_load_image_refs() -> None:
    workflow = _workflow([], [])

    plan = character_sheet_graph_plan_from_workflow_request(
        "Create a local unsaved Character Sheet v3 test workflow on this blank canvas. "
        "Use two placeholder Load Image refs named Sadi Face / Identity Ref and Sadi Body / Shape Ref. "
        "Creative brief: adult fantasy ranger princess with emerald amulet. Do not run or save.",
        workflow,
    )
    planned = apply_graph_plan(workflow, plan)
    face = next(node for node in planned.nodes if _title(node) == "Sadi Face / Identity Ref")
    body = next(node for node in planned.nodes if _title(node) == "Sadi Body / Shape Ref")
    recipe = next(node for node in planned.nodes if _title(node) == "Character Sheet v3 Recipe - Variant 1")
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet v3 GPT Image 2 - Variant 1")
    incoming_recipe_refs = [edge.source for edge in planned.edges if edge.target == recipe.id and edge.target_port == "image_refs"]
    incoming_model_refs = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert plan is not None
    assert plan.operations
    assert plan.questions == []
    assert plan.metadata["template_id"] == "character_sheet_reference_v3"
    assert plan.metadata["uses_placeholder_refs"] is True
    assert face.type == "media.load_image"
    assert body.type == "media.load_image"
    assert recipe.type == "prompt.recipe"
    assert recipe.fields["recipe_id"] in {"character_sheet_reference_v3", "recipe_792c82b7acf3"}
    assert incoming_recipe_refs == [face.id, body.id]
    assert incoming_model_refs == [face.id, body.id]
    assert model.fields["aspect_ratio"] == "16:9"
    assert model.fields["resolution"] == "2K"


def test_character_sheet_v3_attached_refs_prefill_load_image_refs() -> None:
    workflow = _workflow([], [])

    plan = character_sheet_graph_plan_from_workflow_request(
        "Create a local unsaved Character Sheet v3 workflow using the two attached reference images. "
        "Use attached reference image 1 as FACE / IDENTITY LOCK and attached reference image 2 as BODY / SHAPE LOCK. "
        "Creative brief: adult fantasy ranger princess with emerald amulet. Do not run or save.",
        workflow,
        attachments=[
            {"kind": "image", "reference_id": "ref-sadi-face", "label": "sadi-face_chest.jpg"},
            {"kind": "image", "reference_id": "ref-sadi-body", "label": "sadi-front.jpg"},
        ],
    )
    planned = apply_graph_plan(workflow, plan)
    face = next(node for node in planned.nodes if _title(node) == "Sadi Face / Identity Ref")
    body = next(node for node in planned.nodes if _title(node) == "Sadi Body / Shape Ref")
    recipe = next(node for node in planned.nodes if _title(node) == "Character Sheet v3 Recipe - Variant 1")
    model = next(node for node in planned.nodes if _title(node) == "Character Sheet v3 GPT Image 2 - Variant 1")
    incoming_model_refs = [edge.source for edge in planned.edges if edge.target == model.id and edge.target_port == "image_refs"]

    assert plan is not None
    assert plan.operations
    assert plan.metadata["template_id"] == "character_sheet_reference_v3"
    assert plan.metadata["uses_placeholder_refs"] is True
    assert face.fields["reference_id"] == "ref-sadi-face"
    assert body.fields["reference_id"] == "ref-sadi-body"
    assert recipe.fields["recipe_id"] in {"character_sheet_reference_v3", "recipe_792c82b7acf3"}
    assert incoming_model_refs == [face.id, body.id]
    assert model.fields["aspect_ratio"] == "16:9"
    assert model.fields["resolution"] == "2K"


def test_character_sheet_followup_uses_prior_role_confirmation_context() -> None:
    workflow = _workflow(
        [
            _node("first", "media.load_image", "Load Image", {"reference_id": "ref-face"}),
            _node("second", "media.load_image", "Load Image", {"reference_id": "ref-body"}),
        ],
        [],
    )
    context = "\n\n".join(
        [
            "Can you make a character sheet from the refs I put on the canvas? I want Sadie in futuristic Western gear: sleek cyber-cowgirl outfit, high-tech leather duster, metallic belt and holsters, advanced boots, subtle neon trim, dusty frontier sci-fi attitude, confident and cinematic.",
            "Use the first Sadie ref as the face and identity lock, and the second Sadie ref as the body and shape lock. Build the outfit and world from my text prompt.",
        ]
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Go cinematic and moody. Please create the unsaved character sheet graph branch now so I can inspect it.",
        workflow,
        context_message=context,
    )

    assert plan is not None
    assert plan.operations
    assert "blocked_reason" not in plan.metadata
    assert plan.metadata["reference_roles"][0]["source_node_id"] == "first"
    assert plan.metadata["reference_roles"][0]["role_key"] == ROLE_FACE_IDENTITY
    assert plan.metadata["reference_roles"][1]["source_node_id"] == "second"
    assert plan.metadata["reference_roles"][1]["role_key"] == ROLE_BODY_SHAPE
    prompt = next(operation.fields["text"] for operation in plan.operations if operation.node_ref and "prompt" in operation.node_ref)
    assert "futuristic Western gear" in prompt
    assert "high-tech leather duster" in prompt
    assert "[image reference 1] = FACE / IDENTITY LOCK" in prompt
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt


def test_character_sheet_followup_accepts_upper_lower_role_confirmation() -> None:
    workflow = _workflow(
        [
            _node("top-ref", "media.load_image", "Load Image", {"reference_id": "ref-a"}),
            _node("bottom-ref", "media.load_image", "Load Image", {"reference_id": "ref-b"}),
        ],
        [],
    )
    context = "\n\n".join(
        [
            "Can you make a character sheet from the two refs I put on the canvas? I want Sadie in futuristic Western gear.",
            "Use the upper ref as the face and identity lock and the lower ref as the body and shape lock.",
        ]
    )

    plan = character_sheet_graph_plan_from_workflow_request(
        "Go ahead and build the unsaved graph branch.",
        workflow,
        context_message=context,
    )

    assert plan is not None
    assert plan.operations
    assert plan.metadata["reference_roles"][0]["source_node_id"] == "top-ref"
    assert plan.metadata["reference_roles"][0]["role_key"] == ROLE_FACE_IDENTITY
    assert plan.metadata["reference_roles"][1]["source_node_id"] == "bottom-ref"
    assert plan.metadata["reference_roles"][1]["role_key"] == ROLE_BODY_SHAPE
    prompt = next(operation.fields["text"] for operation in plan.operations if operation.node_ref and "prompt" in operation.node_ref)
    assert "upper ref" not in prompt.lower()
    assert "lower ref" not in prompt.lower()
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt
