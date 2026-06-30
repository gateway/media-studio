from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable

from .. import store
from ..graph.schemas import GraphWorkflow, GraphWorkflowNode
from ..schemas import PromptRecipeUpsertRequest
from .canvas_context import compact_canvas_context
from .schemas import AssistantGraphOperation, AssistantGraphPlan


IMAGE_REFERENCE_TARGET_PORTS = {"image_refs", "reference_images"}
IMAGE_REFERENCE_SOURCE_PORTS = {"image", "images", "asset", "assets"}

ROLE_FACE_IDENTITY = "face_identity"
ROLE_BODY_SHAPE = "body_shape"
ROLE_CLOTHING_STYLE_WORLD = "clothing_style_world"
ROLE_WEAPON_PROP = "weapon_prop"
ROLE_ENVIRONMENT_WORLD = "environment_world"
ROLE_TEMPLATE_LAYOUT = "template_layout"
ROLE_EXTRA_REFERENCE = "extra_reference"
CHARACTER_SHEET_TEMPLATE_ID = "character_sheet_reference_v1"
CHARACTER_SHEET_RECIPE_LABEL = "Character Sheet v1"
CHARACTER_SHEET_V3_TEMPLATE_ID = "character_sheet_reference_v3"
CHARACTER_SHEET_V3_RECIPE_LABEL = "Character Sheet v3"
CHARACTER_SHEET_INTERNAL_VARIABLE_KEYS = {
    "reference_role_block",
    "reference_priority_rule",
    "background_mode_block",
}
CHARACTER_SHEET_LAYOUT_NOTE_X = 420.0
CHARACTER_SHEET_LAYOUT_PROMPT_X = 1040.0
CHARACTER_SHEET_LAYOUT_MODEL_X = 1680.0
CHARACTER_SHEET_LAYOUT_OUTPUT_X = 2320.0
CHARACTER_SHEET_REF_LOAD_X = 420.0
CHARACTER_SHEET_REF_FACE_Y = 120.0
CHARACTER_SHEET_REF_BODY_Y = 560.0
CHARACTER_SHEET_MULTI_VARIANT_GAP_X = 3200.0
CHARACTER_SHEET_MAX_VARIANTS_PER_REQUEST = 3
CHARACTER_SHEET_FIXED_LAYOUT_REQUIREMENTS = (
    "- Use a fixed 16:9 production-board blueprint for every character sheet. Keep the same board geometry across different characters; only the character identity, body, outfit, props, and mood should change.",
    "- Fixed layout zones: left vertical title strip takes about 14-18% of the canvas; the large hero portrait/body image sits immediately to its right and takes about 28-34%; PANEL 01 identity-lock face crops stay in the upper middle; PANEL 03 expression crops stay in the upper right; PANEL 02 full-body views stay in the center row; PANEL 04 details, PANEL 05 lighting/mood, and the color palette stay in the lower third.",
    "- Keep the visual hierarchy stable: title strip -> hero image -> upper identity/expression rows -> center full-body row -> lower detail/mood/palette strip. Do not shuffle sections, split into unrelated cards, or turn the sheet into a dossier, poster, trading card, collage, stats sheet, or lore page.",
    "- Keep panel borders, thin dividers, label placement, typography scale, padding, and spacing consistent. Labels must stay compact and readable; decorative text must not compete with the character panels.",
    "- If a template/layout reference is provided, copy only its board geometry, panel proportions, border language, spacing, label placement, and typography hierarchy.",
)
CHARACTER_SHEET_ALLOWED_VISIBLE_TEXT = (
    "- Visible text is strictly limited to: character name, age, variant label, panel titles, view labels, expression labels, detail labels, lighting labels, and optional HEX color codes.",
    "- Allowed panel titles only: PANEL 01 IDENTITY LOCK, PANEL 02 FULL BODY VIEWS, PANEL 03 EXPRESSIONS, PANEL 04 CHARACTER DETAILS, PANEL 05 STYLE / MOOD, COLOR PALETTE.",
    "- Allowed view and crop labels only: NEUTRAL FRONT, 3/4 FACE, SIDE FACE, CLOSE EYES, FRONT, 3/4 FRONT, SIDE, BACK, CALM, LAUGHING, INTENSE, CONFIDENT, FACE / SKIN TEXTURE, HAND / WRIST, OUTFIT MATERIAL, NATURAL LIGHT, DRAMATIC RIM LIGHT.",
    "- Do not add profile tables, stat cards, quote blocks, faction/alignment/origin/species/role/class/occupation/skills/abilities/weapons lists, lore paragraphs, biography text, capability lists, height/weight/build metadata, or story summaries.",
    "- The title strip is not a profile table. It may show only the name, age, variant label, and decorative separators.",
    "- PANEL 04 CHARACTER DETAILS means visual crop panels only; it must not contain written character facts or metadata.",
)
ROLE_ORDER = {
    ROLE_FACE_IDENTITY: 0,
    ROLE_BODY_SHAPE: 1,
    ROLE_CLOTHING_STYLE_WORLD: 2,
    ROLE_WEAPON_PROP: 3,
    ROLE_ENVIRONMENT_WORLD: 4,
    ROLE_TEMPLATE_LAYOUT: 5,
    ROLE_EXTRA_REFERENCE: 6,
}


@dataclass(frozen=True)
class CharacterSheetReferenceRole:
    reference_number: int
    source_node_id: str
    source_port: str
    target_node_id: str
    target_port: str
    role_key: str
    role_label: str
    scope: str
    confidence: str
    needs_clarification: bool
    evidence: tuple[str, ...] = ()


class CharacterSheetPromptError(ValueError):
    pass


@dataclass(frozen=True)
class CharacterSheetBranchTarget:
    target_node_id: str
    group_id: str | None = None
    group_title: str | None = None


ROLE_LABELS = {
    ROLE_FACE_IDENTITY: "FACE / IDENTITY LOCK",
    ROLE_BODY_SHAPE: "BODY / SHAPE LOCK",
    ROLE_CLOTHING_STYLE_WORLD: "CLOTHING / STYLE / WORLD LOCK",
    ROLE_WEAPON_PROP: "WEAPON / PROP LOCK",
    ROLE_ENVIRONMENT_WORLD: "ENVIRONMENT / WORLD / MOOD LOCK",
    ROLE_TEMPLATE_LAYOUT: "TEMPLATE / LAYOUT LOCK",
    ROLE_EXTRA_REFERENCE: "EXTRA REFERENCE",
}


ROLE_SCOPES = {
    ROLE_FACE_IDENTITY: (
        "Highest priority. Use for face shape, jawline, cheekbones, nose, lips, smile, eyes, brows, "
        "skin tone, freckles/marks, age impression, hairline, hair color, hairstyle, and recognizable identity."
    ),
    ROLE_BODY_SHAPE: (
        "Use for body proportions, build, posture, height impression, silhouette, shoulders, torso, waist, "
        "hips, arms, legs, and physical presence."
    ),
    ROLE_CLOTHING_STYLE_WORLD: (
        "Use only for outfit, materials, accessories, footwear, weathering, color palette, lighting mood, "
        "environment, background, and cinematic atmosphere. Do not copy body shape, skin tone, face, hair, "
        "age impression, or identity from this reference."
    ),
    ROLE_WEAPON_PROP: (
        "Use only for weapon, prop, product, accessory, material, and surface-design details. Do not copy face, "
        "skin tone, body shape, age impression, hair, or identity from this reference."
    ),
    ROLE_ENVIRONMENT_WORLD: (
        "Use only for world, environment, architecture, lighting mood, atmosphere, palette, and background. "
        "Do not copy face, skin tone, body shape, hair, age impression, or identity from this reference."
    ),
    ROLE_TEMPLATE_LAYOUT: (
        "Use only for character-sheet board geometry, panel placement, typography hierarchy, border treatment, "
        "spacing, label placement, and dark/light production-board framing. Do not copy face, body, outfit, props, "
        "palette identity, name text, age text, story content, or character identity from this reference."
    ),
    ROLE_EXTRA_REFERENCE: "Use only after the user confirms what this extra reference should control.",
}


ROLE_KEYWORD_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (ROLE_FACE_IDENTITY, ("face", "identity", "headshot", "portrait", "facial", "id lock")),
    (ROLE_BODY_SHAPE, ("body", "shape", "proportion", "full body", "front", "silhouette")),
    (
        ROLE_TEMPLATE_LAYOUT,
        ("template", "layout", "board", "production board", "character sheet", "reference sheet", "sheet style"),
    ),
    (
        ROLE_CLOTHING_STYLE_WORLD,
        ("clothing", "wardrobe", "outfit", "style", "armor", "costume", "world style", "fashion"),
    ),
    (ROLE_WEAPON_PROP, ("weapon", "prop", "product", "sword", "staff", "accessory", "gear")),
    (ROLE_ENVIRONMENT_WORLD, ("environment", "world", "mood", "castle", "dungeon", "spaceport", "background")),
)


def _node_title(node: GraphWorkflowNode) -> str:
    ui = node.metadata.get("ui") if isinstance(node.metadata.get("ui"), dict) else {}
    return str(ui.get("customTitle") or node.fields.get("title") or node.fields.get("label") or node.type or node.id).strip()


def _workflow_node_title(node: GraphWorkflowNode) -> str:
    return _node_title(node)


def _node_role_text(node: GraphWorkflowNode) -> str:
    values: list[str] = [_node_title(node), node.id, node.type]
    for key in ("label", "name", "title", "filename", "file_name", "asset_id", "reference_id", "media_label"):
        value = node.fields.get(key)
        if value:
            values.append(str(value))
    return " ".join(values).lower()


def _role_from_text(text: str) -> tuple[str | None, str | None]:
    normalized = f" {text.lower()} "
    for role_key, keywords in ROLE_KEYWORD_GROUPS:
        for keyword in keywords:
            if keyword in normalized:
                return role_key, keyword
    return None, None


def _default_role_for_position(reference_number: int) -> str:
    if reference_number == 1:
        return ROLE_FACE_IDENTITY
    if reference_number == 2:
        return ROLE_BODY_SHAPE
    return ROLE_EXTRA_REFERENCE


def _target_node_ids_with_image_refs(workflow: GraphWorkflow, target_port_ids: set[str]) -> list[str]:
    seen: list[str] = []
    for edge in workflow.edges:
        if edge.target_port not in target_port_ids:
            continue
        if edge.target not in seen:
            seen.append(edge.target)
    return seen


