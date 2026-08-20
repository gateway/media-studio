from __future__ import annotations

import json
import sqlite3
from pathlib import Path


MEDIA_PRESET_SEED_IDS = {
    "media-preset-2x2-pose-grid-shared",
    "media-preset-3d-caricature-style-nano-banana-shared",
    "media-preset-exploding-food-shared",
    "media-preset-food-recipe-infographic-shared",
    "media-preset-giant-animal-anywhere-shared",
    "media-preset-photo-restoration-shared",
    "media-preset-selfie-with-movie-character-nano-banana-shared",
}

PROMPT_RECIPE_SEED_IDS = {
    "prompt-recipe-storyboard-director-3x3",
    "prompt-recipe-image-prompt-director",
    "prompt-recipe-video-director-multi-shot-json",
    "prompt-recipe-image-analysis-character-reference",
    "prompt-recipe-environment-sheet-v1",
    "prompt-recipe-environment-plate-v1",
    "prompt-recipe-storyboard-shot-sequence-3x3",
    "prompt-recipe-storyboard-v2-gpt-image-2",
    "prompt-recipe-storyboard-continuation-v1",
    "prompt-recipe-food-storyboard-host-v1",
    "prompt-recipe-seedance-storyboard-video-director-v1",
    "prompt-recipe-prompt-shortener",
}


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def test_bootstrap_schema_seeds_default_presets_and_prompt_recipes_from_split_modules(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "seed-data.sqlite"

    store.bootstrap_schema(db_path)

    with _connect(db_path) as connection:
        preset_rows = connection.execute(
            "SELECT * FROM media_presets WHERE preset_id IN (%s)"
            % ", ".join("?" for _ in MEDIA_PRESET_SEED_IDS),
            tuple(sorted(MEDIA_PRESET_SEED_IDS)),
        ).fetchall()
        recipe_rows = connection.execute(
            "SELECT * FROM prompt_recipes WHERE recipe_id IN (%s)"
            % ", ".join("?" for _ in PROMPT_RECIPE_SEED_IDS),
            tuple(sorted(PROMPT_RECIPE_SEED_IDS)),
        ).fetchall()
        caricature = connection.execute(
            """
            SELECT applies_to_models_json, input_schema_json, input_slots_json
            FROM media_presets
            WHERE preset_id = ?
            """,
            ("media-preset-3d-caricature-style-nano-banana-shared",),
        ).fetchone()
        image_director = connection.execute(
            """
            SELECT input_variables_json, image_input_json, rules_json, source_kind
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-image-prompt-director",),
        ).fetchone()
        storyboard_v2 = connection.execute(
            """
                SELECT system_prompt_template, version, image_input_json, rules_json, input_variables_json, custom_fields_json,
                       output_contract_json, default_options_json
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        ).fetchone()
        storyboard_continuation = connection.execute(
            """
                SELECT system_prompt_template, version, image_input_json, rules_json, input_variables_json, custom_fields_json, output_format,
                       output_contract_json, default_options_json
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-storyboard-continuation-v1",),
        ).fetchone()
        food_storyboard = connection.execute(
            """
            SELECT system_prompt_template, version, image_input_json, rules_json, input_variables_json, output_format
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-food-storyboard-host-v1",),
        ).fetchone()
        seedance_storyboard_video = connection.execute(
            """
            SELECT system_prompt_template, version, image_input_json, rules_json, input_variables_json, output_format, category, label
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        ).fetchone()
        environment_sheet = connection.execute(
            """
            SELECT system_prompt_template, version, image_input_json, rules_json, input_variables_json, custom_fields_json, output_format, category, label
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-environment-sheet-v1",),
        ).fetchone()
        environment_plate = connection.execute(
            """
            SELECT system_prompt_template, image_analysis_prompt, version, image_input_json, rules_json, input_variables_json, custom_fields_json, output_format, category, label
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-environment-plate-v1",),
        ).fetchone()

    assert {row["preset_id"] for row in preset_rows} == MEDIA_PRESET_SEED_IDS
    assert {row["recipe_id"] for row in recipe_rows} == PROMPT_RECIPE_SEED_IDS
    assert caricature is not None
    assert image_director is not None
    assert storyboard_v2 is not None
    assert storyboard_continuation is not None
    assert food_storyboard is not None
    assert seedance_storyboard_video is not None
    assert environment_sheet is not None
    assert environment_plate is not None

    assert "gpt-image-2-image-to-image" in json.loads(caricature["applies_to_models_json"])
    assert json.loads(caricature["input_schema_json"])[0]["key"] == "subject_style"
    assert json.loads(caricature["input_slots_json"])[0]["key"] == "person"

    image_director_variables = json.loads(image_director["input_variables_json"])
    assert [variable["key"] for variable in image_director_variables] == [
        "user_prompt",
        "source_prompt",
        "image_analysis",
        "style_direction",
        "aspect_ratio",
    ]
    assert json.loads(image_director["image_input_json"])["analysis_variable"] == "image_analysis"
    assert json.loads(image_director["rules_json"])["return_only_final_output"] is True
    assert image_director["source_kind"] == "builtin"

    storyboard_template = storyboard_v2["system_prompt_template"]
    storyboard_v2_variables = json.loads(storyboard_v2["input_variables_json"])
    assert storyboard_v2["version"] == "2.28"
    storyboard_v2_image_input = json.loads(storyboard_v2["image_input_json"])
    assert storyboard_v2_image_input["mode"] == "direct_reference"
    assert storyboard_v2_image_input["reference_roles"] == ["character", "environment"]
    assert json.loads(storyboard_v2["rules_json"])["storyboard_stage"] == "stills_only"
    assert [variable["key"] for variable in storyboard_v2_variables] == [
        "user_prompt",
        "previous_output",
        "style_direction",
        "shot_count",
        "aspect_ratio",
        "dialogue_mode",
    ]
    assert "readable metadata strip below the image" in storyboard_template
    assert "photoreal live-action feature-film production still" in storyboard_template
    assert "photographed on a physical set with real lens optics" in storyboard_template
    assert "pencil-sketch" not in storyboard_template
    assert "inked concept-art" not in storyboard_template
    assert "SHOT appears exactly once as the panel heading above the image" in storyboard_template
    assert "five separate horizontal rows stacked vertically" in storyboard_template
    assert "CAMERA, ACTION, MOTION, DIALOG, NOTES" in storyboard_template
    assert "Never render metadata as side-by-side columns" in storyboard_template
    assert "SHOT, CAMERA, ACTION, MOTION, DIALOG, NOTES" in storyboard_template
    assert "shot size and subject placement on the same row" in storyboard_template
    assert "what the character, important prop, creature, vehicle, or scene element is doing" in storyboard_template
    assert "leave the value after the colon truly empty when there is no spoken line" in storyboard_template
    assert "DIALOGUE MODE" in storyboard_template
    assert "medium dialogue, cinematic dialogue, full dialogue" in storyboard_template
    assert "a dash, an em dash, a hyphen" in storyboard_template
    assert "actual quoted speech text" in storyboard_template
    assert "For full dialogue, every DIALOG value should be actual quoted speech text" in storyboard_template
    assert "DIALOGUE CUES" in storyboard_template
    assert "speaker label" in storyboard_template
    assert "voice hint" in storyboard_template
    assert "Include a subtle footer" not in storyboard_template
    assert "Do not add a page footer" in storyboard_template
    assert "Choose one neutral subject label for the recurring lead" in storyboard_template
    assert "Do not put a personal name into storyboard action or metadata rows" in storyboard_template
    assert "Use neutral subject labels in visible metadata instead of personal names" in storyboard_template
    assert "identity-like references control identity" in storyboard_template
    assert "CONNECTED TYPED REFERENCE ROLES" in storyboard_template
    assert "use that role map as the only source of truth" in storyboard_template
    assert "[image reference N] and @imageN are aliases for the same ordered image input" in storyboard_template
    assert "Do not assume a fixed character/environment/storyboard slot number" in storyboard_template
    assert "use it for spatial continuity only" in storyboard_template
    assert "Never use an Environment Sheet for face, body, wardrobe" in storyboard_template
    assert "When no Environment Sheet or location reference is connected" in storyboard_template
    assert "preserve its room geography, landmarks, material palette" in storyboard_template
    food_storyboard_template = food_storyboard["system_prompt_template"]
    food_storyboard_variables = json.loads(food_storyboard["input_variables_json"])
    assert food_storyboard["version"] == "1.1"
    assert food_storyboard["output_format"] == "single_prompt"
    assert json.loads(food_storyboard["image_input_json"]) == {
        "enabled": True,
        "required": True,
        "mode": "both",
        "analysis_variable": "image_analysis",
        "max_files": 1,
    }
    assert json.loads(food_storyboard["rules_json"])["storyboard_stage"] == "stills_only"
    assert [variable["key"] for variable in food_storyboard_variables] == [
        "food_item",
        "storyboard_title",
        "user_prompt",
        "frame_count",
        "target_duration_seconds",
        "dialogue_mode",
        "visual_style",
        "image_analysis",
    ]
    assert "Use [image reference 1] as the recurring host or character continuity reference" in food_storyboard_template
    assert "Do not treat the reference image as the desired storyboard layout" in food_storyboard_template
    assert "PROCEDURAL COOKING ARC" in food_storyboard_template
    assert "at least two distinct preparation panels" in food_storyboard_template
    assert "at least two distinct cooking/transformation panels" in food_storyboard_template
    assert "Every major ingredient named by FOOD ITEM or COOKING / STORY BRIEF" in food_storyboard_template
    assert "COOKING SHOW BEAT PLANNER" in food_storyboard_template
    assert "infer the practical cooking steps needed for FOOD ITEM" in food_storyboard_template
    assert "A setup ACTION should name the visible main ingredient" in food_storyboard_template
    assert "A preparation ACTION should name the specific ingredient being cut" in food_storyboard_template
    assert "A cooking ACTION should name what is heating" in food_storyboard_template
    assert "FRAME-TO-FRAME FLOW" in food_storyboard_template
    assert "left-to-right and top-to-bottom as one continuous cooking-show sequence" in food_storyboard_template
    assert "Do not teleport food states" in food_storyboard_template
    assert "STORYBOARD CONTINUITY CHECKLIST" in food_storyboard_template
    assert "what changed since the previous frame" in food_storyboard_template
    assert "what ingredient or tool is active" in food_storyboard_template
    assert "If a panel does not advance cooking, story, tone, or payoff" in food_storyboard_template
    assert "Treat COOKING / STORY BRIEF as the source of mood, humor, pacing, genre, and character behavior" in food_storyboard_template
    assert "the storyboard must visibly express that tone instead of flattening it into a generic cooking tutorial" in food_storyboard_template
    assert "SHOT:" in food_storyboard_template
    assert "CAMERA:" in food_storyboard_template
    assert "ACTION:" in food_storyboard_template
    assert "DIALOGUE:" in food_storyboard_template
    assert "CONTINUITY:" in food_storyboard_template
    assert "five separate horizontal rows stacked vertically" in food_storyboard_template
    assert "Never render metadata as side-by-side columns" in food_storyboard_template
    assert "Do not add MOTION, NOTES, FRAMING" in food_storyboard_template
    assert "Choose one neutral subject label for the recurring person" in food_storyboard_template
    assert "Derive a compact ingredient/tool inventory from FOOD ITEM" in food_storyboard_template
    assert "The panel text must describe visible state accurately" in food_storyboard_template
    assert "Each panel should be one clean staged shot, not a montage or collage" in food_storyboard_template
    assert "Every panel must read as one physically coherent staged shot" in food_storyboard_template
    assert "Maintain believable anatomy, connected body mechanics" in food_storyboard_template
    assert "ACTION: a compact frame-local mini prompt" in food_storyboard_template
    assert "Every ACTION row must work as a tiny visual prompt for that panel" in food_storyboard_template
    assert "laying out the dish ingredients" in food_storyboard_template
    assert "cutting a named ingredient on a board" in food_storyboard_template
    assert "preserve the row labels exactly as SHOT, CAMERA, ACTION, DIALOGUE, and CONTINUITY" in food_storyboard_template
    assert "METADATA LEGIBILITY MODE" in food_storyboard_template
    assert "Use simple uppercase labels, high contrast text, horizontal baselines, and generous spacing" in food_storyboard_template
    assert "shorten the values, not the labels" in food_storyboard_template
    assert "Visible panel metadata should refer to the recurring person as host" in food_storyboard_template
    assert "Do not put the host's name into ACTION, DIALOGUE, CONTINUITY" in food_storyboard_template
    assert "Do not show a finished or plated dish before the preparation and cooking steps" in food_storyboard_template
    assert "Avoid replacing preparation beats with generic smiling, posing, presenting, or reaction shots" in food_storyboard_template
    assert "VISUAL CONSISTENCY CHECK" in food_storyboard_template
    assert "ACTION must describe only what is visible in that panel" in food_storyboard_template
    assert "Always keep the DIALOGUE row label and spell it exactly as DIALOGUE" in food_storyboard_template
    assert "Dialogue must follow the tone requested by COOKING / STORY BRIEF" in food_storyboard_template
    assert "ramen" not in food_storyboard_template.lower()

    environment_sheet_template = environment_sheet["system_prompt_template"]
    environment_sheet_variables = json.loads(environment_sheet["input_variables_json"])
    environment_sheet_image_input = json.loads(environment_sheet["image_input_json"])
    environment_sheet_rules = json.loads(environment_sheet["rules_json"])
    assert environment_sheet["label"] == "Environment Sheet v1"
    assert environment_sheet["category"] == "image"
    assert environment_sheet["version"] == "1"
    assert environment_sheet["output_format"] == "single_prompt"
    assert [variable["key"] for variable in environment_sheet_variables] == [
        "user_prompt",
        "image_analysis",
    ]
    assert [field["key"] for field in json.loads(environment_sheet["custom_fields_json"])] == [
        "environment_name",
        "environment_type",
        "key_zones",
        "mood_lighting",
        "action_requirements",
        "vfx_or_state_variants",
        "layout_mode",
    ]
    assert environment_sheet_image_input == {
        "enabled": True,
        "required": False,
        "mode": "both",
        "analysis_variable": "image_analysis",
        "max_files": 4,
        "reference_roles": ["environment", "generic"],
    }
    assert environment_sheet_rules["environment_sheet_stage"] == "stills_only"
    assert "Environment Sheet v1 prompt compiler" in environment_sheet_template
    assert "Build the prompt around the environment, not around a character" in environment_sheet_template
    assert "hero establishing view" in environment_sheet_template
    assert "wide/front, side, reverse, and overhead or map-like views" in environment_sheet_template
    assert "key zone callouts" in environment_sheet_template
    assert "continuity anchors" in environment_sheet_template
    assert "movement and staging notes" in environment_sheet_template
    assert "If no reference images are present" in environment_sheet_template
    assert "Do not use environment references as character identity sources" in environment_sheet_template
    assert "hotel lobby" not in environment_sheet_template.lower()
    assert "sadi" not in environment_sheet_template.lower()
    assert "gpt image" not in environment_sheet_template.lower()
    assert "provider names" in environment_sheet_template

    environment_plate_template = environment_plate["system_prompt_template"]
    environment_plate_variables = json.loads(environment_plate["input_variables_json"])
    environment_plate_image_input = json.loads(environment_plate["image_input_json"])
    environment_plate_rules = json.loads(environment_plate["rules_json"])
    assert environment_plate["label"] == "Environment Plate v1.2"
    assert environment_plate["category"] == "image"
    assert environment_plate["version"] == "1.2"
    assert environment_plate["output_format"] == "single_prompt"
    assert [variable["key"] for variable in environment_plate_variables] == [
        "user_prompt",
        "image_analysis",
    ]
    assert [field["key"] for field in json.loads(environment_plate["custom_fields_json"])] == [
        "environment_name",
        "environment_type",
        "camera_view",
        "mood_lighting",
        "action_lanes",
    ]
    assert environment_plate_image_input == {
        "enabled": True,
        "required": False,
        "mode": "both",
        "analysis_variable": "image_analysis",
        "max_files": 4,
        "reference_roles": ["environment", "generic"],
    }
    assert environment_plate_rules["environment_plate_stage"] == "concise_photo_plate"
    assert environment_plate_rules["target_word_count_min"] == 40
    assert environment_plate_rules["target_word_count_max"] == 75
    assert environment_plate_rules["style_priority"] == "real_camera_before_genre"
    assert environment_plate_rules["genre_handling"] == "physical_set_content"
    assert "Environment Plate v1.2 prompt compiler" in environment_plate_template
    assert "Write 40 to 75 words in one paragraph" in environment_plate_template
    assert "Treat fantasy, science fiction, western, horror, historical" in environment_plate_template
    assert "Do not replace specific genre content with a generic room" in environment_plate_template
    assert "Do not add surface aging, dust, dampness, reflections, microcontrast" in environment_plate_template
    assert "Do not add a negative list" in environment_plate_template
    assert "one uninterrupted, character-free camera plate" in environment_plate_template
    assert "Do not create a presentation board, reference sheet, collage" in environment_plate_template
    assert "labels, callouts, UI, story action, or dialogue" in environment_plate_template
    assert "photorealistic frame captured on a real camera" in environment_plate_template
    assert "Preserve distinctive fantasy, science-fiction, historical, western, horror" in environment_plate["image_analysis_prompt"]
    assert "hotel lobby" not in environment_plate_template.lower()
    assert "sadi" not in environment_plate_template.lower()
    assert "gpt image" not in environment_plate_template.lower()

    seedance_template = seedance_storyboard_video["system_prompt_template"]
    seedance_variables = json.loads(seedance_storyboard_video["input_variables_json"])
    seedance_image_input = json.loads(seedance_storyboard_video["image_input_json"])
    seedance_rules = json.loads(seedance_storyboard_video["rules_json"])
    assert seedance_storyboard_video["label"] == "Seedance Storyboard Video Director v1"
    assert seedance_storyboard_video["category"] == "video"
    assert seedance_storyboard_video["version"] == "1.3"
    assert seedance_storyboard_video["output_format"] == "single_prompt"
    assert [variable["key"] for variable in seedance_variables] == [
        "source_prompt",
        "user_prompt",
        "duration_seconds",
        "aspect_ratio",
        "dialogue_mode",
        "style_direction",
        "reference_layout",
    ]
    assert seedance_image_input == {
        "enabled": False,
        "required": False,
        "mode": "none",
        "analysis_variable": "image_analysis",
        "max_files": 0,
    }
    assert seedance_rules["video_stage"] == "seedance_prompt_only"
    assert seedance_rules["requires_ordered_image_refs"] is True
    assert "character_storyboard: @image1 = approved character sheet / character continuity lock; @image2 = approved storyboard sheet" in seedance_template
    assert "character_environment_storyboard: @image1 = approved character sheet / character continuity lock; @image2 = approved environment sheet" in seedance_template
    assert "do not mention @image3" in seedance_template
    assert "readable shot/action notes" in seedance_template
    assert "This recipe does not need to analyze the images itself" in seedance_template
    assert "The downstream Seedance node must receive the exact ordered references declared by REFERENCE LAYOUT" in seedance_template
    assert "Do not use [image reference 1], [image reference 2], or [image reference 3] in the final prompt" in seedance_template
    assert "STORYBOARD PROMPT TEXT" in seedance_template
    assert "Use TARGET DURATION SECONDS as the exact total video duration" in seedance_template
    assert "Return only the final Seedance 2.0 prompt" in seedance_template
    assert "Treat metadata-rich production storyboards and image-dominant scene-number-only storyboards as equally complete inputs" in seedance_template
    assert "do not require metadata rows" in seedance_template
    assert "do not turn scene-number badges into overlays, timecodes, or dialogue" in seedance_template
    assert "without copying the board title, production strip, row labels, captions, or notes as visible video text" in seedance_template
    assert "SUBJECT LABEL RULES" in seedance_template
    assert "Identity must come from @image1, not from the name text" in seedance_template
    assert "For a 15-second video, prefer 6-8 strong contiguous beats" in seedance_template
    assert "In character_storyboard, use @image1 for character continuity and @image2 for storyboard continuity" in seedance_template
    assert "In character_environment_storyboard, use @image1 for character continuity, @image2 for environment continuity, and @image3 for storyboard continuity" in seedance_template
    assert "SUBJECT LABEL: Define the recurring lead with one neutral label" in seedance_template
    assert "use neutral subject labels instead of personal names" in seedance_template
    assert "FORMAT: A {{duration_seconds}}-second Seedance 2.0 video" not in seedance_template
    assert "Do not waste prompt space restating execution wrapper details" in seedance_template
    assert "camera-action metadata" not in seedance_template
    assert "metadata-derived video directions" not in seedance_template

    assert "build a hidden continuity ledger" in storyboard_template
    assert "Treat PREVIOUS BOARD HANDOFF as private continuity state" in storyboard_template
    assert "Do not copy prior-board visible titles, footers, project names, character names" in storyboard_template
    assert "Props must move through clear states: seen -> reachable -> obtained -> used" in storyboard_template
    assert "first show the restraint weakness" in storyboard_template
    assert "Do not jump from a problem state to a solved state" in storyboard_template
    assert "reserve one panel or a clear ACTION/MOTION/NOTES bridge" in storyboard_template
    assert "OPTIONAL TEMPORAL EFFECT RULE PACK" in storyboard_template
    assert "Use time-freeze rules only when USER STORY BRIEF explicitly requests" in storyboard_template
    assert "For all other stories, do not mention time freeze" in storyboard_template
    assert "TIME-FREEZE STATE CONTINUITY" not in storyboard_template
    assert "PROVIDER-SAFE ACTION LANGUAGE" in storyboard_template
    assert "Prefer wording like disarms, disables, escapes" in storyboard_template
    assert "04 - DECISIVE ACTION / CAUSAL BRIDGE" in storyboard_template
    assert "Do not omit the SHOT / CAMERA / ACTION / MOTION / DIALOG / NOTES director-note structure" in storyboard_template
    assert "Do not append STORY BEATS" in storyboard_template

    continuation_template = storyboard_continuation["system_prompt_template"]
    continuation_variables = json.loads(storyboard_continuation["input_variables_json"])
    assert storyboard_continuation["version"] == "1.21"
    assert storyboard_continuation["output_format"] == "single_prompt"
    assert json.loads(storyboard_v2["output_contract_json"]) == json.loads(
        storyboard_continuation["output_contract_json"]
    )
    storyboard_display_contract = json.loads(storyboard_v2["output_contract_json"])["storyboard_metadata"]
    storyboard_layout_contract = json.loads(storyboard_v2["output_contract_json"])["storyboard_layout"]
    assert storyboard_layout_contract == {
        "shot_count_source": "shot_count",
        "supported_grids": {"4": "2x2", "6": "3x2", "9": "3x3"},
    }
    assert storyboard_display_contract["visible_rows"] == ["CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES"]
    assert storyboard_display_contract["shot_placement"] == "panel_heading_only"
    assert storyboard_display_contract["max_characters"] == {
        "SHOT": 64,
        "CAMERA": 136,
        "ACTION": 136,
        "MOTION": 136,
        "DIALOG": 160,
        "NOTES": 140,
    }
    assert json.loads(storyboard_v2["default_options_json"]) == json.loads(
        storyboard_continuation["default_options_json"]
    )
    for semantic_role_clause in (
        "ACTION states what the subject or scene element does",
        "MOTION states camera, subject, environmental, rhythm, VFX, or transformation movement over time",
        "NOTES states a concise continuity, state, emotion, VFX, or handoff requirement",
        "Keep all three values semantically distinct",
        "Never omit a required value, copy one row into another",
        "FINAL METADATA AUDIT",
        "count exactly one SHOT heading and one CAMERA, ACTION, MOTION, DIALOG, and NOTES row",
        "author a concise panel-specific NOTES value from the user-owned brief",
    ):
        assert semantic_role_clause in storyboard_template
        assert semantic_role_clause in continuation_template
    shared_sheet_contract = "IMMUTABLE STORYBOARD V2 SHEET CONTRACT"
    assert storyboard_template.count(shared_sheet_contract) == 1
    assert continuation_template.count(shared_sheet_contract) == 1
    assert [variable["key"] for variable in continuation_variables] == [
        "previous_storyboard_prompt",
        "continuation_brief",
        "segment_number",
        "total_segments",
        "target_duration_seconds",
        "panel_count",
        "dialogue_mode",
        "style_direction",
    ]
    continuation_image_input = json.loads(storyboard_continuation["image_input_json"])
    assert continuation_image_input["required"] is True
    assert continuation_image_input["mode"] == "direct_reference"
    assert continuation_image_input["max_files"] == 6
    assert continuation_image_input["reference_roles"] == ["character", "environment", "storyboard", "additional"]
    assert json.loads(storyboard_continuation["rules_json"])["storyboard_stage"] == "stills_only"
    assert "[image reference N] and @imageN are aliases for the same ordered image input" in continuation_template
    assert "Do not assume that a particular slot number always means character" in continuation_template
    assert "Storyboard references control prior panel order" in continuation_template
    assert "compatibility-fallback previous-board reference" in continuation_template
    assert "where the prior board ended" in continuation_template and "layout" in continuation_template
    assert "photoreal live-action feature-film production still" in continuation_template
    assert "photographed on a physical set with real lens optics" in continuation_template
    assert "not scene content to duplicate" in continuation_template
    assert "PREVIOUS STORYBOARD PROMPT OR HANDOFF" in continuation_template
    assert "CONTINUATION BRIEF" in continuation_template
    assert "HANDOFF ADVANCE" in continuation_template
    assert "DIALOGUE CUES" in continuation_template
    assert "must not duplicate" in continuation_template
    assert "camera angle, framing, lens, or movement" in continuation_template
    assert "Do not add a page footer" in continuation_template
    assert "End with a clear visual handoff into the next storyboard segment" in continuation_template
    assert "Choose one neutral subject label for the recurring lead" in continuation_template
    assert "Do not put a personal name into storyboard action or metadata rows" in continuation_template
    assert "Every major state change must be earned" in continuation_template
    assert "Build a hidden state ledger" in continuation_template
    assert "Props must move through clear states: seen -> reachable -> obtained -> used" in continuation_template
    assert "medium or cinematic" in continuation_template
    assert "a dash, an em dash, a hyphen" in continuation_template
    assert "without parenthetical silence" in continuation_template
    assert "PROVIDER-SAFE ACTION LANGUAGE" in continuation_template
    assert "Keep violence implied, stylized, readable, and production-safe" in continuation_template
    assert "Use SHOT once as the heading above each image: a two-digit number and short title" in continuation_template
    assert "DIALOG: exact requested dialogue" in continuation_template
    assert "DIALOG alone may have a blank value" in storyboard_template
    assert "DIALOG alone may have a blank value" in continuation_template
    assert "SHOT, CAMERA, ACTION, MOTION, and NOTES must each contain a complete non-placeholder value" in storyboard_template
    assert "SHOT, CAMERA, ACTION, MOTION, and NOTES must each contain a complete non-placeholder value" in continuation_template
    assert "five separate horizontal rows stacked vertically" in continuation_template
    assert "Never render metadata as side-by-side columns" in continuation_template
    assert "Seedance/video instructions" in continuation_template
    for stable_layout_clause in (
        "16:9",
        "3x2 grid",
        "dark near-black",
        "thin yellow-orange UI lines",
        "SHOT",
        "CAMERA",
        "ACTION",
        "MOTION",
        "DIALOG",
    ):
        assert stable_layout_clause in storyboard_template
        assert stable_layout_clause in continuation_template

    assert [field["key"] for field in json.loads(storyboard_v2["custom_fields_json"])] == [
        "board_title",
        "production_metadata",
        "dialogue_cues",
        "wardrobe_cues",
        "subject_design_cues",
        "panel_notes_cues",
    ]
    assert [field["key"] for field in json.loads(storyboard_continuation["custom_fields_json"])] == [
        "handoff_advance",
        "board_title",
        "production_metadata",
        "dialogue_cues",
        "wardrobe_cues",
        "subject_design_cues",
        "panel_notes_cues",
    ]
    assert "{{board_title}}" in storyboard_template
    assert "{{production_metadata}}" in storyboard_template
    assert "{{board_title}}" in continuation_template
    assert "{{production_metadata}}" in continuation_template
    assert "{{panel_notes_cues}}" in storyboard_template
    assert "{{panel_notes_cues}}" in continuation_template
    assert "reproduce each supplied note verbatim as that panel's NOTES value" in storyboard_template
    assert "reproduce each supplied note verbatim as that panel's NOTES value" in continuation_template
    assert "Never copy the previous board's title or visible sequence number" in continuation_template
    storyboard_director_template = next(
        row["system_prompt_template"]
        for row in recipe_rows
        if row["recipe_id"] == "prompt-recipe-storyboard-director-3x3"
    )
    assert "six separate horizontal rows stacked vertically" in storyboard_director_template
    assert "Never render metadata as side-by-side columns" in storyboard_director_template
