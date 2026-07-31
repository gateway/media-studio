from __future__ import annotations

import json

import pytest
from PIL import Image

from app.graph.storyboard_sheet_renderer import SHEET_HEIGHT, SHEET_WIDTH, render_storyboard_sheet
from app.graph.storyboard_sheet_spec import (
    STORYBOARD_ART_SOURCE_CONTRACT,
    STORYBOARD_LAYOUT_ID,
    STORYBOARD_LAYOUT_VERSION,
    STORYBOARD_METADATA_DISPLAY_LIMITS,
    storyboard_art_prompt,
    storyboard_art_source_prompt_is_compatible,
    storyboard_panel_prompts,
    storyboard_source_grid_id_for_panel_count,
    storyboard_source_plate_aspect_for_panel_count,
    storyboard_sheet_spec_from_mapping,
    storyboard_sheet_spec_from_recipe_result,
)


def _recipe_result(
    *,
    recipe_key: str,
    subject: str,
    project: str = "ORBITAL RELAY",
    panel_count: int = 6,
) -> dict[str, str]:
    panels: list[str] = []
    for number in range(1, panel_count + 1):
        dialogue = 'OPERATOR [calm voice] — "Relay aligned."' if number == 5 else ""
        panels.append(
            f"PANEL {number:02d}:\n"
            f"SHOT: {number:02d} — RELAY BEAT {number}\n"
            "CAMERA: Eye-level three-quarter angle, controlled dolly track, natural 50mm lens feel\n"
            f"ACTION: The operator completes relay alignment beat {number}\n"
            "MOTION: The indicator lights settle while the camera advances\n"
            f"DIALOG: {dialogue}\n"
            "NOTES: Preserve the established relay position and light state\n"
        )
    raw_text = (
        "Create one Storyboard v2 production sheet titled exactly “BOARD 1 OF 3 — RELAY ALIGNMENT”.\n\n"
        "TOP PRODUCTION STRIP:\n"
        f"PROJECT: {project}\nSEQUENCE: BOARD 1 OF 3\nLOCATION: UPLINK CHAMBER\nDATE: —\nARTIST: —\n\n"
        "REFERENCE LOCKS:\nUse @image1 for recurring identity and @image2 for spatial continuity.\n\n"
        "WARDROBE CUES:\nOne sealed technical field suit remains unchanged.\n\n"
        f"SUBJECT DESIGN CUES:\n{subject}\n\n"
        + "\n".join(panels)
        + "\nBOARD TITLE: BOARD 1 OF 3 — RELAY ALIGNMENT\n"
        + f"PRODUCTION METADATA: PROJECT: {project}; SEQUENCE: BOARD 1 OF 3; LOCATION: UPLINK CHAMBER; DATE: —; ARTIST: —"
    )
    return {"recipe_key": recipe_key, "raw_text": raw_text, "final_text": raw_text}


PORTABILITY_MATRIX = [
    {
        "id": "fantasy_creature",
        "panel_count": 4,
        "project": "LANTERN AERIE",
        "location": "CRYSTAL RIDGE",
        "subject": "A lantern-winged gryphon hatchling with opal talons and a warm ember glow under each feather.",
        "style": "cinematic fantasy adventure realism with torchlit atmosphere and pearlescent creature detail",
        "anchor": "lantern-winged gryphon hatchling",
    },
    {
        "id": "modern_kitchen",
        "panel_count": 6,
        "project": "KITCHEN SERVICE",
        "location": "SUNLIT KITCHEN",
        "subject": "A stainless prep island, hanging copper pans, basil planters, and a precise chef's hand setting plates.",
        "style": "clean modern lifestyle cinematography with warm morning window light",
        "anchor": "stainless prep island",
    },
    {
        "id": "product_commercial",
        "panel_count": 4,
        "project": "PRODUCT ORBIT",
        "location": "STUDIO CYCLORAMA",
        "subject": "A matte black noise-canceling headphone product with brushed titanium hinges and blue status LEDs.",
        "style": "premium product-commercial macro cinematography with glossy reflections and controlled rim light",
        "anchor": "noise-canceling headphone product",
    },
    {
        "id": "dialogue_only_interior",
        "panel_count": 6,
        "project": "QUIET NEGOTIATION",
        "location": "TRAIN DINING CAR",
        "subject": "Two sharply dressed negotiators sit across a narrow table in a rain-streaked vintage dining car.",
        "style": "contained dialogue drama with restrained noir lighting and precise eyelines",
        "anchor": "rain-streaked vintage dining car",
        "dialogues": {
            1: "We keep this between us.",
            2: "Only if the ledger is real.",
            3: "It is real, and it is moving tonight.",
            4: "Then we change the handoff.",
            5: "No one else can know.",
            6: "They already do.",
        },
    },
    {
        "id": "environment_without_character",
        "panel_count": 4,
        "project": "WEATHER OBSERVATORY",
        "location": "CLIFFSIDE OBSERVATORY",
        "subject": "An abandoned cliffside weather observatory, rotating anemometers, wet concrete, and a storm front crossing the sea.",
        "style": "moody environmental storytelling focused on empty architecture and storm atmosphere",
        "anchor": "cliffside weather observatory",
    },
    {
        "id": "multiple_characters",
        "panel_count": 6,
        "project": "TWIN MECHANICS",
        "location": "GARAGE BAY",
        "subject": "A silver-haired mechanic and a younger apprentice coordinate around a hovering courier bike with red cargo pods.",
        "style": "grounded near-future garage realism with oily work lights and clear two-person blocking",
        "anchor": "silver-haired mechanic",
    },
    {
        "id": "non_photoreal_animation",
        "panel_count": 9,
        "project": "PAPER MOON",
        "location": "HAND-DRAWN CITY",
        "subject": "A paper-cutout moon courier rides a tiny bicycle across folded rooftops and ink-blue streets.",
        "style": "flat 2D hand-drawn animation with visible paper texture, ink outlines, and storybook color blocking",
        "anchor": "paper-cutout moon courier",
    },
]