def character_sheet_reference_roles_from_workflow(
    workflow: GraphWorkflow,
    *,
    target_node_id: str | None = None,
    target_port_ids: Iterable[str] = IMAGE_REFERENCE_TARGET_PORTS,
) -> list[CharacterSheetReferenceRole]:
    port_ids = {str(port_id) for port_id in target_port_ids}
    if target_node_id is None:
        target_ids = _target_node_ids_with_image_refs(workflow, port_ids)
        if len(target_ids) != 1:
            raise CharacterSheetPromptError("Character Sheet role mapping needs exactly one target image model node.")
        target_node_id = target_ids[0]

    nodes_by_id = {node.id: node for node in workflow.nodes}
    roles: list[CharacterSheetReferenceRole] = []
    seen_reference_edges: set[tuple[str, str, str]] = set()
    for edge in workflow.edges:
        if edge.target != target_node_id or edge.target_port not in port_ids:
            continue
        if edge.source_port not in IMAGE_REFERENCE_SOURCE_PORTS:
            continue
        edge_key = (edge.source, edge.source_port, edge.target_port)
        if edge_key in seen_reference_edges:
            continue
        seen_reference_edges.add(edge_key)
        source = nodes_by_id.get(edge.source)
        if source is None:
            continue
        reference_number = len(roles) + 1
        text = _node_role_text(source)
        role_key, matched_keyword = _role_from_text(text)
        evidence: list[str] = [f"wire_order:{reference_number}", f"source_title:{_node_title(source)}"]
        if role_key:
            evidence.append(f"matched:{matched_keyword}")
            confidence = "high"
            needs_clarification = False
        else:
            role_key = _default_role_for_position(reference_number)
            confidence = "medium" if reference_number <= 2 else "low"
            evidence.append("position_default" if reference_number <= 2 else "ambiguous_extra")
            needs_clarification = reference_number > 2
        roles.append(
            CharacterSheetReferenceRole(
                reference_number=reference_number,
                source_node_id=edge.source,
                source_port=edge.source_port,
                target_node_id=edge.target,
                target_port=edge.target_port,
                role_key=role_key,
                role_label=ROLE_LABELS[role_key],
                scope=ROLE_SCOPES[role_key],
                confidence=confidence,
                needs_clarification=needs_clarification,
                evidence=tuple(evidence),
            )
        )
    return roles


def character_sheet_role_clarification_question(roles: Iterable[CharacterSheetReferenceRole]) -> str | None:
    ambiguous = [role for role in roles if role.needs_clarification]
    if not ambiguous:
        return None
    references = ", ".join(f"image reference {role.reference_number}" for role in ambiguous)
    if len(ambiguous) == 1:
        return f"What should {references} control: clothing/style, weapon/prop, environment/world, template/layout, or something else?"
    return f"What should these extra refs control: {references}?"


def normalize_character_sheet_creative_brief(user_prompt: str) -> str:
    base = " ".join(str(user_prompt or "").split()).strip()
    if not base:
        base = "Create a clear, production-ready character-sheet design from the available references."
    lowered = base.lower()
    additions: list[str] = []
    if any(term in lowered for term in ("sexy", "glamorous", "sensual", "hot")):
        additions.append(
            "Translate the glamour as adult, self-possessed confidence, tasteful fitted styling, a readable silhouette, "
            "and functional wardrobe details rather than explicit posing."
        )
    if any(term in lowered for term in ("badass", "dangerous", "fierce", "tough")):
        additions.append(
            "Make the attitude confident and dangerous with a stronger heroic posture, sharper expression, combat-ready stance, "
            "and cinematic presence."
        )
    if any(term in lowered for term in ("wizard", "mage", "sorcer", "magic", "rpg", "fantasy")):
        additions.append(
            "Use intricate RPG fantasy design language, layered fabrics, arcane accents, practical armor details, and controlled magic glow."
        )
    if any(term in lowered for term in ("beaten", "scratch", "scratches", "blood", "bloodied", "dirt", "dirty", "torn")):
        additions.append(
            "Show battle-worn story detail through scratches, dirt, torn fabric, small blood marks, scuffs, and weathering while keeping the face readable."
        )
    if not additions:
        return base
    return " ".join([base, *additions])


def _sanitize_stale_reference_mentions(text: str, max_reference_number: int) -> str:
    def replace(match: re.Match[str]) -> str:
        number = int(match.group(1))
        if number <= max_reference_number:
            return match.group(0)
        return "the appropriate available reference"

    text = re.sub(r"\[image reference\s+(\d+)\]", replace, text, flags=re.IGNORECASE)
    return re.sub(r"\bimage reference\s+(\d+)\b", replace, text, flags=re.IGNORECASE)


def _reference_token(reference_number: int) -> str:
    return f"[image reference {reference_number}]"


def _role_block(roles: list[CharacterSheetReferenceRole]) -> str:
    lines = ["REFERENCE ROLES:"]
    for role in roles:
        lines.append(f"{_reference_token(role.reference_number)} = {role.role_label}. {role.scope}")
    if not any(role.role_key == ROLE_BODY_SHAPE for role in roles):
        lines.append("No separate body lock was provided. Build body, outfit, world, and mood from the character creative brief.")
    if not any(role.role_key in {ROLE_CLOTHING_STYLE_WORLD, ROLE_WEAPON_PROP, ROLE_ENVIRONMENT_WORLD} for role in roles):
        lines.append("No extra clothing/style/world reference was provided. Build outfit, world, mood, accessories, and environment from the character creative brief.")
    return "\n".join(lines)


def _priority_rule(roles: list[CharacterSheetReferenceRole]) -> str:
    face_refs = [_reference_token(role.reference_number) for role in roles if role.role_key == ROLE_FACE_IDENTITY]
    body_refs = [_reference_token(role.reference_number) for role in roles if role.role_key == ROLE_BODY_SHAPE]
    extra_refs = [
        _reference_token(role.reference_number)
        for role in roles
        if role.role_key in {ROLE_CLOTHING_STYLE_WORLD, ROLE_WEAPON_PROP, ROLE_ENVIRONMENT_WORLD}
    ]
    template_refs = [_reference_token(role.reference_number) for role in roles if role.role_key == ROLE_TEMPLATE_LAYOUT]
    parts = ["Do not blend references equally."]
    if face_refs:
        parts.append(f"Face, hair, age impression, and recognizable identity always come from {', '.join(face_refs)}.")
    if body_refs:
        parts.append(f"Body proportions, silhouette, and physical presence always come from {', '.join(body_refs)}.")
    if extra_refs:
        parts.append(
            f"Scoped extras from {', '.join(extra_refs)} must not override face identity, skin tone, body shape, hair, or age impression."
        )
    if template_refs:
        parts.append(
            f"Template/layout references from {', '.join(template_refs)} control only board geometry and typography; they must not override character identity, body, outfit, props, story content, printed name, or age."
        )
    parts.append("If style conflicts with identity, preserve the face identity first.")
    return "PRIORITY RULE: " + " ".join(parts)


def _background_mode_block(background_mode: str) -> str:
    if background_mode == "clean_white_reference":
        return (
            "STYLE / BACKGROUND MODE: Clean white or light neutral production reference sheet, high readability, minimal environment, "
            "subtle gray dividers, crisp typography, and clear body/face panels. Keep the board useful for downstream character consistency."
        )
    return (
        "STYLE / BACKGROUND MODE: Premium film studio character board, dark near-black background, thin yellow neon UI accents, "
        "subtle production framing, faint film grain, cinematic color grading, clean readable typography, dense but uncluttered layout."
    )


def character_sheet_prompt_recipe_external_variables(
    roles: Iterable[CharacterSheetReferenceRole],
    *,
    background_mode: str = "cinematic_dark_ui",
) -> dict[str, str]:
    role_list = list(roles)
    if not role_list:
        raise CharacterSheetPromptError("At least one image reference role is required.")
    question = character_sheet_role_clarification_question(role_list)
    if question:
        raise CharacterSheetPromptError(question)
    return {
        "reference_role_block": _role_block(role_list),
        "reference_priority_rule": _priority_rule(role_list),
        "background_mode_block": _background_mode_block(background_mode),
    }


def character_sheet_prompt_recipe_request(message: str) -> bool:
    text = " ".join(str(message or "").lower().split())
    if "recipe" not in text and "prompt recipe" not in text:
        return False
    return any(term in text for term in ("character sheet", "chr sheet", "character reference sheet", "reference sheet"))


