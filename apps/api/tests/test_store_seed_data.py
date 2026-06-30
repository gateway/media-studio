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
    "prompt-recipe-storyboard-shot-sequence-3x3",
    "prompt-recipe-storyboard-v2-gpt-image-2",
    "prompt-recipe-storyboard-continuation-v1",
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
            SELECT system_prompt_template, version, image_input_json, rules_json, input_variables_json
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        ).fetchone()
        storyboard_continuation = connection.execute(
            """
            SELECT system_prompt_template, version, image_input_json, rules_json, input_variables_json, output_format
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-storyboard-continuation-v1",),
        ).fetchone()

    assert {row["preset_id"] for row in preset_rows} == MEDIA_PRESET_SEED_IDS
    assert {row["recipe_id"] for row in recipe_rows} == PROMPT_RECIPE_SEED_IDS
    assert caricature is not None
    assert image_director is not None
    assert storyboard_v2 is not None
    assert storyboard_continuation is not None

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
    assert storyboard_v2["version"] == "2.7"
    assert json.loads(storyboard_v2["image_input_json"])["mode"] == "direct_reference"
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
    assert "SHOT, CAMERA, FRAMING, ACTION, MOTION, DIALOG" in storyboard_template
    assert "what the character, important prop, creature, vehicle, or scene element is doing" in storyboard_template
    assert "leave the value after the colon truly empty when there is no spoken line" in storyboard_template
    assert "DIALOGUE MODE" in storyboard_template
    assert "medium dialogue, cinematic dialogue, full dialogue" in storyboard_template
    assert "a dash, an em dash, a hyphen" in storyboard_template
    assert "actual quoted speech text" in storyboard_template
    assert "For full dialogue, every DIALOG value should be actual quoted speech text" in storyboard_template
    assert "build a hidden continuity ledger" in storyboard_template
    assert "Props must move through clear states: seen -> reachable -> obtained -> used" in storyboard_template
    assert "first show the restraint weakness" in storyboard_template
    assert "Do not jump from a problem state to a solved state" in storyboard_template
    assert "reserve one panel or a clear ACTION/MOTION/NOTES bridge" in storyboard_template
    assert "PROVIDER-SAFE ACTION LANGUAGE" in storyboard_template
    assert "Prefer wording like disarms, disables, escapes" in storyboard_template
    assert "04 - DECISIVE ACTION / CAUSAL BRIDGE" in storyboard_template
    assert "Do not omit the SHOT / CAMERA / FRAMING / ACTION / MOTION / DIALOG director-note structure" in storyboard_template

    continuation_template = storyboard_continuation["system_prompt_template"]
    continuation_variables = json.loads(storyboard_continuation["input_variables_json"])
    assert storyboard_continuation["version"] == "1.5"
    assert storyboard_continuation["output_format"] == "single_prompt"
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
    assert json.loads(storyboard_continuation["rules_json"])["storyboard_stage"] == "stills_only"
    assert "[image reference 1] = approved character sheet" in continuation_template
    assert "[image reference 2] = previous storyboard sheet output" in continuation_template
    assert "PREVIOUS STORYBOARD PROMPT OR HANDOFF" in continuation_template
    assert "CONTINUATION BRIEF" in continuation_template
    assert "End with a clear visual handoff into the next storyboard segment" in continuation_template
    assert "Every major state change must be earned" in continuation_template
    assert "Build a hidden state ledger" in continuation_template
    assert "Props must move through clear states: seen -> reachable -> obtained -> used" in continuation_template
    assert "medium or cinematic" in continuation_template
    assert "a dash, an em dash, a hyphen" in continuation_template
    assert "without parenthetical silence" in continuation_template
    assert "PROVIDER-SAFE ACTION LANGUAGE" in continuation_template
    assert "Keep violence implied, stylized, readable, and production-safe" in continuation_template
    assert "SHOT: two-digit number and short title" in continuation_template
    assert "DIALOG: exact requested dialogue" in continuation_template
    assert "Seedance/video instructions" in continuation_template