def _portable_recipe_result(case: dict[str, object]) -> dict[str, str]:
    panel_count = int(case["panel_count"])
    project = str(case["project"])
    location = str(case["location"])
    subject = str(case["subject"])
    style = str(case["style"])
    dialogues = case.get("dialogues") if isinstance(case.get("dialogues"), dict) else {}
    panels: list[str] = []
    for number in range(1, panel_count + 1):
        dialogue = str(dialogues.get(number, ""))
        dialog_row = f'NARRATOR [measured] — "{dialogue}"' if dialogue else ""
        panels.append(
            f"PANEL {number:02d}:\n"
            f"SHOT: {number:02d} — PORTABLE BEAT {number}\n"
            f"CAMERA: Eye-level medium-wide frame, {35 + number}mm lens feel, controlled parallax move\n"
            f"ACTION: {subject} advances through portable story beat {number} with the scenario-specific focal detail visible\n"
            f"MOTION: Foreground and background elements shift in layered depth while beat {number} changes screen direction\n"
            f"DIALOG: {dialog_row}\n"
            f"NOTES: Preserve the unique setting landmarks and continuity markers for portable scenario {number}\n"
        )
    dialogue_cues = " ".join(f'Panel {number}: “{line}”' for number, line in dialogues.items())
    raw_text = (
        f"Create one reusable Storyboard v2 production sheet titled exactly “BOARD 1 OF 1 — {project}”.\n\n"
        "TOP PRODUCTION STRIP:\n"
        f"PROJECT: {project}\nSEQUENCE: BOARD 1 OF 1\nLOCATION: {location}\nDATE: —\nARTIST: —\n\n"
        "REFERENCE AUTHORITY:\nUse only the declared typed image-reference role block when connected; do not assume a fixed character, environment, or storyboard slot.\n\n"
        f"STYLE DIRECTION:\n{style}\n\n"
        f"SUBJECT DESIGN CUES:\n{subject}\n\n"
        + "\n".join(panels)
        + f"\nBOARD TITLE: BOARD 1 OF 1 — {project}\n"
        + f"PRODUCTION METADATA: PROJECT: {project}; SEQUENCE: BOARD 1 OF 1; LOCATION: {location}; DATE: —; ARTIST: —"
    )
    return {
        "recipe_key": "storyboard-v2-gpt-image-2",
        "raw_text": raw_text,
        "final_text": raw_text,
        "dialogue_cues": dialogue_cues,
    }


def test_first_and_continuation_results_compile_to_the_same_typed_contract() -> None:
    subject = "A compact quadruped survey companion has articulated brass forelimbs and violet status lights."
    first = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(recipe_key="storyboard-v2-gpt-image-2", subject=subject)
    )
    continuation = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(recipe_key="storyboard-continuation-v1", subject=subject)
    )

    assert first.contract_id == continuation.contract_id
    assert first.contract_version == continuation.contract_version
    assert first.layout_id == continuation.layout_id == STORYBOARD_LAYOUT_ID
    assert first.production_metadata == continuation.production_metadata
    assert first.panels == continuation.panels
    assert first.source_recipe_key != continuation.source_recipe_key
    assert storyboard_sheet_spec_from_mapping(first.to_dict()) == first