def character_sheet_prompt_recipe_draft() -> PromptRecipeUpsertRequest:
    template = "\n".join(
        [
            "You are Media Studio's Character Sheet v1 prompt compiler.",
            "Turn the supplied fields into one final GPT Image 2 image-to-image prompt.",
            "Return only the finished image-generation prompt. Do not include markdown fences, commentary, or analysis.",
            "",
            'CHARACTER NAME: "{{character_name}}"',
            "AGE: {{age}}",
            "VARIANT: {{variant_label}}",
            "BACKGROUND MODE: {{background_mode}}",
            "",
            "REFERENCE ROLE BLOCK - source of truth; preserve exact image-reference numbers:",
            "{{reference_role_block}}",
            "",
            "REFERENCE PRIORITY RULE:",
            "{{reference_priority_rule}}",
            "",
            "CHARACTER CREATIVE BRIEF:",
            "{{user_prompt}}",
            "",
            "BACKGROUND MODE INSTRUCTIONS:",
            "{{background_mode_block}}",
            "",
            "FINAL PROMPT REQUIREMENTS:",
            "- Include the exact reference-role block and priority rule in the final prompt.",
            "- Use the creative brief for outfit concept, damage state, story context, mood, world, pose language, and scene atmosphere.",
            "- Treat character names as labels only; visual identity must come from the mapped image references, not from name recognition.",
            "- Give most canvas space to large readable character images, especially face identity crops and full-body views.",
            *CHARACTER_SHEET_FIXED_LAYOUT_REQUIREMENTS,
            *CHARACTER_SHEET_ALLOWED_VISIBLE_TEXT,
            "- Include a hero image, identity-lock face crops, 4 large full-body views labeled FRONT, 3/4 FRONT, SIDE, and BACK, expression crops, character details, lighting/mood panels, and an optional color strip.",
            "- Metadata is limited to character name, age, and variant label only. Do not add biography, lore paragraphs, stats, specialties, height/build/alignment blocks, class/species/powers, or capability lists.",
            "- Keep story/world context inside the visual styling, outfit, pose, and panel imagery instead of long text blocks on the sheet.",
            "- Keep all labels in English and keep the result photorealistic only.",
            "- Do not invent or renumber missing image references.",
            "- If extras conflict with identity or body continuity, preserve face identity first and body shape second.",
        ]
    )
    return PromptRecipeUpsertRequest(
        key=CHARACTER_SHEET_TEMPLATE_ID,
        label=CHARACTER_SHEET_RECIPE_LABEL,
        description=(
            "Builds a GPT Image 2 character reference sheet prompt from ordered face, body, "
            "and optional extra image references."
        ),
        category="image",
        status="active",
        system_prompt_template=template,
        image_analysis_prompt="",
        user_prompt_placeholder="{{user_prompt}}",
        output_format="single_prompt",
        output_contract={"type": "text", "description": "A single GPT Image 2 character-sheet prompt."},
        image_input={
            "enabled": True,
            "required": True,
            "mode": "direct_reference",
            "analysis_variable": "image_analysis",
            "max_files": 4,
        },
        input_variables=[
            {
                "key": "user_prompt",
                "token": "{{user_prompt}}",
                "label": "User Prompt",
                "enabled": True,
                "required": True,
                "default_value": "",
                "description": "What the character should become in this sheet.",
            },
            {
                "key": "character_name",
                "token": "{{character_name}}",
                "label": "Character Name",
                "enabled": True,
                "required": False,
                "default_value": "Character",
                "description": "Name printed on the character sheet.",
            },
            {
                "key": "age",
                "token": "{{age}}",
                "label": "Age",
                "enabled": True,
                "required": False,
                "default_value": "26",
                "description": "Age printed in the info block.",
            },
            {
                "key": "variant_label",
                "token": "{{variant_label}}",
                "label": "Variant Label",
                "enabled": True,
                "required": False,
                "default_value": "Variant 1",
                "description": "Short label for this character-sheet version.",
            },
            {
                "key": "reference_role_block",
                "token": "{{reference_role_block}}",
                "label": "Reference Role Block",
                "enabled": True,
                "required": True,
                "default_value": "",
                "description": "Assistant-generated source-of-truth image-reference role mapping.",
            },
            {
                "key": "reference_priority_rule",
                "token": "{{reference_priority_rule}}",
                "label": "Reference Priority Rule",
                "enabled": True,
                "required": True,
                "default_value": "",
                "description": "Assistant-generated source-of-truth reference priority rule.",
            },
            {
                "key": "background_mode_block",
                "token": "{{background_mode_block}}",
                "label": "Background Mode Block",
                "enabled": True,
                "required": True,
                "default_value": "",
                "description": "Assistant-generated prompt instructions for the selected background mode.",
            },
        ],
        custom_fields=[
            {
                "key": "background_mode",
                "label": "Background Mode",
                "type": "select",
                "placeholder": "",
                "default_value": "cinematic_dark_ui",
                "required": False,
                "help_text": "Choose dark cinematic UI or a clean white reference sheet.",
                "options": ["cinematic_dark_ui", "clean_white_reference"],
            }
        ],
        default_options={"temperature": 0.2, "max_output_tokens": 2200},
        rules={
            "allow_external_variables": True,
            "return_only_final_output": True,
            "requires_ordered_image_refs": True,
        },
        notes=(
            "Reference role, priority, and background blocks should be generated from actual graph "
            "wire order by the Media Assistant before running."
        ),
        source_kind="custom",
        version="1",
        priority=10,
    )


def character_sheet_v3_prompt_recipe_draft() -> PromptRecipeUpsertRequest:
    template = "\n".join(
        [
            "You are Media Studio's Character Sheet v3 prompt compiler.",
            "Turn the supplied fields and ordered image references into one final GPT Image 2 image-to-image prompt.",
            "Return only the finished image-generation prompt. Do not include markdown fences, commentary, JSON, or analysis.",
            "",
            "CHARACTER NAME: {{character_name}}",
            "AGE: {{age}}",
            "USER PROMPT / CHARACTER DESCRIPTION:",
            "{{user_prompt}}",
            "",
            "REFERENCE MODE:",
            "- Use connected images strictly by wire/order as image references.",
            "- If exactly two images are connected: [image reference 1] is FACE / IDENTITY LOCK and [image reference 2] is BODY / SHAPE LOCK. Do not mention [image reference 3]. Use the user prompt for clothing, style, world, accessories, mood, environment, and atmosphere.",
            "- If three or more images are connected: [image reference 1] is FACE / IDENTITY LOCK, [image reference 2] is BODY / SHAPE LOCK, [image reference 3] is CLOTHING / STYLE / WORLD LOCK, and later references are optional prop, weapon, environment, or template cues only when visually relevant.",
            "- Never blend references equally. Face and hair always come from [image reference 1]. Body always comes from [image reference 2]. Clothing/style/world references must not override face identity, skin tone, body shape, hair, or age impression.",
            "",
            "FINAL PROMPT SHELL:",
            'Create a 4K photorealistic character reference sheet titled "{{character_name}}" using the connected image references with strict source roles.',
            "All labels in ENGLISH.",
            "",
            "REFERENCE ROLES: Write the correct two-reference or three-reference role block using the REFERENCE MODE rules above.",
            "PRIORITY RULE: Do not blend references equally. Preserve face identity first, body shape second, and scoped style/world/prop cues after that.",
            "",
            "STYLE: Premium film studio character board, dark near-black background, thin yellow neon UI accents, subtle production framing, faint film grain, cinematic color grading, clean readable typography, dense but uncluttered layout. Photorealistic only, no illustration.",
            "",
            "LAYOUT PRIORITY: Give most canvas space to large readable character images, not clothing flat-lays, style/mood portraits, or metadata. The hero image and PANEL 02 full-body views must dominate the board; face identity crops are next priority. Keep clothing details and style/mood panels small and supportive.",
            "FULL-BODY PROPORTION PRIORITY: The hero image and every PANEL 02 view must show the character at natural height with correct body proportions. Do not squash, compress, shorten, stretch, or crop the body to fit a panel. If space is tight, reduce PANEL 05 style/mood panel size before reducing the hero or full-body views.",
            "FULL-BODY SPACE ALLOCATION: Reserve the largest continuous inspection area for PANEL 02. It should read as the main technical body reference section, not a secondary strip. Make the four full-body views taller and wider than expression, detail, lighting, and style/mood panels. Reclaim space from PANEL 05 first, then from nonessential detail spacing, never from PANEL 02.",
            "FIXED 16:9 BOARD GEOMETRY:",
            *CHARACTER_SHEET_FIXED_LAYOUT_REQUIREMENTS,
            "",
            "MAIN HERO IMAGE: One large hero portrait, 3/4 body, or full-body feature image using the exact face/hair from the face lock, body shape from the body lock, and clothing/world from the scoped style source or user prompt. Prefer a readable 3/4 or full-body crop with natural height and no squeezed proportions. The hero must clearly look like the same person from the face lock.",
            'INFO BLOCK: Include only NAME - {{character_name}} and AGE - {{age}}. No biography, no extra metadata.',
            "",
            "PANEL 01 - IDENTITY LOCK: 4 large face crops labeled NEUTRAL FRONT, 3/4 FACE, SIDE FACE, CLOSE EYES. Preserve the face, hairline, eyes, brows, nose, lips, skin tone, freckles/marks, and age impression from the face lock.",
            "PANEL 02 - FULL BODY VIEWS: 4 dominant extra-large full-body neutral views labeled FRONT, 3/4 FRONT, SIDE, BACK. Use face from the face lock, body from the body lock, and outfit/world from the scoped style source or user prompt. These are the main inspection panels on the sheet: keep each body tall, upright, fully readable from head to feet, and large enough to judge height, proportions, silhouette, stance, and outfit. Panel 02 must visibly occupy more room than Panel 05.",
            "PANEL 03 - EXPRESSIONS: 4 tight headshots labeled CALM, LAUGHING, INTENSE, CONFIDENT. Only expression changes. Face structure, hair, and age impression remain consistent with the face lock.",
            "PANEL 04 - CHARACTER DETAILS: 3 medium detail panels labeled FACE / SKIN TEXTURE, HAND / WRIST, OUTFIT MATERIAL. Face detail must match the face lock. Hand/wrist follows body scale from the body lock. Outfit material shows fabric, texture, seams, weathering, armor, jewelry, glowing accents, or distinctive design details from the style source or user prompt.",
            "PANEL 05 - STYLE / MOOD: 2 small thumbnail-scale supporting same-pose portraits labeled NATURAL LIGHT, DRAMATIC RIM LIGHT. Treat this as a compact lighting note or narrow support strip, not a major panel. It must be much smaller than the full-body views and must not steal canvas space from the hero or PANEL 02. Only lighting changes. Do not change face, hair, body, outfit, or identity.",
            "",
            "COLOR STRIP: Add a small 5-color palette with HEX codes only if there is room. Do not reduce face or full-body panel size for it.",
            "",
            "VISIBLE TEXT CONTRACT:",
            *CHARACTER_SHEET_ALLOWED_VISIBLE_TEXT,
            "",
            "QUALITY TARGET: Strong face consistency, large readable face panels, large readable full-body panels, consistent body proportions, consistent outfit fidelity, clean English labels, cinematic realism, fine grain, production-grade reference board.",
        ]
    )
    return PromptRecipeUpsertRequest(
        key=CHARACTER_SHEET_V3_TEMPLATE_ID,
        label=CHARACTER_SHEET_V3_RECIPE_LABEL,
        description=(
            "Golden-prompt character reference sheet compiler for GPT Image 2. Supports ordered face/body refs "
            "and an optional third clothing/style/world ref while keeping the same dark cinematic board layout."
        ),
        category="image",
        status="active",
        system_prompt_template=template,
        image_analysis_prompt="",
        user_prompt_placeholder="{{user_prompt}}",
        output_format="single_prompt",
        output_contract={"type": "text", "description": "A single GPT Image 2 character-sheet prompt."},
        image_input={
            "enabled": True,
            "required": True,
            "mode": "direct_reference",
            "analysis_variable": "image_analysis",
            "max_files": 4,
        },
        input_variables=[
            {
                "key": "user_prompt",
                "token": "{{user_prompt}}",
                "label": "User Prompt",
                "enabled": True,
                "required": True,
                "default_value": "",
                "description": "Compact creative brief for the character's outfit, style, world, action, and mood.",
            },
            {
                "key": "character_name",
                "token": "{{character_name}}",
                "label": "Character Name",
                "enabled": True,
                "required": False,
                "default_value": "Character",
                "description": "Name printed on the character sheet.",
            },
            {
                "key": "age",
                "token": "{{age}}",
                "label": "Age",
                "enabled": True,
                "required": False,
                "default_value": "26",
                "description": "Age printed in the info block.",
            },
        ],
        custom_fields=[],
        default_options={"temperature": 0.18, "max_output_tokens": 2400},
        rules={
            "return_only_final_output": True,
            "requires_ordered_image_refs": True,
            "supports_optional_style_world_ref": True,
            "preferred_model_family": "gpt_image_2",
        },
        notes=(
            "Character Sheet v3 is based on the paid golden Prompt Text smoke. Use two ordered refs for face/body, "
            "or add a third scoped style/world reference when available."
        ),
        source_kind="custom",
        version="3",
        priority=8,
    )