def test_art_prompt_keeps_user_subject_traits_but_excludes_sheet_chrome() -> None:
    subject = "A compact quadruped survey companion has articulated brass forelimbs and violet status lights."
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(recipe_key="storyboard-v2-gpt-image-2", subject=subject)
    )

    prompt = storyboard_art_prompt(spec)

    assert subject in prompt
    assert "exactly six equal cinematic frames" in prompt
    assert "Source grid: 2x3" in prompt
    assert "4:3 source plate" in prompt
    assert "2-column by 3-row source grid" in prompt
    assert "no titles, words, letters, numbers, captions, metadata, borders" in prompt
    assert "SHOT:" not in prompt
    assert "PROJECT:" not in prompt
    assert "ORBITAL RELAY" not in prompt


def test_storyboard_spec_strips_image_reference_tokens_from_visible_metadata() -> None:
    result = _recipe_result(
        recipe_key="storyboard-v2-gpt-image-2",
        subject="A neutral recurring subject.",
    )
    result["panel_notes_cues"] = (
        "PANEL 01 — Preserve the sanctuary geography from [image reference 2]. "
        "PANEL 02 — Continue the route using @image2."
    )
    result["raw_text"] = result["raw_text"].replace(
        "ACTION: The operator completes relay alignment beat 3",
        "ACTION: The operator completes relay alignment beat 3 using [image reference 1]",
    ).replace(
        "LOCATION: UPLINK CHAMBER; DATE",
        "LOCATION: UPLINK CHAMBER from [image reference 2]; DATE",
    )
    result["final_text"] = result["raw_text"]

    spec = storyboard_sheet_spec_from_recipe_result(result)

    visible_values = [
        spec.production_metadata["LOCATION"],
        spec.panels[0].notes,
        spec.panels[1].notes,
        spec.panels[2].action,
    ]
    assert all("[image reference" not in value.lower() for value in visible_values)
    assert all("@image" not in value.lower() for value in visible_values)
    assert spec.production_metadata["LOCATION"] == "UPLINK CHAMBER"
    assert spec.panels[0].notes == "Preserve the sanctuary geography."
    assert spec.panels[1].notes == "Continue the route."
    assert spec.panels[2].action == "The operator completes relay alignment beat 3"


def test_art_prompt_expresses_visual_context_as_positive_provider_directions() -> None:
    result = _recipe_result(
        recipe_key="storyboard-continuation-v1",
        subject=(
            "A compact quadruped survey companion has four distinct paws and a low horizontal torso. "
            "Never depict the companion as a bipedal person or humanoid robot."
        ),
    )
    result["raw_text"] = result["raw_text"].replace(
        "One sealed technical field suit remains unchanged.",
        (
            "One sealed high-collar technical field suit forms a continuous opaque garment. "
            "Never expose the waist or underwear."
        ),
    )
    result["final_text"] = result["raw_text"]

    prompt = storyboard_art_prompt(storyboard_sheet_spec_from_recipe_result(result))

    assert "four distinct paws and a low horizontal torso" in prompt
    assert "continuous opaque garment" in prompt
    for forbidden in ("never", "underwear", "expose", "humanoid", "bipedal"):
        assert forbidden not in prompt.lower()


def test_art_source_contract_accepts_current_art_only_prompt_and_rejects_historical_complete_sheet() -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    )

    assert STORYBOARD_ART_SOURCE_CONTRACT in storyboard_art_prompt(spec)
    assert storyboard_art_source_prompt_is_compatible(storyboard_art_prompt(spec)) is True
    assert storyboard_art_source_prompt_is_compatible(storyboard_art_prompt(spec), panel_count=6) is True
    assert storyboard_art_source_prompt_is_compatible(storyboard_art_prompt(spec), panel_count=4) is False
    assert storyboard_art_source_prompt_is_compatible(
        "Create one text-free 16:9 source plate with exactly six equal cinematic frames in a 3x2 grid. "
        "Show art only: no titles, words, letters, numbers, captions, metadata, borders, or production chrome."
    ) is False
    assert storyboard_art_source_prompt_is_compatible(
        "Create one finished 16:9 storyboard on a fixed sequence template. "
        "Under each image: six separate full-width horizontal metadata rows."
    ) is False


def test_art_prompt_prioritizes_action_and_declares_wide_safe_frame() -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    )

    prompt = storyboard_art_prompt(spec)
    first_cell = prompt.split("Cell 01:", 1)[1].split("Cell 02:", 1)[0]

    assert "approximately 1.9:1" in prompt
    assert "central 58% vertical safe band" in prompt
    assert "complete action" in prompt
    assert first_cell.index(spec.panels[0].action) < first_cell.index("eye-level three-quarter angle")