def compile_character_sheet_prompt(
    roles: Iterable[CharacterSheetReferenceRole],
    *,
    user_prompt: str,
    character_name: str = "Character",
    age: str = "26",
    background_mode: str = "cinematic_dark_ui",
    variant_label: str = "Variant 1",
) -> str:
    role_list = list(roles)
    if not role_list:
        raise CharacterSheetPromptError("At least one image reference role is required.")
    question = character_sheet_role_clarification_question(role_list)
    if question:
        raise CharacterSheetPromptError(question)

    max_reference_number = max(role.reference_number for role in role_list)
    creative_brief = _sanitize_stale_reference_mentions(
        normalize_character_sheet_creative_brief(user_prompt),
        max_reference_number,
    )
    title = str(character_name or "Character").strip() or "Character"
    age_value = str(age or "").strip() or "unknown"
    variant = str(variant_label or "Variant 1").strip() or "Variant 1"
    lines = [
        f'Create a 4K photorealistic character reference sheet titled "{title}" using {max_reference_number} image reference{"s" if max_reference_number != 1 else ""} with strict source roles.',
        "All labels in ENGLISH.",
        f"Variant: {variant}.",
        "",
        _role_block(role_list),
        "",
        _priority_rule(role_list),
        "",
        "CHARACTER CREATIVE BRIEF:",
        creative_brief,
        "",
        "Use the creative brief for outfit concept, damage state, story context, mood, world, pose language, and scene atmosphere while obeying the reference role priority rules.",
        "Character names are labels only; visual identity must come from the mapped image references, not from name recognition.",
        "",
        _background_mode_block(background_mode),
        "Photorealistic only, no illustration.",
        "",
        "LAYOUT PRIORITY: Give most canvas space to large readable character images, not clothing flat-lays or metadata. Focus on hero image, full-body views, and face identity crops. Keep clothing details small and supportive.",
        "FIXED BOARD GEOMETRY:",
        *CHARACTER_SHEET_FIXED_LAYOUT_REQUIREMENTS,
        "",
        "VISIBLE TEXT CONTRACT:",
        *CHARACTER_SHEET_ALLOWED_VISIBLE_TEXT,
        "",
        "MAIN HERO IMAGE: One large hero portrait, 3/4 body, or full-body feature image. It must clearly look like the mapped face identity and preserve the mapped body role when provided.",
        f"INFO BLOCK: Include only NAME - {title} and AGE - {age_value}. No biography, lore paragraphs, stats, specialties, height/build/alignment blocks, class/species/powers, capability lists, or extra metadata.",
        "PANEL 01 - IDENTITY LOCK: 4 large face crops labeled NEUTRAL FRONT, 3/4 FACE, SIDE FACE, CLOSE EYES. Preserve mapped identity details exactly.",
        "PANEL 02 - FULL BODY VIEWS: 4 large full-body neutral views labeled FRONT, 3/4 FRONT, SIDE, BACK. Use mapped body proportions when provided and keep the panels large enough to judge shape and outfit.",
        "PANEL 03 - EXPRESSIONS: 4 tight headshots labeled CALM, LAUGHING, INTENSE, CONFIDENT. Only expression changes; face structure, hair, and age impression remain consistent.",
        "PANEL 04 - CHARACTER DETAILS: 3 medium detail panels labeled FACE / SKIN TEXTURE, HAND / WRIST, OUTFIT MATERIAL. Keep face details tied to the face role and hand/wrist scale tied to the body role when provided.",
        "PANEL 05 - STYLE / MOOD: 2 same-pose portraits labeled NATURAL LIGHT, DRAMATIC RIM LIGHT. Only lighting changes; do not change face, hair, body, outfit, or identity.",
        "COLOR STRIP: Add a small 5-color palette with HEX codes only if there is room. Do not reduce face or full-body panel size for it.",
        "",
        "QUALITY TARGET: Strong face consistency, large readable face panels, large readable full-body panels, consistent body proportions, consistent outfit fidelity, clean English labels, cinematic realism, fine grain, production-grade reference board.",
    ]
    return "\n".join(lines).strip()


def character_sheet_graph_plan_from_roles(
    roles: Iterable[CharacterSheetReferenceRole],
    *,
    user_prompt: str,
    character_name: str = "Character",
    age: str = "26",
    background_mode: str = "cinematic_dark_ui",
    variant_label: str = "Variant 1",
) -> AssistantGraphPlan:
    role_list = list(roles)
    question = character_sheet_role_clarification_question(role_list)
    if question:
        return AssistantGraphPlan(
            summary="I need one role confirmation before I build the Character Sheet graph.",
            questions=[question],
            operations=[],
            requires_confirmation=False,
            metadata={"template_id": CHARACTER_SHEET_TEMPLATE_ID, "blocked_reason": "ambiguous_reference_role"},
        )

    prompt = compile_character_sheet_prompt(
        role_list,
        user_prompt=user_prompt,
        character_name=character_name,
        age=age,
        background_mode=background_mode,
        variant_label=variant_label,
    )
    variant_key = re.sub(r"[^a-z0-9]+", "-", variant_label.lower()).strip("-") or "variant-1"
    prompt_ref = f"character-sheet-{variant_key}-prompt"
    model_ref = f"character-sheet-{variant_key}-model"
    preview_ref = f"character-sheet-{variant_key}-preview"
    save_ref = f"character-sheet-{variant_key}-save"
    note_ref = f"character-sheet-{variant_key}-note"
    operations: list[AssistantGraphOperation] = [
        AssistantGraphOperation(
            op="add_note",
            node_ref=note_ref,
            title=f"Character Sheet Notes - {variant_label}",
            position={"x": CHARACTER_SHEET_LAYOUT_NOTE_X, "y": -220.0},
            body=(
                f"Character Sheet {variant_label}.\n"
                "References are connected in the exact image-reference order used by the prompt.\n"
                f"Background mode: {background_mode}."
            ),
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref=prompt_ref,
            node_type="prompt.text",
            title=f"Character Sheet Prompt - {variant_label}",
            position={"x": CHARACTER_SHEET_LAYOUT_PROMPT_X, "y": 160.0},
            fields={"mode": "replace", "text": prompt},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref=model_ref,
            node_type="model.kie.gpt_image_2_image_to_image",
            title=f"Character Sheet GPT Image 2 - {variant_label}",
            position={"x": CHARACTER_SHEET_LAYOUT_MODEL_X, "y": 120.0},
            fields={"aspect_ratio": "16:9", "resolution": "2K"},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref=preview_ref,
            node_type="preview.image",
            title=f"Character Sheet Preview - {variant_label}",
            position={"x": CHARACTER_SHEET_LAYOUT_OUTPUT_X, "y": 40.0},
            fields={},
        ),
        AssistantGraphOperation(
            op="add_node",
            node_ref=save_ref,
            node_type="media.save_image",
            title=f"Save Character Sheet - {variant_label}",
            position={"x": CHARACTER_SHEET_LAYOUT_OUTPUT_X, "y": 660.0},
            fields={"label": f"Character Sheet {variant_label}"},
        ),
    ]
    for role in sorted(role_list, key=lambda item: item.reference_number):
        operations.append(
            AssistantGraphOperation(
                op="connect_nodes",
                node_id=role.source_node_id,
                source_port=role.source_port or "image",
                target_ref=model_ref,
                target_port=role.target_port,
            )
        )
    operations.extend(
        [
            AssistantGraphOperation(op="connect_nodes", source_ref=prompt_ref, source_port="text", target_ref=model_ref, target_port="prompt"),
            AssistantGraphOperation(op="connect_nodes", source_ref=model_ref, source_port="image", target_ref=preview_ref, target_port="image"),
            AssistantGraphOperation(op="connect_nodes", source_ref=model_ref, source_port="image", target_ref=save_ref, target_port="image"),
            AssistantGraphOperation(
                op="group_nodes",
                group_ref=f"character-sheet-{variant_key}",
                title=f"Character Sheet {variant_label}",
                color="purple",
                node_refs=[note_ref, prompt_ref, model_ref, preview_ref, save_ref],
            ),
        ]
    )
    reference_summary = [f"ref {role.reference_number}: {role.role_label.lower()}" for role in role_list]
    return AssistantGraphPlan(
        summary=(
            f"I made Character Sheet {variant_label} with GPT Image 2 image-to-image. "
            f"Reference mapping: {', '.join(reference_summary)}."
        ),
        operations=operations,
        warnings=[],
        requires_confirmation=False,
        metadata={
            "template_id": CHARACTER_SHEET_TEMPLATE_ID,
            "background_mode": background_mode,
            "variant_label": variant_label,
            "reference_roles": [
                {
                    "reference_number": role.reference_number,
                    "source_node_id": role.source_node_id,
                    "role_key": role.role_key,
                    "role_label": role.role_label,
                    "confidence": role.confidence,
                }
                for role in role_list
            ],
        },
    )


def _saved_prompt_recipe_id(key: str) -> str:
    try:
        recipe = store.get_prompt_recipe_by_key(key)
    except Exception:
        recipe = None
    if recipe and str(recipe.get("status") or "active") == "active":
        recipe_id = str(recipe.get("recipe_id") or "").strip()
        if recipe_id:
            return recipe_id
    return key