def test_art_prompt_separates_compacted_motion_and_notes_at_complete_clause_boundaries() -> None:
    result = _recipe_result(
        recipe_key="storyboard-continuation-v1",
        subject="A neutral recurring subject.",
    )
    result["raw_text"] = result["raw_text"].replace(
        "The indicator lights settle while the camera advances",
        (
            "The camera eases forward as the latch rotates and a service unit rolls through the "
            "soft-focus background"
        ),
        1,
    ).replace(
        "Preserve the established relay position and light state",
        "Preserve the closed amber handoff before the latch begins to release",
        1,
    )
    result["final_text"] = result["raw_text"]

    prompt = storyboard_art_prompt(storyboard_sheet_spec_from_recipe_result(result))
    first_cell = prompt.split("Cell 01:", 1)[1].split("Cell 02:", 1)[0]

    assert "soft-focus Preserve" not in first_cell
    assert ". Preserve the closed amber handoff" in first_cell
    assert len(prompt) <= 4200


def test_unrelated_story_results_do_not_cross_contaminate() -> None:
    relay = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A brass quadruped survey companion carries violet status lights.",
            project="ORBITAL RELAY",
        )
    )
    orchard = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A linen-winged orchard moth has translucent green markings.",
            project="GLASS ORCHARD",
        )
    )

    relay_prompt = storyboard_art_prompt(relay)
    orchard_prompt = storyboard_art_prompt(orchard)
    assert "violet status lights" not in orchard_prompt
    assert "translucent green markings" not in relay_prompt
    assert "GLASS ORCHARD" not in relay_prompt
    assert "ORBITAL RELAY" not in orchard_prompt


def test_compiler_rejects_incomplete_metadata_before_art_generation() -> None:
    result = _recipe_result(
        recipe_key="storyboard-continuation-v1",
        subject="A neutral recurring subject.",
    )
    result["raw_text"] = result["raw_text"].replace(
        "The indicator lights settle while the camera advances",
        "The cracked relay floor.",
        1,
    )

    with pytest.raises(ValueError, match=r"Panel 01 MOTION is not a complete semantic value"):
        storyboard_sheet_spec_from_recipe_result(result)


@pytest.mark.parametrize("label", ["ACTION", "MOTION", "NOTES"])
def test_compiler_rejects_missing_required_narrative_rows_without_cross_field_fallback(label: str) -> None:
    result = _recipe_result(
        recipe_key="storyboard-v2-gpt-image-2",
        subject="A neutral recurring subject.",
    )
    result["raw_text"] = result["raw_text"].replace(
        {
            "ACTION": "ACTION: The operator completes relay alignment beat 1",
            "MOTION": "MOTION: The indicator lights settle while the camera advances",
            "NOTES": "NOTES: Preserve the established relay position and light state",
        }[label],
        f"{label}:",
        1,
    )

    with pytest.raises(ValueError, match=rf"Panel 01 {label} is empty"):
        storyboard_sheet_spec_from_recipe_result(result)


@pytest.mark.parametrize(
    ("left", "right", "replacement"),
    [
        ("ACTION", "MOTION", "The operator crosses the marked threshold toward the relay chamber"),
        ("MOTION", "NOTES", "Indicator lights settle while the camera advances through the chamber"),
        (
            "ACTION",
            "NOTES",
            "The operator completes the relay alignment and confirms the stable green indicator",
        ),
    ],
)
def test_compiler_rejects_duplicate_narrative_roles(left: str, right: str, replacement: str) -> None:
    result = _recipe_result(
        recipe_key="storyboard-continuation-v1",
        subject="A neutral recurring subject.",
    )
    replacements = {
        "ACTION": "The operator completes relay alignment beat 1",
        "MOTION": "The indicator lights settle while the camera advances",
        "NOTES": "Preserve the established relay position and light state",
    }
    for label in (left, right):
        result["raw_text"] = result["raw_text"].replace(
            f"{label}: {replacements[label]}",
            f"{label}: {replacement}",
            1,
        )

    with pytest.raises(ValueError, match=rf"Panel 01 {left} and {right} duplicate the same production meaning"):
        storyboard_sheet_spec_from_recipe_result(result)


def test_deterministic_renderer_matches_one_grid_and_six_image_modes() -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    )
    colors = ["#8b2f2f", "#2f5f8b", "#4f7b45", "#8b6b2f", "#68458b", "#3f7a78"]
    panels = [Image.new("RGB", (200, 200), color) for color in colors]
    grid = Image.new("RGB", (400, 600), "black")
    for index, panel in enumerate(panels):
        grid.paste(panel, ((index % 2) * 200, (index // 2) * 200))

    from_grid = render_storyboard_sheet([grid], spec)
    from_panels = render_storyboard_sheet(panels, spec)

    assert from_grid.image.size == from_panels.image.size == (SHEET_WIDTH, SHEET_HEIGHT)
    assert from_grid.image.tobytes() == from_panels.image.tobytes()
    assert from_grid.metadata["input_mode"] == "wide_2x3_source_grid"
    assert from_panels.metadata["input_mode"] == "six_ordered_images"
    assert from_grid.metadata["panel_count"] == 6
    assert from_grid.metadata["grid"] == {"columns": 3, "rows": 2}
    assert from_grid.metadata["font_family"] != ""
    assert len(from_grid.metadata["panel_geometry"]) == 6
    assert len({item["width"] for item in from_grid.metadata["panel_geometry"]}) <= 2
    assert len({item["image_height"] for item in from_grid.metadata["panel_geometry"]}) == 1


def test_renderer_matches_reference_hierarchy_without_duplicate_shot_row() -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    )
    rendered = render_storyboard_sheet([Image.new("RGB", (600, 400), "#314b5f")], spec)

    assert rendered.metadata["art_safe_frame"] == {
        "target_aspect_ratio": "1.9:1",
        "vertical_safe_band_percent": 58,
    }
    assert rendered.metadata["visible_metadata_labels"] == ["CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES"]
    assert "SHOT" not in rendered.metadata["visible_metadata_labels"]
    assert rendered.metadata["layout_version"] == STORYBOARD_LAYOUT_VERSION == "4"
    assert rendered.metadata["presentation"] == {
        "outer_frame": "thin_amber",
        "production_strip": "unified_inline",
        "metadata_surface": "near_black",
        "shot_placement": "heading_only",
    }
    assert rendered.metadata["header_geometry"]["height"] >= 44
    assert rendered.metadata["header_geometry"]["grid_top"] <= 60
    assert rendered.metadata["header_geometry"]["title_font_size"] >= 26
    assert rendered.metadata["header_geometry"]["production_label_font_size"] >= 12
    assert rendered.metadata["header_geometry"]["production_value_font_size"] >= 13
    assert rendered.metadata["display_font_family"]
    assert rendered.metadata["body_font_family"]
    for panel in rendered.metadata["panel_geometry"]:
        assert panel["heading_text"] == f"{panel['panel']:02d} — RELAY BEAT {panel['panel']}"
        assert panel["heading_height"] >= 36
        assert panel["heading_font_size"] >= 18
        assert panel["metadata_row_count"] == 5
        assert panel["image_height"] / panel["height"] >= 0.65
        assert panel["metadata_height"] / panel["height"] <= 0.29
        assert panel["metadata_label_width"] >= 84
        assert panel["minimum_metadata_font_size"] >= 14
        assert 1.85 <= panel["width"] / panel["image_height"] <= 1.95


@pytest.mark.parametrize(
    ("label", "value"),
    [
        ("DIALOG", 'OPERATOR [calm voice] — "' + "A" * 150 + '"'),
        ("NOTES", "Preserve the established relay position while " + "A" * 120),
    ],
)
def test_compiler_rejects_exact_metadata_that_cannot_fit_the_readable_display_contract(
    label: str,
    value: str,
) -> None:
    result = _recipe_result(
        recipe_key="storyboard-v2-gpt-image-2",
        subject="A neutral recurring subject.",
    )
    original = {
        "SHOT": "01 — RELAY BEAT 1",
        "CAMERA": "Eye-level three-quarter angle, controlled dolly track, natural 50mm lens feel",
        "ACTION": "The operator completes relay alignment beat 1",
        "MOTION": "The indicator lights settle while the camera advances",
        "DIALOG": "",
        "NOTES": "Preserve the established relay position and light state",
    }[label]
    result["raw_text"] = result["raw_text"].replace(f"{label}: {original}", f"{label}: {value}", 1)
    result["final_text"] = result["raw_text"]

    with pytest.raises(ValueError, match=rf"Panel 01 {label} exceeds the readable display limit"):
        storyboard_sheet_spec_from_recipe_result(result)


@pytest.mark.parametrize(
    ("label", "value"),
    [
        ("SHOT", "01 — WIDE RELAY APPROACH WHILE THE DISTANT SERVICE LIGHTS GUIDE THE OPERATOR TOWARD THE PLATFORM"),
        ("CAMERA", "Eye-level three-quarter angle, controlled dolly movement, natural 50mm lens; medium-wide framing keeps the operator, relay platform, route markers, and deep service-bay geography readable"),
        ("ACTION", "The operator completes the visible relay alignment while checking every seated connector and confirming that the status lights settle into their stable pattern"),
        ("MOTION", "The indicator lights settle from left to right as the camera advances and fine dust crosses the established route behind the operator"),
    ],
)
def test_compiler_compacts_generated_metadata_into_the_readable_display_contract(
    label: str,
    value: str,
) -> None:
    result = _recipe_result(
        recipe_key="storyboard-v2-gpt-image-2",
        subject="A neutral recurring subject.",
    )
    original = {
        "SHOT": "01 — RELAY BEAT 1",
        "CAMERA": "Eye-level three-quarter angle, controlled dolly track, natural 50mm lens feel",
        "ACTION": "The operator completes relay alignment beat 1",
        "MOTION": "The indicator lights settle while the camera advances",
    }[label]
    result["raw_text"] = result["raw_text"].replace(f"{label}: {original}", f"{label}: {value}", 1)
    result["final_text"] = result["raw_text"]

    spec = storyboard_sheet_spec_from_recipe_result(result)
    compacted = getattr(spec.panels[0], label.lower())

    assert compacted
    assert len(compacted) <= STORYBOARD_METADATA_DISPLAY_LIMITS[label]


def test_compiler_applies_user_owned_inline_panel_note_overrides_by_number() -> None:
    result = _recipe_result(
        recipe_key="storyboard-continuation-v1",
        subject="A neutral recurring subject.",
    )
    original = "Preserve the established relay position and light state"
    generated = (
        "Generated continuity prose expands beyond the display contract and should not replace the exact "
        "user-owned note for this panel under any accepted recipe serialization format."
    )
    result["raw_text"] = result["raw_text"].replace(f"NOTES: {original}", f"NOTES: {generated}", 1)
    result["final_text"] = result["raw_text"]
    result["panel_notes_cues"] = " ".join(
        f"PANEL {number:02d} — Preserve exact user continuity state {number}."
        for number in range(1, 7)
    )

    spec = storyboard_sheet_spec_from_recipe_result(result)

    assert spec.panels[0].notes == "Preserve exact user continuity state 1."
    assert all(
        panel.notes == f"Preserve exact user continuity state {panel.number}."
        for panel in spec.panels
    )


def test_compiler_preserves_exact_user_requested_dialogue() -> None:
    result = _recipe_result(
        recipe_key="storyboard-v2-gpt-image-2",
        subject="A neutral recurring subject.",
    )
    result["dialogue_cues"] = 'PANEL 05 — OPERATOR [calm voice] — "Relay aligned."'

    spec = storyboard_sheet_spec_from_recipe_result(result)

    assert spec.panels[4].dialog == 'OPERATOR [calm voice] — "Relay aligned."'


def test_compiler_rejects_rewritten_user_requested_dialogue() -> None:
    result = _recipe_result(
        recipe_key="storyboard-v2-gpt-image-2",
        subject="A neutral recurring subject.",
    )
    result["dialogue_cues"] = 'PANEL 05 — OPERATOR [calm voice] — "Let’s check it."'
    result["raw_text"] = result["raw_text"].replace(
        'OPERATOR [calm voice] — "Relay aligned."',
        'OPERATOR [calm voice] — "the character’s check it."',
    )
    result["final_text"] = result["raw_text"]

    with pytest.raises(ValueError, match=r"missing exact requested dialogue: 'Let’s check it\.'"):
        storyboard_sheet_spec_from_recipe_result(result)


def test_deterministic_renderer_is_stable_across_consecutive_board_specs() -> None:
    relay = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A brass quadruped survey companion carries violet status lights.",
            project="ORBITAL RELAY",
        )
    )
    orchard = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-continuation-v1",
            subject="A linen-winged orchard moth has translucent green markings.",
            project="GLASS ORCHARD",
        )
    )
    panels = [Image.new("RGB", (200, 200), color) for color in ("red", "blue", "green", "gold", "purple", "teal")]

    render_storyboard_sheet(panels, relay)
    first_orchard = render_storyboard_sheet(panels, orchard)
    second_orchard = render_storyboard_sheet(panels, orchard)

    assert first_orchard.image.tobytes() == second_orchard.image.tobytes()
    assert first_orchard.metadata == second_orchard.metadata