def _wants_character_sheet_v3(message: str) -> bool:
    normalized = str(message or "").lower()
    return bool(
        "character sheet v3" in normalized
        or "charsheet v3" in normalized
        or "v3 character sheet" in normalized
        or "updated v3" in normalized
    )


def _wants_placeholder_character_sheet_refs(message: str) -> bool:
    normalized = str(message or "").lower()
    if not any(term in normalized for term in ("placeholder", "load image", "load images", "image refs", "image references")):
        return False
    return any(term in normalized for term in ("face", "identity")) and any(term in normalized for term in ("body", "shape"))


def _wants_attached_character_sheet_refs(message: str) -> bool:
    normalized = str(message or "").lower()
    if not any(
        term in normalized
        for term in (
            "attached reference",
            "attached references",
            "attached image",
            "attached images",
            "using the two attached",
            "use these references",
            "use these refs",
            "use these images",
        )
    ):
        return False
    return any(term in normalized for term in ("face", "identity")) and any(term in normalized for term in ("body", "shape"))


def _character_sheet_attachment_reference_ids(attachments: Iterable[dict[str, Any]] | None) -> list[str]:
    reference_ids: list[str] = []
    for attachment in attachments or []:
        if not isinstance(attachment, dict):
            continue
        reference_id = str(attachment.get("reference_id") or "").strip()
        if not reference_id:
            continue
        kind = str(attachment.get("kind") or "").lower().strip()
        if kind and kind != "image":
            continue
        reference_ids.append(reference_id)
    return reference_ids


def _character_sheet_request_character_name(message: str) -> str:
    text = str(message or "")
    explicit = re.search(r"\b(?:character name|name)\s*[:=]\s*([A-Za-z][A-Za-z0-9 _'-]{0,32})", text, re.IGNORECASE)
    if explicit:
        value = re.split(r"[.,;\n]", explicit.group(1), maxsplit=1)[0].strip()
        if value:
            return value
    for candidate in ("Sadi", "Sadie", "Steve"):
        if re.search(rf"\b{re.escape(candidate)}\b", text, re.IGNORECASE):
            return "Sadi" if candidate.lower() in {"sadi", "sadie"} else candidate
    return "Character"


def _placeholder_character_sheet_roles() -> list[CharacterSheetReferenceRole]:
    return [
        CharacterSheetReferenceRole(
            reference_number=1,
            source_node_id="assistant-character-sheet-face-ref",
            source_port="image",
            target_node_id="",
            target_port="image_refs",
            role_key=ROLE_FACE_IDENTITY,
            role_label=ROLE_LABELS[ROLE_FACE_IDENTITY],
            scope=ROLE_SCOPES[ROLE_FACE_IDENTITY],
            confidence="high",
            needs_clarification=False,
            evidence=("placeholder:face_identity",),
        ),
        CharacterSheetReferenceRole(
            reference_number=2,
            source_node_id="assistant-character-sheet-body-ref",
            source_port="image",
            target_node_id="",
            target_port="image_refs",
            role_key=ROLE_BODY_SHAPE,
            role_label=ROLE_LABELS[ROLE_BODY_SHAPE],
            scope=ROLE_SCOPES[ROLE_BODY_SHAPE],
            confidence="high",
            needs_clarification=False,
            evidence=("placeholder:body_shape",),
        ),
    ]


def character_sheet_v3_graph_plan_from_roles(
    roles: Iterable[CharacterSheetReferenceRole],
    *,
    user_prompt: str,
    character_name: str = "Character",
    age: str = "26",
    variant_label: str = "Variant 1",
    include_placeholder_refs: bool = False,
    placeholder_reference_ids: dict[int, str] | None = None,
) -> AssistantGraphPlan:
    role_list = list(roles)
    question = character_sheet_role_clarification_question(role_list)
    if question:
        return AssistantGraphPlan(
            summary="I need one role confirmation before I build the Character Sheet graph.",
            questions=[question],
            operations=[],
            requires_confirmation=False,
            metadata={"template_id": CHARACTER_SHEET_V3_TEMPLATE_ID, "blocked_reason": "ambiguous_reference_role"},
        )

    variant_key = re.sub(r"[^a-z0-9]+", "-", variant_label.lower()).strip("-") or "variant-1"
    recipe_ref = f"character-sheet-v3-{variant_key}-recipe"
    model_ref = f"character-sheet-v3-{variant_key}-model"
    preview_ref = f"character-sheet-v3-{variant_key}-preview"
    save_ref = f"character-sheet-v3-{variant_key}-save"
    note_ref = f"character-sheet-v3-{variant_key}-note"
    operations: list[AssistantGraphOperation] = [
        AssistantGraphOperation(
            op="add_note",
            node_ref=note_ref,
            title=f"Character Sheet v3 Notes - {variant_label}",
            position={"x": CHARACTER_SHEET_LAYOUT_NOTE_X, "y": -220.0},
            body=(
                f"Character Sheet v3 {variant_label}.\n"
                "References are connected in exact image-reference order.\n"
                "Panel 02 full-body views should dominate; Panel 05 style/mood is compact support."
            ),
        )
    ]
    if include_placeholder_refs:
        operations.extend(
            [
                AssistantGraphOperation(
                    op="add_node",
                    node_ref="character-sheet-face-ref",
                    node_type="media.load_image",
                    title="Sadi Face / Identity Ref",
                    position={"x": CHARACTER_SHEET_REF_LOAD_X, "y": CHARACTER_SHEET_REF_FACE_Y},
                    fields=(
                        {"reference_id": placeholder_reference_ids[1]}
                        if placeholder_reference_ids and placeholder_reference_ids.get(1)
                        else {}
                    ),
                ),
                AssistantGraphOperation(
                    op="add_node",
                    node_ref="character-sheet-body-ref",
                    node_type="media.load_image",
                    title="Sadi Body / Shape Ref",
                    position={"x": CHARACTER_SHEET_REF_LOAD_X, "y": CHARACTER_SHEET_REF_BODY_Y},
                    fields=(
                        {"reference_id": placeholder_reference_ids[2]}
                        if placeholder_reference_ids and placeholder_reference_ids.get(2)
                        else {}
                    ),
                ),
            ]
        )
    operations.extend(
        [
            AssistantGraphOperation(
                op="add_node",
                node_ref=recipe_ref,
                node_type="prompt.recipe",
                title=f"Character Sheet v3 Recipe - {variant_label}",
                position={"x": CHARACTER_SHEET_LAYOUT_PROMPT_X, "y": 160.0},
                fields={
                    "recipe_id": _saved_prompt_recipe_id(CHARACTER_SHEET_V3_TEMPLATE_ID),
                    "recipe_category": "image",
                    "user_prompt": normalize_character_sheet_creative_brief(user_prompt),
                    "character_name": character_name,
                    "age": age,
                    "provider": "openrouter",
                    "model_id": "openai/gpt-4o-mini",
                    "provider_supports_images": True,
                },
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref=model_ref,
                node_type="model.kie.gpt_image_2_image_to_image",
                title=f"Character Sheet v3 GPT Image 2 - {variant_label}",
                position={"x": CHARACTER_SHEET_LAYOUT_MODEL_X, "y": 120.0},
                fields={"aspect_ratio": "16:9", "resolution": "2K"},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref=preview_ref,
                node_type="preview.image",
                title=f"Character Sheet v3 Preview - {variant_label}",
                position={"x": CHARACTER_SHEET_LAYOUT_OUTPUT_X, "y": 40.0},
                fields={},
            ),
            AssistantGraphOperation(
                op="add_node",
                node_ref=save_ref,
                node_type="media.save_image",
                title=f"Save Character Sheet v3 - {variant_label}",
                position={"x": CHARACTER_SHEET_LAYOUT_OUTPUT_X, "y": 660.0},
                fields={"label": f"Character Sheet v3 {variant_label}"},
            ),
        ]
    )
    for role in sorted(role_list, key=lambda item: item.reference_number):
        source_ref = None
        if include_placeholder_refs and role.reference_number == 1:
            source_ref = "character-sheet-face-ref"
        elif include_placeholder_refs and role.reference_number == 2:
            source_ref = "character-sheet-body-ref"
        operations.extend(
            [
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=source_ref,
                    node_id=None if source_ref else role.source_node_id,
                    source_port=role.source_port or "image",
                    target_ref=recipe_ref,
                    target_port=role.target_port,
                ),
                AssistantGraphOperation(
                    op="connect_nodes",
                    source_ref=source_ref,
                    node_id=None if source_ref else role.source_node_id,
                    source_port=role.source_port or "image",
                    target_ref=model_ref,
                    target_port=role.target_port,
                ),
            ]
        )
    operations.extend(
        [
            AssistantGraphOperation(op="connect_nodes", source_ref=recipe_ref, source_port="text", target_ref=model_ref, target_port="prompt"),
            AssistantGraphOperation(op="connect_nodes", source_ref=model_ref, source_port="image", target_ref=preview_ref, target_port="image"),
            AssistantGraphOperation(op="connect_nodes", source_ref=model_ref, source_port="image", target_ref=save_ref, target_port="image"),
            AssistantGraphOperation(
                op="group_nodes",
                group_ref=f"character-sheet-v3-{variant_key}",
                title=f"Character Sheet v3 {variant_label}",
                color="purple",
                node_refs=(
                    ["character-sheet-face-ref", "character-sheet-body-ref"] if include_placeholder_refs else []
                )
                + [note_ref, recipe_ref, model_ref, preview_ref, save_ref],
            ),
        ]
    )
    reference_summary = [f"ref {role.reference_number}: {role.role_label.lower()}" for role in role_list]
    return AssistantGraphPlan(
        summary=(
            f"I made Character Sheet v3 {variant_label} with GPT Image 2 image-to-image. "
            f"Reference mapping: {', '.join(reference_summary)}."
        ),
        operations=operations,
        warnings=[],
        requires_confirmation=False,
        metadata={
            "template_id": CHARACTER_SHEET_V3_TEMPLATE_ID,
            "variant_label": variant_label,
            "variant_count": 1,
            "variant_labels": [variant_label],
            "uses_placeholder_refs": include_placeholder_refs,
            "reference_roles": [
                {
                    "reference_number": role.reference_number,
                    "source_node_id": role.source_node_id,
                    "role_key": role.role_key,
                    "role_label": role.role_label,
                    "confidence": role.confidence,
                }
                for role in role_list
            ],
        },
    )