def test_renderer_keeps_near_limit_complete_metadata_at_the_readable_font_floor() -> None:
    value = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    ).to_dict()
    value["panels"][0].update(
        {
            "camera": (
                "Eye-level three-quarter angle, controlled forward dolly movement, natural 50mm lens; "
                "medium-wide frame with the subject on the left."
            ),
            "action": (
                "The operator checks the marked relay housing while the nearby service unit holds "
                "the replacement component within reach."
            ),
            "motion": (
                "The camera advances slowly as indicator lights settle and the service unit crosses "
                "the background along the marked route."
            ),
            "dialog": 'OPERATOR [calm measured voice] — "The alignment is stable; keep the route clear while I confirm the final indicator."',
            "notes": (
                "Preserve the established relay position, component state, subject placement, and "
                "background route for the next beat."
            ),
        }
    )
    spec = storyboard_sheet_spec_from_mapping(value)

    rendered = render_storyboard_sheet([Image.new("RGB", (600, 400), "#314b5f")], spec)

    assert rendered.metadata["panel_geometry"][0]["minimum_metadata_font_size"] >= 14


def test_renderer_keeps_two_line_metadata_glyphs_inside_row_rules() -> None:
    value = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    ).to_dict()
    value["panels"][0].update(
        {
            "camera": (
                "Eye-level three-quarter angle, controlled physical dolly, natural 50mm lens; "
                "medium-wide composition preserves the relay staging."
            ),
            "action": (
                "The operator checks the primary relay housing while two service units carry "
                "calibrated modules toward the loading ramp."
            ),
            "motion": (
                "The camera advances as indicator lights settle and both service units cross "
                "the background along marked wayfinding."
            ),
            "dialog": "",
            "notes": (
                "Preserve the established relay position, component state, subject placement, "
                "and background spacing."
            ),
        }
    )
    rendered = render_storyboard_sheet(
        [Image.new("RGB", (600, 400), "#314b5f")],
        storyboard_sheet_spec_from_mapping(value),
    )

    geometry = rendered.metadata["panel_geometry"][0]
    metadata_top = geometry["y"] + geometry["heading_height"] + geometry["image_height"]
    row_heights = [geometry["metadata_height"] // 5] * 5
    row_heights[-1] += geometry["metadata_height"] - sum(row_heights)
    value_left = geometry["x"] + geometry["metadata_label_width"]
    value_right = geometry["x"] + geometry["width"] - 1
    row_fill = (12, 15, 19)
    row_rule = (102, 81, 38)

    for row_index in (0, 1, 2, 4):
        row_top = metadata_top + sum(row_heights[:row_index])
        row_bottom = row_top + row_heights[row_index]
        text_pixels = [
            y
            for y in range(row_top + 1, row_bottom)
            for x in range(value_left, value_right)
            if rendered.image.getpixel((x, y)) not in (row_fill, row_rule)
        ]
        assert text_pixels
        assert max(text_pixels) <= row_bottom - 3


def test_mapping_removes_a_repeated_camera_contract_without_dropping_subject_framing() -> None:
    value = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-continuation-v1",
            subject="A compact neutral survey companion remains consistent.",
        )
    ).to_dict()
    value["panels"][0]["camera"] = (
        "High angle, locked-off, 50mm lens; relay and operator hand centered; "
        "high angle, locked-off frame, 50mm lens."
    )

    spec = storyboard_sheet_spec_from_mapping(value)

    assert spec.panels[0].camera == (
        "High angle, locked-off, 50mm lens; relay and operator hand centered"
    )


def test_renderer_rejects_unsupported_image_counts() -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    )
    with pytest.raises(ValueError, match=r"one 2x3 source grid or exactly 6 ordered images"):
        render_storyboard_sheet([Image.new("RGB", (64, 64), "black")] * 2, spec)


@pytest.mark.parametrize(
    ("panel_count", "expected_size", "expected_grid", "source_size", "input_mode"),
    [
        (4, (SHEET_WIDTH, 2048), {"columns": 2, "rows": 2}, (400, 400), "source_grid_2x2"),
        (9, (SHEET_WIDTH, 2048), {"columns": 3, "rows": 3}, (600, 600), "source_grid_3x3"),
    ],
)
def test_storyboard_spec_and_renderer_support_2x2_and_3x3_boards(
    panel_count: int,
    expected_size: tuple[int, int],
    expected_grid: dict[str, int],
    source_size: tuple[int, int],
    input_mode: str,
) -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A neutral recurring subject.",
            panel_count=panel_count,
        )
    )

    prompt = storyboard_art_prompt(spec)
    rendered = render_storyboard_sheet([Image.new("RGB", source_size, "#314b5f")], spec)
    round_trip = storyboard_sheet_spec_from_mapping(spec.to_dict())

    assert round_trip == spec
    assert len(spec.panels) == panel_count
    assert f"Source grid: {storyboard_source_grid_id_for_panel_count(panel_count)}" in prompt
    assert f"{storyboard_source_plate_aspect_for_panel_count(panel_count)} source plate" in prompt
    assert rendered.image.size == expected_size
    assert rendered.metadata["panel_count"] == panel_count
    assert rendered.metadata["grid"] == expected_grid
    assert rendered.metadata["input_mode"] == input_mode
    assert len(rendered.metadata["panel_geometry"]) == panel_count