def is_character_sheet_graph_request(message: str) -> bool:
    text = " ".join(str(message or "").lower().split())
    if any(term in text for term in ("storyboard", "story board", "story board", "stills graph", "storyboard still")):
        return False
    if not any(term in text for term in ("character sheet", "chr sheet", "character reference sheet", "reference sheet")):
        return False
    return any(
        term in text
        for term in (
            "graph",
            "workflow",
            "branch",
            "node",
            "add",
            "create",
            "build",
            "make",
            "variant",
            "version",
        )
    )


def _character_sheet_request_background_mode(message: str) -> str:
    text = " ".join(str(message or "").lower().split())
    if any(term in text for term in ("clean white", "white background", "white reference", "neutral reference")):
        return "clean_white_reference"
    return "cinematic_dark_ui"


DEFAULT_CHARACTER_SHEET_BRIEF = "Create a clear, production-ready character-sheet design from the available references."

COUNT_WORDS = {
    "one": 1,
    "two": 2,
    "couple": 2,
    "three": 3,
}


def _character_sheet_request_brief_value(message: str) -> str:
    brief = " ".join(str(message or "").split()).strip()
    brief = re.sub(r"\b(?:do not|don't|dont)\s+(?:run|save|submit|upload|delete|import|export)[^.?!]*[.?!]?", " ", brief, flags=re.IGNORECASE)
    brief = re.sub(
        r"\buse\s+(?:the\s+)?(?:first|1st|second|2nd|image reference\s+[12]|ref\s+[12]|top|upper|bottom|lower)\b[^.?!]*\b(?:face|identity|body|shape|lock)\b[^.?!]*[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\buse\s+(?:the\s+)?attached\s+reference\s+image\s+[12]\b[^.?!]*\b(?:face|identity|body|shape|lock)\b[^.?!]*[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\b(?:create|build|add|make)\s+(?:(?:a|an|one|new|local|unsaved|reviewable|another|the)\s+){0,4}"
        r"(?:character|chr)\s+sheet\s+(?:v\d+\s+)?(?:graph|workflow|branch|variant|version|nodes?)?\b",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\b(?:can\s+you\s+)?(?:create|build|add|make)\s+"
        r"(?:(?:a|an|one|new|local|unsaved|reviewable|another|the|clean|white|cinematic|dark)\s+){0,8}"
        r"(?:character|chr)\s+sheet(?:\s+v\d+)?(?:\s+(?:graph|workflow|branch|variant|version|nodes?))?[^.?!]*[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\bcreate\s+it\s+here\s+as\s+(?:(?:a|an|the|local|unsaved)\s+){0,4}"
        r"(?:graph|workflow|branch|variant|version)[^.?!]*[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\bplease\s+(?:build|create|add|make)\s+(?:the\s+)?(?:clean\s+white\s+|cinematic\s+|dark\s+)?"
        r"(?:branch|variant|version|graph|workflow)\s+now\b[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\b(?:create|build|add|make|try)\s+"
        r"(?:(?:one|two|three|couple|[123])\s+)?(?:more\s+)?(?:(?:clean|white|cinematic|dark|local|unsaved|character|chr|sheet)\s+){0,8}"
        r"(?:variations?|variants?|versions?|branches?)\b[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\b(?:duplicate|copy|revise|update|adjust|change|make|turn)\s+(?:this|the|selected|current)\s+"
        r"(?:branch|variant|version)\s*(?:and|to|into)?\s*",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\b(?:there\s+is\s+)?no\s+(?:third|3rd)\s+(?:style\s+)?image[^.?!]*\bfrom\s+my\s+text\s+brief[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(
        r"\bbuild\s+(?:the\s+)?(?:outfit|world|outfit\s+and\s+world|world\s+and\s+outfit)[^.?!]*\b(?:text\s+)?(?:prompt|brief)[.?!]?",
        " ",
        brief,
        flags=re.IGNORECASE,
    )
    brief = re.sub(r"\buse\s+(?:(?:the|these|same|current)\s+){0,3}(?:face|body|image|reference|refs|references|graph|canvas)[^.?!]*[.?!]?", " ", brief, flags=re.IGNORECASE)
    brief = re.sub(r"\busing\s+(?:the\s+)?(?:one|two|three|[123])?\s*attached\s+(?:reference\s+)?images?[^.?!]*[.?!]?", " ", brief, flags=re.IGNORECASE)
    brief = re.sub(r"\b(?:from|with)\s+(?:(?:these|the|same|current)\s+){0,3}(?:face|body|image|reference|refs|references)[^.?!]*[.?!]?", " ", brief, flags=re.IGNORECASE)
    brief = re.sub(r"\b(?:local|unsaved|reviewable)\b", " ", brief, flags=re.IGNORECASE)
    brief = re.sub(r"\bcan you\b", " ", brief, flags=re.IGNORECASE)
    brief = re.sub(r"\bcreative\s+brief\s*:\s*", " ", brief, flags=re.IGNORECASE)
    brief = re.sub(r"\bplease\s+branch\s+now\s+so\s+i\s+can\s+inspect\s+it\b", " ", brief, flags=re.IGNORECASE)
    brief = " ".join(brief.split()).strip(" .:;-")
    return brief


def _character_sheet_request_brief(message: str) -> str:
    return _character_sheet_request_brief_value(message) or DEFAULT_CHARACTER_SHEET_BRIEF


def _character_sheet_context_brief(context_message: str | None) -> str:
    for part in reversed(re.split(r"\n{2,}", str(context_message or "").strip())):
        candidate = _character_sheet_request_brief_value(part)
        if candidate:
            return candidate
    return ""


def _is_character_sheet_brief_modifier(brief: str) -> bool:
    lowered = " ".join(str(brief or "").lower().split())
    if not lowered or lowered.startswith(("this time", "make the outfit", "make sadi", "i want", "turn her into")):
        return False
    words = lowered.split()
    if len(words) <= 7:
        return True
    return lowered.startswith(
        (
            "go ",
            "make it ",
            "make her more ",
            "make him more ",
            "make them more ",
            "switch ",
            "try ",
            "add more ",
            "with more ",
        )
    )


def _character_sheet_request_brief_from_context(message: str, context_message: str | None = None) -> str:
    current = _character_sheet_request_brief_value(message)
    context = _character_sheet_context_brief(context_message)
    if current and context and _is_character_sheet_brief_modifier(current):
        return f"{context} {current}"
    if current:
        return current
    if context:
        return context
    return DEFAULT_CHARACTER_SHEET_BRIEF


def _next_character_sheet_variant_label(workflow: GraphWorkflow, background_mode: str) -> str:
    values: list[str] = []
    for node in workflow.nodes:
        values.append(_workflow_node_title(node))
    groups = workflow.metadata.get("groups") if isinstance(workflow.metadata, dict) else []
    for group in groups if isinstance(groups, list) else []:
        if isinstance(group, dict):
            values.append(str(group.get("title") or ""))
    if background_mode == "clean_white_reference":
        numbers: list[int] = []
        for value in values:
            for match in re.finditer(r"\bclean\s+white\s+(\d+)\b", value, flags=re.IGNORECASE):
                numbers.append(int(match.group(1)))
        return f"Clean White {max(numbers, default=0) + 1}"
    numbers: list[int] = []
    for value in values:
        for match in re.finditer(r"\bvariant\s+(\d+)\b", value, flags=re.IGNORECASE):
            numbers.append(int(match.group(1)))
    return f"Variant {max(numbers, default=0) + 1}"


def _character_sheet_request_variant_count(message: str) -> int:
    text = " ".join(str(message or "").lower().split())
    if not text:
        return 1
    if re.search(r"\ba\s+couple\s+(?:more\s+)?(?:variations?|variants?|versions?|branches?)\b", text):
        return 2
    match = re.search(
        r"\b(?P<count>one|two|three|couple|[123])\s+(?:more\s+)?(?:(?:clean|white|cinematic|dark|local|unsaved|character|chr|sheet)\s+){0,8}"
        r"(?:variations?|variants?|versions?|branches?)\b",
        text,
    )
    if not match:
        return 1
    raw_count = match.group("count")
    count = int(raw_count) if raw_count.isdigit() else COUNT_WORDS.get(raw_count, 1)
    return max(1, min(count, CHARACTER_SHEET_MAX_VARIANTS_PER_REQUEST))


def _character_sheet_variant_labels(workflow: GraphWorkflow, background_mode: str, count: int) -> list[str]:
    first_label = _next_character_sheet_variant_label(workflow, background_mode)
    match = re.search(r"^(?P<prefix>.*?)(?P<number>\d+)$", first_label)
    if not match:
        return [first_label]
    prefix = match.group("prefix")
    start = int(match.group("number"))
    return [f"{prefix}{number}" for number in range(start, start + count)]


def _with_shifted_positions(plan: AssistantGraphPlan, offset_x: float) -> AssistantGraphPlan:
    if not offset_x:
        return plan
    operations: list[AssistantGraphOperation] = []
    for operation in plan.operations:
        position = dict(operation.position)
        if position:
            position["x"] = float(position.get("x", 0)) + offset_x
        operations.append(operation.model_copy(update={"position": position}))
    return plan.model_copy(update={"operations": operations})


def _character_sheet_multi_variant_brief(base_brief: str, index: int, count: int) -> str:
    if count <= 1:
        return base_brief
    return (
        f"{base_brief} Variant exploration {index + 1}: make this version visually distinct from the other requested variants "
        "through costume accents, pose energy, materials, and mood while preserving the same face/body reference locks."
    )


def _target_ids_with_character_sheet_edges(workflow: GraphWorkflow) -> list[str]:
    nodes_by_id = {node.id: node for node in workflow.nodes}
    target_ids: list[str] = []
    for edge in workflow.edges:
        if edge.target_port not in IMAGE_REFERENCE_TARGET_PORTS or edge.target in target_ids:
            continue
        target = nodes_by_id.get(edge.target)
        if not target:
            continue
        title = _workflow_node_title(target).lower()
        if "character sheet" in title or target.type == "model.kie.gpt_image_2_image_to_image":
            target_ids.append(edge.target)
    target_ids.sort(key=lambda item: ("character sheet" not in _workflow_node_title(nodes_by_id[item]).lower(), item))
    return target_ids


def _target_components(workflow: GraphWorkflow, target_ids: list[str]) -> list[set[str]]:
    target_set = set(target_ids)
    parent = {target_id: target_id for target_id in target_ids}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    def union(first: str, second: str) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    for edge in workflow.edges:
        if edge.source in target_set and edge.target in target_set:
            union(edge.source, edge.target)

    components: dict[str, set[str]] = {}
    for target_id in target_ids:
        components.setdefault(find(target_id), set()).add(target_id)
    return list(components.values())


def _preferred_target_id(workflow: GraphWorkflow, target_ids: Iterable[str]) -> str:
    nodes_by_id = {node.id: node for node in workflow.nodes}
    ordered = list(target_ids)
    for target_id in ordered:
        node = nodes_by_id.get(target_id)
        if node and node.type.startswith("model."):
            return target_id
    return ordered[0]


def _canonical_branch_target_id(workflow: GraphWorkflow, target_ids: list[str]) -> tuple[str | None, bool]:
    if not target_ids:
        return None, False
    components = _target_components(workflow, target_ids)
    if len(components) == 1:
        ordered_component = [target_id for target_id in target_ids if target_id in components[0]]
        return _preferred_target_id(workflow, ordered_component), False
    return None, True


def _workflow_groups(workflow: GraphWorkflow) -> list[dict[str, Any]]:
    groups = workflow.metadata.get("groups") if isinstance(workflow.metadata, dict) else []
    return [dict(group) for group in groups if isinstance(group, dict)] if isinstance(groups, list) else []


def _group_node_ids(group: dict[str, Any]) -> set[str]:
    node_ids = group.get("node_ids")
    return {str(node_id) for node_id in node_ids if str(node_id).strip()} if isinstance(node_ids, list) else set()


def _selected_ids_from_context(canvas_context: dict[str, Any] | None, key: str) -> set[str]:
    context = compact_canvas_context(canvas_context)
    if not context:
        return set()
    selected = context.get(key)
    return {str(item) for item in selected if str(item).strip()} if isinstance(selected, list) else set()


def _selected_group_candidates(workflow: GraphWorkflow, canvas_context: dict[str, Any] | None) -> list[dict[str, Any]]:
    selected_node_ids = _selected_ids_from_context(canvas_context, "selected_node_ids")
    selected_group_ids = _selected_ids_from_context(canvas_context, "selected_group_ids")
    candidates: list[dict[str, Any]] = []
    for group in _workflow_groups(workflow):
        group_id = str(group.get("id") or "")
        node_ids = _group_node_ids(group)
        if (group_id and group_id in selected_group_ids) or selected_node_ids.intersection(node_ids):
            candidates.append(group)
    return candidates


def _target_ids_connected_to_selected_nodes(
    workflow: GraphWorkflow,
    selected_node_ids: set[str],
    target_ids: list[str],
) -> list[str]:
    target_set = set(target_ids)
    candidates: list[str] = []
    for selected_node_id in selected_node_ids:
        if selected_node_id in target_set and selected_node_id not in candidates:
            candidates.append(selected_node_id)
    for edge in workflow.edges:
        if edge.source in selected_node_ids and edge.target in target_set and edge.target not in candidates:
            candidates.append(edge.target)
        if edge.target in selected_node_ids and edge.source in target_set and edge.source not in candidates:
            candidates.append(edge.source)
    return candidates


def _selected_character_sheet_branch_target(
    workflow: GraphWorkflow,
    canvas_context: dict[str, Any] | None,
) -> tuple[CharacterSheetBranchTarget | None, AssistantGraphPlan | None]:
    context = compact_canvas_context(canvas_context)
    target_ids = _target_ids_with_character_sheet_edges(workflow)
    if not target_ids:
        return None, AssistantGraphPlan(
            summary="I need a Character Sheet branch with connected image references before duplicating it.",
            questions=["Select a Character Sheet branch that already has face/body references wired into GPT Image 2."],
            operations=[],
            requires_confirmation=False,
            metadata={"template_id": CHARACTER_SHEET_TEMPLATE_ID, "blocked_reason": "missing_selected_character_sheet_branch"},
        )
    if not context or not bool(context.get("selection_available")):
        canonical_target_id, has_multiple_components = _canonical_branch_target_id(workflow, target_ids)
        if canonical_target_id and not has_multiple_components:
            return CharacterSheetBranchTarget(target_node_id=canonical_target_id), None
        return None, AssistantGraphPlan(
            summary="I need a selected Character Sheet branch before making a branch-level creative edit.",
            questions=["Select the Character Sheet branch, or a node inside it, then ask me to duplicate or revise that version."],
            operations=[],
            requires_confirmation=False,
            metadata={"template_id": CHARACTER_SHEET_TEMPLATE_ID, "blocked_reason": "selected_branch_required"},
        )

    group_candidates: list[tuple[str, dict[str, Any]]] = []
    for group in _selected_group_candidates(workflow, canvas_context):
        node_ids = _group_node_ids(group)
        for target_id in target_ids:
            if target_id in node_ids:
                group_candidates.append((target_id, group))
    if group_candidates:
        candidate_ids = [target_id for target_id, _group in group_candidates]
        canonical_target_id, has_multiple_components = _canonical_branch_target_id(workflow, candidate_ids)
        if canonical_target_id and not has_multiple_components:
            group = next(group for target_id, group in group_candidates if target_id == canonical_target_id)
            return CharacterSheetBranchTarget(
                target_node_id=canonical_target_id,
                group_id=str(group.get("id") or "") or None,
                group_title=str(group.get("title") or "") or None,
            ), None
        return None, AssistantGraphPlan(
            summary="I see more than one Character Sheet branch in the current selection.",
            questions=["Select one Character Sheet branch or one node inside the branch you want me to duplicate."],
            operations=[],
            requires_confirmation=False,
            metadata={"template_id": CHARACTER_SHEET_TEMPLATE_ID, "blocked_reason": "multiple_selected_character_sheet_branches"},
        )

    selected_node_ids = _selected_ids_from_context(canvas_context, "selected_node_ids")
    connected_candidates = _target_ids_connected_to_selected_nodes(workflow, selected_node_ids, target_ids)
    canonical_target_id, has_multiple_components = _canonical_branch_target_id(workflow, connected_candidates)
    if canonical_target_id and not has_multiple_components:
        return CharacterSheetBranchTarget(target_node_id=canonical_target_id), None
    if has_multiple_components:
        return None, AssistantGraphPlan(
            summary="I see more than one Character Sheet branch connected to the selected node.",
            questions=["Select one branch group or the specific GPT Image 2 node I should use as the source."],
            operations=[],
            requires_confirmation=False,
            metadata={"template_id": CHARACTER_SHEET_TEMPLATE_ID, "blocked_reason": "multiple_connected_character_sheet_branches"},
        )

    return None, AssistantGraphPlan(
        summary="I need a selected Character Sheet branch before making a branch-level creative edit.",
        questions=["Select the Character Sheet branch, or a node inside it, then ask me to duplicate or revise that version."],
        operations=[],
        requires_confirmation=False,
        metadata={"template_id": CHARACTER_SHEET_TEMPLATE_ID, "blocked_reason": "selected_branch_not_character_sheet"},
    )


def _is_character_sheet_branch_edit_request(message: str, canvas_context: dict[str, Any] | None) -> bool:
    context = compact_canvas_context(canvas_context)
    has_selection = bool(context and context.get("selection_available"))
    text = " ".join(str(message or "").lower().split())
    if not text or any(term in text for term in ("storyboard", "story board", "storyboard still", "seedance", "seed dance")):
        return False
    branch_reference = re.search(r"\b(?:this|selected|current)\s+(?:branch|variant|version)\b", text) or re.search(
        r"\b(?:duplicate|copy|another|new)\b.{0,80}\b(?:branch|variant|version)\b",
        text,
    )
    creative_edit = re.search(r"\b(?:make|turn|change|try|adjust|duplicate|copy)\b", text) and re.search(
        r"\b(?:her|him|them|character|outfit|style|cyborg|western|wizard|warrior|armor|clothing|background|badass|sexy)\b",
        text,
    )
    return bool(branch_reference or (has_selection and creative_edit))


def _reference_roles_from_existing_target(workflow: GraphWorkflow) -> list[CharacterSheetReferenceRole]:
    for target_id in _target_ids_with_character_sheet_edges(workflow):
        roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id=target_id)
        if roles:
            return roles
    return []


def _reference_roles_from_selected_branch(
    workflow: GraphWorkflow,
    selected_branch: CharacterSheetBranchTarget,
) -> list[CharacterSheetReferenceRole]:
    roles = character_sheet_reference_roles_from_workflow(workflow, target_node_id=selected_branch.target_node_id)
    if roles and not character_sheet_role_clarification_question(roles):
        return roles
    fallback_roles = _reference_roles_from_load_image_nodes(workflow)
    if fallback_roles and not character_sheet_role_clarification_question(fallback_roles):
        return fallback_roles
    two_ref_default_roles = _reference_roles_from_two_load_image_defaults(workflow)
    if two_ref_default_roles:
        return two_ref_default_roles
    return roles


def _reference_roles_from_load_image_nodes(workflow: GraphWorkflow) -> list[CharacterSheetReferenceRole]:
    candidates: list[tuple[int, GraphWorkflowNode, str | None, str | None]] = []
    for index, node in enumerate(workflow.nodes):
        if node.type != "media.load_image":
            continue
        role_key, matched_keyword = _role_from_text(_node_role_text(node))
        candidates.append((index, node, role_key, matched_keyword))
    if not candidates:
        return []
    if len(candidates) == 1 and not candidates[0][2]:
        index, node, _role_key, _matched_keyword = candidates[0]
        candidates = [(index, node, ROLE_FACE_IDENTITY, "single_reference_default")]
    elif len(candidates) > 1 and not any(role_key for _index, _node, role_key, _matched in candidates):
        return []

    ordered = sorted(
        candidates,
        key=lambda item: (
            ROLE_ORDER.get(item[2] or ROLE_EXTRA_REFERENCE, ROLE_ORDER[ROLE_EXTRA_REFERENCE]),
            float(item[1].position.get("y") or 0),
            float(item[1].position.get("x") or 0),
            item[0],
        ),
    )
    roles: list[CharacterSheetReferenceRole] = []
    for reference_number, (_index, node, role_key, matched_keyword) in enumerate(ordered, start=1):
        inferred_role = role_key or _default_role_for_position(reference_number)
        needs_clarification = inferred_role == ROLE_EXTRA_REFERENCE
        confidence = "high" if role_key else "medium" if reference_number <= 2 else "low"
        evidence = [f"planned_order:{reference_number}", f"source_title:{_node_title(node)}"]
        if matched_keyword:
            evidence.append(f"matched:{matched_keyword}")
        elif reference_number <= 2:
            evidence.append("position_default")
        else:
            evidence.append("ambiguous_extra")
        roles.append(
            CharacterSheetReferenceRole(
                reference_number=reference_number,
                source_node_id=node.id,
                source_port="image",
                target_node_id="",
                target_port="image_refs",
                role_key=inferred_role,
                role_label=ROLE_LABELS[inferred_role],
                scope=ROLE_SCOPES[inferred_role],
                confidence=confidence,
                needs_clarification=needs_clarification,
                evidence=tuple(evidence),
            )
        )
    return roles


def _reference_roles_from_two_load_image_defaults(workflow: GraphWorkflow) -> list[CharacterSheetReferenceRole]:
    candidates = [(index, node) for index, node in enumerate(workflow.nodes) if node.type == "media.load_image"]
    if len(candidates) != 2:
        return []
    ordered = sorted(
        candidates,
        key=lambda item: (
            float(item[1].position.get("y") or 0),
            float(item[1].position.get("x") or 0),
            item[0],
        ),
    )
    roles: list[CharacterSheetReferenceRole] = []
    for reference_number, (_index, node) in enumerate(ordered, start=1):
        role_key = _default_role_for_position(reference_number)
        roles.append(
            CharacterSheetReferenceRole(
                reference_number=reference_number,
                source_node_id=node.id,
                source_port="image",
                target_node_id="",
                target_port="image_refs",
                role_key=role_key,
                role_label=ROLE_LABELS[role_key],
                scope=ROLE_SCOPES[role_key],
                confidence="medium",
                needs_clarification=False,
                evidence=(f"selected_branch_two_ref_default:{reference_number}", f"source_title:{_node_title(node)}"),
            )
        )
    return roles


def _confirmation_role_for_ordinal(text: str, ordinal_terms: tuple[str, ...]) -> tuple[str | None, str | None]:
    normalized = " ".join(str(text or "").lower().split())
    if not normalized:
        return None, None
    ordinal_pattern = "|".join(re.escape(term) for term in ordinal_terms)
    fragments = [fragment.strip() for fragment in re.split(r"[.?!;]+", normalized) if fragment.strip()]
    for fragment in fragments:
        ordinal_matches = list(re.finditer(rf"\b(?:{ordinal_pattern})\b", fragment))
        if not ordinal_matches:
            continue
        ordinal_match = ordinal_matches[0]
        best: tuple[int, str, str] | None = None
        for role_key, keywords in ROLE_KEYWORD_GROUPS:
            for keyword in keywords:
                for keyword_match in re.finditer(rf"\b{re.escape(keyword)}\b", fragment):
                    if keyword_match.start() >= ordinal_match.end():
                        distance = keyword_match.start() - ordinal_match.end()
                    else:
                        distance = ordinal_match.start() - keyword_match.end() + 200
                    if best is None or distance < best[0]:
                        best = (distance, role_key, keyword)
        if best is not None:
            return best[1], best[2]
    for role_key, keywords in ROLE_KEYWORD_GROUPS:
        for keyword in keywords:
            keyword_pattern = re.escape(keyword)
            if re.search(rf"\b(?:{ordinal_pattern})\b.{{0,140}}\b{keyword_pattern}\b", normalized):
                return role_key, keyword
            if re.search(rf"\b{keyword_pattern}\b.{{0,140}}\b(?:{ordinal_pattern})\b", normalized):
                return role_key, keyword
    return None, None


def _reference_roles_from_role_confirmation(workflow: GraphWorkflow, text: str) -> list[CharacterSheetReferenceRole]:
    candidates = [(index, node) for index, node in enumerate(workflow.nodes) if node.type == "media.load_image"]
    if len(candidates) < 2:
        return []

    confirmed_roles = [
        _confirmation_role_for_ordinal(text, ("first", "1st", "image reference 1", "ref 1", "top", "upper")),
        _confirmation_role_for_ordinal(text, ("second", "2nd", "image reference 2", "ref 2", "bottom", "lower")),
    ]
    if not all(role_key for role_key, _matched in confirmed_roles):
        return []

    roles: list[CharacterSheetReferenceRole] = []
    for reference_number, ((index, node), (role_key, matched_keyword)) in enumerate(zip(candidates, confirmed_roles), start=1):
        assert role_key is not None
        roles.append(
            CharacterSheetReferenceRole(
                reference_number=reference_number,
                source_node_id=node.id,
                source_port="image",
                target_node_id="",
                target_port="image_refs",
                role_key=role_key,
                role_label=ROLE_LABELS[role_key],
                scope=ROLE_SCOPES[role_key],
                confidence="high",
                needs_clarification=False,
                evidence=(f"conversation_order:{index + 1}", f"source_title:{_node_title(node)}", f"confirmed:{matched_keyword}"),
            )
        )
    return roles


def _character_sheet_request_text(message: str, context_message: str | None = None) -> str:
    parts = [*re.split(r"\n{2,}", str(context_message or "").strip()), str(message or "").strip()]
    values: list[str] = []
    for part in parts:
        normalized = " ".join(part.split()).strip()
        if normalized and normalized not in values:
            values.append(normalized)
    return "\n\n".join(values)


def character_sheet_graph_plan_from_workflow_request(
    message: str,
    workflow: GraphWorkflow,
    *,
    context_message: str | None = None,
    canvas_context: dict[str, Any] | None = None,
    attachments: Iterable[dict[str, Any]] | None = None,
) -> AssistantGraphPlan | None:
    request_text = _character_sheet_request_text(message, context_message)
    branch_edit_request = _is_character_sheet_branch_edit_request(message, canvas_context)
    if not is_character_sheet_graph_request(request_text) and not branch_edit_request:
        return None
    selected_branch: CharacterSheetBranchTarget | None = None
    if branch_edit_request:
        selected_branch, blocked_plan = _selected_character_sheet_branch_target(workflow, canvas_context)
        if blocked_plan:
            return blocked_plan
    roles = (
        _reference_roles_from_selected_branch(workflow, selected_branch)
        if selected_branch
        else _reference_roles_from_existing_target(workflow)
        or _reference_roles_from_load_image_nodes(workflow)
        or _reference_roles_from_role_confirmation(workflow, request_text)
    )
    include_placeholder_refs = False
    placeholder_reference_ids: dict[int, str] | None = None
    attachment_reference_ids = _character_sheet_attachment_reference_ids(attachments)
    if (
        not roles
        and _wants_character_sheet_v3(request_text)
        and _wants_attached_character_sheet_refs(request_text)
        and len(attachment_reference_ids) >= 2
    ):
        roles = _placeholder_character_sheet_roles()
        include_placeholder_refs = True
        placeholder_reference_ids = {1: attachment_reference_ids[0], 2: attachment_reference_ids[1]}
    if not roles and _wants_character_sheet_v3(request_text) and _wants_placeholder_character_sheet_refs(request_text):
        roles = _placeholder_character_sheet_roles()
        include_placeholder_refs = True
    if not roles:
        return AssistantGraphPlan(
            summary="I need clear image references before I build the Character Sheet graph.",
            questions=["Which image node should be the face lock, and which should be the body lock?"],
            operations=[],
            requires_confirmation=False,
            metadata={"template_id": CHARACTER_SHEET_TEMPLATE_ID, "blocked_reason": "missing_reference_roles"},
        )
    background_mode = _character_sheet_request_background_mode(request_text)
    variant_count = _character_sheet_request_variant_count(message)
    variant_labels = _character_sheet_variant_labels(workflow, background_mode, variant_count)
    base_brief = _character_sheet_request_brief_from_context(message, context_message)
    if _wants_character_sheet_v3(request_text):
        return character_sheet_v3_graph_plan_from_roles(
            roles,
            user_prompt=base_brief,
            character_name=_character_sheet_request_character_name(request_text),
            variant_label=variant_labels[0],
            include_placeholder_refs=include_placeholder_refs,
            placeholder_reference_ids=placeholder_reference_ids,
        )
    plans = [
        _with_shifted_positions(
            character_sheet_graph_plan_from_roles(
                roles,
                user_prompt=_character_sheet_multi_variant_brief(base_brief, index, len(variant_labels)),
                background_mode=background_mode,
                variant_label=label,
            ),
            CHARACTER_SHEET_MULTI_VARIANT_GAP_X * index,
        )
        for index, label in enumerate(variant_labels)
    ]
    if len(plans) == 1:
        plan = plans[0]
        metadata = dict(plan.metadata)
        metadata["variant_count"] = 1
        metadata["variant_labels"] = variant_labels
        if selected_branch:
            metadata["source_branch_target_node_id"] = selected_branch.target_node_id
            metadata["source_branch_group_id"] = selected_branch.group_id
            metadata["source_branch_title"] = selected_branch.group_title
            metadata["branch_aware_duplicate"] = True
        return plan.model_copy(update={"metadata": metadata})

    operations: list[AssistantGraphOperation] = []
    warnings: list[str] = []
    for plan in plans:
        operations.extend(plan.operations)
        warnings.extend(plan.warnings)
    reference_summary = [f"ref {role.reference_number}: {role.role_label.lower()}" for role in roles]
    return AssistantGraphPlan(
        summary=(
            f"I made {len(plans)} Character Sheet variants with GPT Image 2 image-to-image. "
            f"Reference mapping: {', '.join(reference_summary)}."
        ),
        operations=operations,
        warnings=warnings,
        requires_confirmation=False,
        metadata={
            "template_id": CHARACTER_SHEET_TEMPLATE_ID,
            "background_mode": background_mode,
            "variant_count": len(plans),
            "variant_labels": variant_labels,
            "variant_label": variant_labels[0],
            "reference_roles": plans[0].metadata.get("reference_roles", []),
            **(
                {
                    "source_branch_target_node_id": selected_branch.target_node_id,
                    "source_branch_group_id": selected_branch.group_id,
                    "source_branch_title": selected_branch.group_title,
                    "branch_aware_duplicate": True,
                }
                if selected_branch
                else {}
            ),
        },
    )