@pytest.mark.parametrize("case", PORTABILITY_MATRIX, ids=[str(item["id"]) for item in PORTABILITY_MATRIX])
def test_storyboard_compiler_renderer_and_art_prompt_are_portable_across_story_types(
    case: dict[str, object],
) -> None:
    panel_count = int(case["panel_count"])
    source_size = {4: (400, 400), 6: (600, 400), 9: (600, 600)}[panel_count]
    expected_input_mode = (
        "wide_2x3_source_grid"
        if panel_count == 6
        else f"source_grid_{storyboard_source_grid_id_for_panel_count(panel_count)}"
    )
    expected_style = str(case.get("style_anchor") or case["style"])

    spec = storyboard_sheet_spec_from_recipe_result(_portable_recipe_result(case))
    prompt = storyboard_art_prompt(spec)
    panel_prompts = storyboard_panel_prompts(spec)
    rendered = render_storyboard_sheet([Image.new("RGB", source_size, "#243447")], spec)

    assert len(spec.panels) == panel_count
    assert rendered.metadata["panel_count"] == panel_count
    assert rendered.metadata["input_mode"] == expected_input_mode
    assert str(case["anchor"]) in prompt
    assert expected_style in prompt
    assert "fixed character, environment, or storyboard slot" not in prompt
    assert "Sadi" not in prompt
    assert "Bolts" not in prompt
    assert "ORBITAL RELAY" not in prompt
    assert "UPLINK CHAMBER" not in prompt
    assert "time-freeze" not in prompt.lower()
    assert "frozen time" not in prompt.lower()
    assert all(expected_style in item for item in panel_prompts)
    assert all(item.count(expected_style) == 1 for item in panel_prompts)
    assert all(". No visible text" in item for item in panel_prompts)
    if case["id"] == "non_photoreal_animation":
        assert "flat 2D hand-drawn animation" in prompt
        assert "photoreal live-action" not in prompt
        assert all("Photoreal live-action" not in item for item in panel_prompts)
    if case["id"] == "dialogue_only_interior":
        for line in case["dialogues"].values():  # type: ignore[union-attr]
            assert str(line) in prompt


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("layout_id", "custom_layout", "layout_id is unsupported"),
        ("layout_version", "1", "layout_version is unsupported"),
        ("board_title", "", "requires a board title"),
    ],
)
def test_mapping_rejects_layout_or_title_contract_drift(field: str, value: str, message: str) -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    ).to_dict()
    spec[field] = value

    with pytest.raises(ValueError, match=message):
        storyboard_sheet_spec_from_mapping(spec)


def test_mapping_rejects_duplicate_narrative_roles() -> None:
    spec = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A compact neutral survey companion remains consistent.",
        )
    ).to_dict()
    spec["panels"][0]["notes"] = spec["panels"][0]["motion"]

    with pytest.raises(
        ValueError,
        match=r"Panel 01 MOTION and NOTES duplicate the same production meaning",
    ):
        storyboard_sheet_spec_from_mapping(spec)


def test_structured_sheet_spec_json_is_intermediate_not_provider_prompt() -> None:
    mapping = storyboard_sheet_spec_from_recipe_result(
        _recipe_result(
            recipe_key="storyboard-v2-gpt-image-2",
            subject="A modular rescue drone with amber wing lights and ceramic white shell panels.",
            panel_count=4,
        )
    ).to_dict()
    mapping["dialogue_cues"] = 'Panel 02: operator says exactly “Swap the capacitor before ignition.”'
    mapping["panels"][1]["dialog"] = 'OPERATOR [quiet urgency] — "Swap the capacitor before ignition."'
    encoded = json.dumps(mapping, ensure_ascii=False, separators=(",", ":"))

    spec = storyboard_sheet_spec_from_mapping(json.loads(encoded))
    prompt = storyboard_art_prompt(spec)
    rendered = render_storyboard_sheet([Image.new("RGB", (400, 400), "#25364a")], spec)

    assert len(spec.panels) == 4
    assert rendered.metadata["input_mode"] == "source_grid_2x2"
    assert "Source grid: 2x2" in prompt
    assert "Storyboard art source contract" in prompt
    assert "Swap the capacitor before ignition." in prompt
    assert encoded.startswith("{")
    assert len(prompt) < 4200
    for forbidden in ("{", "}", '"contract_id"', '"panels"', '"production_metadata"', '"dialogue_cues"'):
        assert forbidden not in prompt
