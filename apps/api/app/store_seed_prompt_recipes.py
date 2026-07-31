from __future__ import annotations

import sqlite3
from typing import Any, Dict

from .graph.storyboard_trilogy_quality import (
    stacked_metadata_layout_instruction,
    storyboard_v2_sheet_contract_instruction,
)
from .graph.storyboard_sheet_spec import STORYBOARD_METADATA_DISPLAY_LIMITS
from .store_support import insert_or_update, utcnow_iso


def _prompt_recipe_variable(
    key: str,
    label: str,
    *,
    required: bool = False,
    default_value: str = "",
    description: str = "",
) -> Dict[str, Any]:
    return {
        "key": key,
        "token": "{{%s}}" % key,
        "label": label,
        "enabled": True,
        "required": required,
        "default_value": default_value,
        "description": description,
    }


def _prompt_recipe_custom_field(
    key: str,
    label: str,
    *,
    field_type: str = "text",
    required: bool = False,
    default_value: str = "",
    help_text: str = "",
    placeholder: str = "",
    input_kind: str = "none",
    reference_role: str = "none",
) -> Dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "type": field_type,
        "placeholder": placeholder,
        "default_value": default_value,
        "required": required,
        "help_text": help_text,
        "options": [],
        "input_kind": input_kind,
        "reference_role": reference_role,
    }


def _storyboard_user_cue_fields(*, story_source: str, dialogue_placeholder: str) -> list[Dict[str, Any]]:
    return [
        _prompt_recipe_custom_field(
            "dialogue_cues",
            "Dialogue Cues",
            field_type="textarea",
            default_value=f"No dialogue cues provided; use only exact lines and speaker details in the {story_source}.",
            help_text="Optional user-authored speaker, voice hint, exact line, and panel/beat assignments.",
            placeholder=dialogue_placeholder,
        ),
        _prompt_recipe_custom_field(
            "wardrobe_cues",
            "Wardrobe Cues",
            field_type="textarea",
            default_value=f"No separate wardrobe cues provided; use only wardrobe details in the {story_source} or approved character reference.",
            help_text="Optional user-authored garment and coverage continuity requirements.",
            placeholder="Describe the exact user-owned wardrobe continuity lock.",
        ),
        _prompt_recipe_custom_field(
            "subject_design_cues",
            "Subject Design Cues",
            field_type="textarea",
            default_value=f"No separate subject design cues provided; use only subject details in the {story_source} and approved references.",
            help_text="Optional user-authored design constraints for characters, creatures, robots, vehicles, or props.",
            placeholder="Describe the exact subject design traits that must remain visible.",
        ),
        _prompt_recipe_custom_field(
            "panel_notes_cues",
            "Panel Notes Cues",
            field_type="textarea",
            default_value=f"No explicit per-panel notes supplied; derive distinct production notes only from the {story_source}.",
            help_text="Optional user-authored PANEL NN continuity, state, emotion, VFX, or handoff notes. These exact values override generated NOTES rows.",
            placeholder="PANEL 01 — Preserve the established location state.\nPANEL 02 — Keep the carried prop in the subject's right hand.",
        ),
    ]


def _storyboard_board_identity_fields(*, story_source: str) -> list[Dict[str, Any]]:
    return [
        _prompt_recipe_custom_field(
            "board_title",
            "Board Title",
            default_value=f"Derive a concise board-specific title from the {story_source}.",
            help_text="User-owned visible title for this board; include the board number when exact visible numbering matters.",
            placeholder="BOARD 2 OF 3 — concise board-specific title",
        ),
        _prompt_recipe_custom_field(
            "production_metadata",
            "Production Metadata",
            field_type="textarea",
            default_value=f"Derive concise neutral production-strip values from the {story_source}.",
            help_text="User-owned PROJECT, SEQUENCE, LOCATION, DATE, and ARTIST values; omit any value the user does not provide.",
            placeholder="PROJECT: …; SEQUENCE: …; LOCATION: …; DATE: …; ARTIST: …",
        ),
    ]


def _storyboard_v2_output_contract() -> Dict[str, Any]:
    return {
        "type": "text",
        "description": "A single Storyboard v2 image-generation prompt.",
        "storyboard_layout": {
            "shot_count_source": "shot_count",
            "supported_grids": {"4": "2x2", "6": "3x2", "9": "3x3"},
        },
        "storyboard_metadata": {
            "labels": ["SHOT", "CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES"],
            "required_non_empty": ["SHOT", "CAMERA", "ACTION", "MOTION", "NOTES"],
            "allow_blank": ["DIALOG"],
            "shot_placement": "panel_heading_only",
            "visible_rows": ["CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES"],
            "max_characters": dict(STORYBOARD_METADATA_DISPLAY_LIMITS),
        },
    }


def seed_default_prompt_recipes(connection: sqlite3.Connection) -> None:
    now = utcnow_iso()
    seed_rows = [
        {
            "recipe_id": "prompt-recipe-storyboard-director-3x3",
            "key": "storyboard-director-3x3",
            "label": "Storyboard Director - 3x3 Grid",
            "description": "Turns a creative brief and optional ordered references into one polished 3x3 storyboard-sheet image prompt.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are an expert cinematic storyboard director and image prompt writer.\n\n"
                "Transform the creative brief into one polished image-generation prompt for a professional storyboard sheet.\n\n"
                "CREATIVE BRIEF:\n{{user_prompt}}\n\n"
                "SOURCE PROMPT:\n{{source_prompt}}\n\n"
                "REFERENCE ANALYSIS:\n{{image_analysis}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "ASPECT RATIO:\n{{aspect_ratio}}\n\n"
                "Create a final prompt for a clean 16:9 storyboard image.\n"
                "Default format: a cinematic 3x3 grid of nine panels with clear borders, readable panel numbers, and a compact metadata block below each panel.\n"
                f"{stacked_metadata_layout_instruction()}\n\n"
                "The final prompt must include the main subject, setting and atmosphere, visual style, a clear storyboard title, panel-by-panel action progression, "
                "camera variety, and continuity of character, wardrobe, props, lighting, and mood across all nine panels.\n"
                "If references are provided, preserve the relevant identity, face, body, styling, product, or scene details consistently across every panel.\n\n"
                "Return only the final image-generation prompt. Do not explain. Do not use markdown."
            ),
            "image_analysis_prompt": "Describe this image for use as a character or scene reference. Focus on identity, pose, clothing, lighting, camera angle, setting, and consistency details.",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A single 3x3 storyboard image prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "User Prompt", required=True, description="Creative direction supplied by the user."),
                _prompt_recipe_variable("source_prompt", "Source Prompt", default_value="No source prompt provided.", description="Optional upstream prompt or prior direction to preserve."),
                _prompt_recipe_variable("image_analysis", "Image Analysis", default_value="No reference images provided.", description="Optional description of connected reference images."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="cinematic realism", description="Short style or genre direction."),
                _prompt_recipe_variable("aspect_ratio", "Aspect Ratio", default_value="16:9", description="Target storyboard aspect ratio."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": False, "mode": "both", "analysis_variable": "image_analysis", "max_files": 4},
            "default_options_json": {"temperature": 0.35, "max_output_tokens": 1800, "strict_output": True},
            "rules_json": {"return_only_final_output": True, "allow_markdown": False, "allow_external_variables": True},
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1.1",
            "priority": 500,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-image-prompt-director",
            "key": "image-prompt-director",
            "label": "Image Prompt Director",
            "description": "Expands a creative brief and optional ordered references into one production-ready image prompt.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are a senior image prompt director.\n\n"
                "Turn the creative brief into one final image-generation prompt that is visually specific, production-ready, and internally consistent.\n\n"
                "USER PROMPT:\n{{user_prompt}}\n\n"
                "SOURCE PROMPT:\n{{source_prompt}}\n\n"
                "REFERENCE ANALYSIS:\n{{image_analysis}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "ASPECT RATIO:\n{{aspect_ratio}}\n\n"
                "If references are provided, preserve the important identity, styling, product, or scene details while making the output feel intentional rather than descriptive.\n\n"
                "Return only the final prompt. Do not explain. Do not use markdown."
            ),
            "image_analysis_prompt": "Describe the provided reference images for downstream prompt generation. Focus on identity, styling, composition, lighting, environment, props, and continuity details that should be preserved.",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A single image prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "User Prompt", required=True, description="Creative direction supplied by the user."),
                _prompt_recipe_variable("source_prompt", "Source Prompt", default_value="No source prompt provided.", description="Optional prompt to preserve or rewrite."),
                _prompt_recipe_variable("image_analysis", "Image Analysis", default_value="No reference images provided.", description="Reference-image analysis injected by the graph runtime."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="cinematic realism", description="Short style or genre direction."),
                _prompt_recipe_variable("aspect_ratio", "Aspect Ratio", default_value="1:1", description="Target image aspect ratio."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": False, "mode": "both", "analysis_variable": "image_analysis", "max_files": 4},
            "default_options_json": {"temperature": 0.4, "max_output_tokens": 1500, "strict_output": True},
            "rules_json": {"return_only_final_output": True, "allow_markdown": False, "allow_external_variables": True},
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1",
            "priority": 490,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-video-director-multi-shot-json",
            "key": "video-director-multi-shot-json",
            "label": "Video Director - Multi Shot JSON",
            "description": "Creates a structured set of video prompts for multiple shots from a brief and optional ordered references.",
            "category": "video",
            "status": "active",
            "system_prompt_template": (
                "You are a cinematic video director.\n\n"
                "Convert the creative brief into {{shot_count}} coherent video shots that feel like one sequence.\n\n"
                "USER PROMPT:\n{{user_prompt}}\n\n"
                "SOURCE PROMPT:\n{{source_prompt}}\n\n"
                "REFERENCE ANALYSIS:\n{{image_analysis}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "DURATION PER SHOT:\n{{duration_seconds}}\n\n"
                "Return strict JSON with a `shots` array. Each shot must include `shot_number`, `title`, `duration_seconds`, `camera`, `action`, `motion`, "
                "`continuity_notes`, and a strong final `prompt` for video generation. Preserve identity and continuity across the whole batch."
            ),
            "image_analysis_prompt": "Describe the image as video source material, focusing on subject identity, setting, camera angle, motion potential, and continuity details.",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "structured_shot_sequence",
            "output_contract_json": {
                "type": "object",
                "required": ["shots"],
                "properties": {
                    "shots": {
                        "type": "array",
                        "items": {"type": "object", "required": ["shot_number", "duration_seconds", "prompt", "camera", "action"]},
                    }
                },
            },
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "User Prompt", required=True, description="Creative direction supplied by the user."),
                _prompt_recipe_variable("source_prompt", "Source Prompt", default_value="No source prompt provided.", description="Optional upstream prompt or previous image prompt."),
                _prompt_recipe_variable("image_analysis", "Image Analysis", default_value="No reference images provided.", description="Optional visual context."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="cinematic realism", description="Short style or genre direction."),
                _prompt_recipe_variable("shot_count", "Shot Count", default_value="4", description="Number of video prompts to create."),
                _prompt_recipe_variable("duration_seconds", "Duration Seconds", default_value="5", description="Duration for each generated shot."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": False, "mode": "both", "analysis_variable": "image_analysis", "max_files": 4},
            "default_options_json": {"temperature": 0.35, "max_output_tokens": 2600, "strict_output": True},
            "rules_json": {"return_only_final_output": True, "allow_markdown": False, "allow_json": True, "validate_json_output": False, "allow_external_variables": True},
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1",
            "priority": 480,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-image-analysis-character-reference",
            "key": "image-analysis-character-reference",
            "label": "Image Analysis - Character Reference",
            "description": "Analyzes one or more reference images into compact character continuity notes.",
            "category": "analysis",
            "status": "active",
            "system_prompt_template": (
                "You are a reference analyst for downstream image and video prompt generation.\n\n"
                "USER PROMPT:\n{{user_prompt}}\n\n"
                "REFERENCE ANALYSIS:\n{{image_analysis}}\n\n"
                "Return a concise character continuity reference covering subject identity, face, hair, body, clothing, pose, lighting, camera, props, and important details."
            ),
            "image_analysis_prompt": "Describe the attached image set as a reusable character reference for image and video generation. Focus on identity, facial features, body shape, clothing, styling, props, environment, and details that should remain consistent.",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "image_analysis",
            "output_contract_json": {"type": "object", "properties": {"description": {"type": "string"}, "subject": {"type": "string"}, "important_details": {"type": "array"}}},
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "User Prompt", default_value="Describe the character and continuity-critical details.", description="Optional focus for the analysis."),
                _prompt_recipe_variable("image_analysis", "Image Analysis", description="Reference-image analysis injected by the graph runtime."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": True, "mode": "analyze_then_inject", "analysis_variable": "image_analysis", "max_files": 4},
            "default_options_json": {"temperature": 0.2, "max_output_tokens": 1200, "strict_output": False},
            "rules_json": {"return_only_final_output": True, "allow_markdown": True, "allow_json": True, "allow_external_variables": True},
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1",
            "priority": 470,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-environment-sheet-v1",
            "key": "environment-sheet-v1",
            "label": "Environment Sheet v1",
            "description": "Creates a reusable environment continuity sheet prompt from a location brief and optional environment references.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are Media Studio's Environment Sheet v1 prompt compiler.\n\n"
                "Create one final image-generation prompt for a production-ready environment continuity sheet. This recipe creates still environment reference images only; it does not create storyboards, videos, graph nodes, runs, saves, or billing actions.\n\n"
                "ENVIRONMENT BRIEF:\n{{user_prompt}}\n\n"
                "ENVIRONMENT NAME:\n{{environment_name}}\n\n"
                "ENVIRONMENT TYPE:\n{{environment_type}}\n\n"
                "KEY ZONES:\n{{key_zones}}\n\n"
                "MOOD / LIGHTING:\n{{mood_lighting}}\n\n"
                "ACTION REQUIREMENTS:\n{{action_requirements}}\n\n"
                "VFX OR STATE VARIANTS:\n{{vfx_or_state_variants}}\n\n"
                "LAYOUT MODE:\n{{layout_mode}}\n\n"
                "REFERENCE ANALYSIS:\n{{image_analysis}}\n\n"
                "Build the prompt around the environment, not around a character. Treat connected images as optional location, mood, layout, material, prop, architecture, or atmosphere references. Do not use environment references as character identity sources.\n\n"
                "If reference images are present, preserve useful place details: geography, architecture, materials, lighting, color palette, landmarks, entrances, exits, built-in props, signage, atmosphere, terrain, room scale, weather, and spatial relationships. If no reference images are present, derive the environment from ENVIRONMENT BRIEF, ENVIRONMENT TYPE, KEY ZONES, and ACTION REQUIREMENTS.\n\n"
                "The final Environment Sheet should lock the stage for downstream storyboard and video work. It must make room geography and action logic easy to reuse. Include these sections unless LAYOUT MODE asks for a compact sheet:\n"
                "- title/header band with place name and functional tags\n"
                "- one large hero establishing view\n"
                "- wide/front, side, reverse, and overhead or map-like views\n"
                "- key zone callouts for entrances, exits, action lanes, danger areas, prop areas, background depth, and important landmarks\n"
                "- material and texture callouts for floors, walls, doors, furniture, machines, ruins, nature, signage, weather, wear, and surface details\n"
                "- mood and lighting variants from MOOD / LIGHTING\n"
                "- VFX or state variants from VFX OR STATE VARIANTS when useful\n"
                "- continuity anchors that must remain stable across later storyboard panels\n"
                "- movement and staging notes showing how characters can enter, cross, hide, fight, cook, investigate, escape, or trigger events in the space\n\n"
                "If the user is building a time-freeze, portal, magic, combat, cooking, vehicle, performance, chase, horror, fantasy, sci-fi, or product scene, adapt the environment sheet to support that use case without hardcoding any one example. For time-freeze scenes, include normal and frozen-state environment variants only when requested by the brief.\n\n"
                "Keep labels readable and production-useful. Use concise English labels. Avoid tiny paragraphs, biographies, character stats, provider names, implementation notes, graph commands, pricing, run/save instructions, or internal planning text.\n\n"
                "Return only the final image-generation prompt. Do not explain, do not use markdown, and do not return JSON."
            ),
            "image_analysis_prompt": (
                "Describe these images as environment or location references for downstream environment-sheet generation. "
                "Focus on geography, architecture, entrances, exits, landmarks, materials, lighting, color palette, built-in props, atmosphere, scale, camera angles, and continuity details. "
                "Do not describe the image as a character identity reference unless the user explicitly says the environment reference also contains the intended subject."
            ),
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A single environment-sheet image prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "Environment Brief", required=True, description="The location, world, room, set, or environment the user wants to lock."),
                _prompt_recipe_variable("image_analysis", "Image Analysis", default_value="No environment reference images provided.", description="Optional environment-reference analysis injected by the graph runtime."),
            ],
            "custom_fields_json": [
                _prompt_recipe_custom_field("environment_name", "Environment Name", default_value="Environment Sheet", help_text="Optional title/name for the place."),
                _prompt_recipe_custom_field(
                    "environment_type",
                    "Environment Type",
                    default_value="cinematic location",
                    help_text="Place type such as hotel lobby, dungeon, spaceship bridge, kitchen set, castle courtyard, desert town, lab, forest, or arena.",
                ),
                _prompt_recipe_custom_field(
                    "key_zones",
                    "Key Zones",
                    field_type="textarea",
                    default_value="entrance, exit, hero action area, background depth, important landmarks",
                    help_text="Zones and landmarks that should remain stable downstream.",
                ),
                _prompt_recipe_custom_field(
                    "mood_lighting",
                    "Mood / Lighting",
                    field_type="textarea",
                    default_value="cinematic lighting with clear material readability",
                    help_text="Atmosphere, lighting states, palette, weather, time of day, or mood.",
                ),
                _prompt_recipe_custom_field(
                    "action_requirements",
                    "Action Requirements",
                    field_type="textarea",
                    default_value="show clear paths for characters to enter, cross, interact, and exit the space",
                    help_text="How characters, props, vehicles, food, creatures, or effects need to move through the environment.",
                ),
                _prompt_recipe_custom_field(
                    "vfx_or_state_variants",
                    "VFX / State Variants",
                    field_type="textarea",
                    default_value="normal state plus any requested special state",
                    help_text="Optional variants such as frozen time, portal active, battle damage, storm, night mode, alarm, magic, smoke, rain, or power failure.",
                ),
                _prompt_recipe_custom_field("layout_mode", "Layout Mode", default_value="production_sheet", help_text="production_sheet, reference_sheet, compact_sheet, or user_specified."),
            ],
            "image_input_json": {
                "enabled": True,
                "required": False,
                "mode": "both",
                "analysis_variable": "image_analysis",
                "max_files": 4,
                "reference_roles": ["environment", "generic"],
            },
            "default_options_json": {"temperature": 0.25, "max_output_tokens": 2200, "strict_output": True},
            "rules_json": {
                "return_only_final_output": True,
                "allow_markdown": False,
                "allow_json": False,
                "allow_external_variables": True,
                "environment_sheet_stage": "stills_only",
            },
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1",
            "priority": 468,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-environment-plate-v1",
            "key": "environment-plate-v1",
            "label": "Environment Plate v1.2",
            "description": "Creates concise, genre-portable photographic environment prompts with real-camera framing and tangible physical sets.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are Media Studio's Environment Plate v1.2 prompt compiler.\n\n"
                "Turn the location brief into one concise prompt for a single photographic environment plate.\n\n"
                "LOCATION BRIEF:\n{{user_prompt}}\n\n"
                "OPTIONAL CONTEXT:\n"
                "Environment name: {{environment_name}}\n"
                "Environment type: {{environment_type}}\n"
                "Camera view: {{camera_view}}\n"
                "Mood / lighting: {{mood_lighting}}\n"
                "Action lanes / anchors: {{action_lanes}}\n"
                "Reference analysis: {{image_analysis}}\n\n"
                "Write 40 to 75 words in one paragraph. Start with a photorealistic frame captured on a real camera. Then state the exact location and viewpoint, the few tangible architectural features or objects that define it, the motivated natural or practical light, and the dominant physical materials. End with normal exposure, neutral color, and natural contrast when those qualities fit the brief.\n\n"
                "Treat fantasy, science fiction, western, horror, historical, and other genres as visible set content, never as an illustration style. Preserve distinctive genre anchors, but express them as buildable architecture, props, machinery, terrain, weather, light sources, and materials. Do not replace specific genre content with a generic room.\n\n"
                "Use connected images only as optional references for location geometry, architecture, materials, props, lighting, atmosphere, and camera position. Do not use an environment reference as character identity.\n\n"
                "Keep useful geography such as entrances, exits, paths, landmarks, foreground, midground, and background only when supplied by the brief or needed to make the viewpoint understandable. Do not add surface aging, dust, dampness, reflections, microcontrast, highlight-rolloff instructions, focus effects, lens specifications, post-processing language, or extra atmosphere unless the user requests them. Do not add a negative list.\n\n"
                "The result is one uninterrupted, character-free camera plate. Do not create a presentation board, reference sheet, collage, map, blueprint, diagram, labels, callouts, UI, story action, or dialogue.\n\n"
                "Return only the final image-generation prompt. No markdown. No JSON. No explanation."
            ),
            "image_analysis_prompt": (
                "Describe connected images as physical location references for a concise photographic environment prompt. "
                "Keep only observable geometry, architecture, entrances, exits, landmarks, materials, built-in props, motivated light sources, scale, and camera position. "
                "Preserve distinctive fantasy, science-fiction, historical, western, horror, or other genre anchors as tangible set content. "
                "Ignore labels, maps, callouts, UI frames, typography, sheet layout, story text, characters, and post-processing style."
            ),
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "One concise 40-75 word photographic environment-plate prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "Environment Brief", required=True, description="The location, world, room, set, or environment the user wants as a clean plate."),
                _prompt_recipe_variable("image_analysis", "Image Analysis", default_value="No environment reference images provided.", description="Optional environment-reference analysis injected by the graph runtime."),
            ],
            "custom_fields_json": [
                _prompt_recipe_custom_field("environment_name", "Environment Name", default_value="Environment Plate", help_text="Optional title/name for the place; used as prompt context only, not visible text."),
                _prompt_recipe_custom_field(
                    "environment_type",
                    "Environment Type",
                    default_value="physical location or practical set",
                    help_text="Place type such as spaceship cockpit, forest gate, kitchen set, desert town street, castle courtyard, laboratory, or arena.",
                ),
                _prompt_recipe_custom_field(
                    "camera_view",
                    "Camera View",
                    field_type="textarea",
                    default_value="wide view from human eye height at a plausible camera position",
                    help_text="Simple camera angle and viewpoint for the clean plate.",
                ),
                _prompt_recipe_custom_field(
                    "mood_lighting",
                    "Mood / Lighting",
                    field_type="textarea",
                    default_value="motivated natural or practical light with normal exposure",
                    help_text="Visible light source, weather, time of day, or mood when it matters.",
                ),
                _prompt_recipe_custom_field(
                    "action_lanes",
                    "Action Lanes / Anchors",
                    field_type="textarea",
                    default_value="one clear entrance, one central landmark, and readable background depth",
                    help_text="Only the essential paths and landmarks later storyboard panels should reuse.",
                ),
            ],
            "image_input_json": {
                "enabled": True,
                "required": False,
                "mode": "both",
                "analysis_variable": "image_analysis",
                "max_files": 4,
                "reference_roles": ["environment", "generic"],
            },
            "default_options_json": {"temperature": 0.1, "max_output_tokens": 300, "strict_output": True},
            "rules_json": {
                "return_only_final_output": True,
                "allow_markdown": False,
                "allow_json": False,
                "allow_external_variables": True,
                "environment_plate_stage": "concise_photo_plate",
                "target_word_count_min": 40,
                "target_word_count_max": 75,
                "style_priority": "real_camera_before_genre",
                "genre_handling": "physical_set_content",
            },
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1.2",
            "notes": "PAID-3203 v1.2 adopts the short positive photographic structure that outperformed v1.1 in the 2026-07-22 observatory comparison. Genre remains tangible scene content; automatic wear, dust, dampness, microcontrast, highlight-rolloff, focus, lens, post-processing, and negative-list additions are removed.",
            "priority": 467,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-storyboard-shot-sequence-3x3",
            "key": "storyboard-shot-sequence-3x3",
            "label": "Storyboard Shot Sequence - 3x3",
            "description": "Creates nine coherent storyboard panel prompts as a structured shot sequence.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are an expert cinematic storyboard director.\n\n"
                "Convert the creative brief into a nine-panel storyboard sequence.\n\n"
                "USER PROMPT:\n{{user_prompt}}\n\n"
                "SOURCE PROMPT:\n{{source_prompt}}\n\n"
                "REFERENCE ANALYSIS:\n{{image_analysis}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "ASPECT RATIO:\n{{aspect_ratio}}\n\n"
                "Return strict JSON with a `shots` array containing {{shot_count}} storyboard panels. Each panel must include `shot_number`, `title`, `caption`, "
                "`camera`, `action`, `continuity_notes`, and a strong standalone `prompt` for image generation. Preserve continuity across every panel."
            ),
            "image_analysis_prompt": "Describe the provided reference images for a storyboard sequence. Focus on identity, environment, props, mood, camera potential, and continuity details that should remain stable across multiple panels.",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "structured_shot_sequence",
            "output_contract_json": {
                "type": "object",
                "required": ["shots"],
                "properties": {
                    "shots": {
                        "type": "array",
                        "items": {"type": "object", "required": ["shot_number", "title", "caption", "prompt"]},
                    }
                },
            },
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "User Prompt", required=True, description="Creative direction supplied by the user."),
                _prompt_recipe_variable("source_prompt", "Source Prompt", default_value="No source prompt provided.", description="Optional upstream prompt or previous direction."),
                _prompt_recipe_variable("image_analysis", "Image Analysis", default_value="No reference images provided.", description="Reference-image analysis injected by the graph runtime."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="cinematic realism", description="Short style or genre direction."),
                _prompt_recipe_variable("shot_count", "Shot Count", default_value="9", description="Number of storyboard panels to create."),
                _prompt_recipe_variable("aspect_ratio", "Aspect Ratio", default_value="16:9", description="Target aspect ratio for each panel prompt."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": False, "mode": "both", "analysis_variable": "image_analysis", "max_files": 4},
            "default_options_json": {"temperature": 0.35, "max_output_tokens": 2800, "strict_output": True},
            "rules_json": {"return_only_final_output": True, "allow_markdown": False, "allow_json": True, "validate_json_output": False, "allow_external_variables": True},
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1",
            "priority": 465,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-storyboard-v2-gpt-image-2",
            "key": "storyboard-v2-gpt-image-2",
            "label": "Storyboard v2 - GPT Image 2 Sheet",
            "description": "Creates a cinematic storyboard-sheet prompt from an approved character sheet, compact story brief, optional environment sheet, and optional previous-board handoff.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are Media Studio's Storyboard v2 prompt compiler for GPT Image 2 image-to-image.\n\n"
                "Create one final GPT Image 2 prompt for a high-quality cinematic storyboard sheet. This recipe creates still storyboard images only; it does not create Seedance, video, clips, or motion nodes.\n\n"
                "PREVIOUS BOARD HANDOFF:\n{{previous_output}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "SHOT COUNT:\n{{shot_count}}\n\n"
                "ASPECT RATIO:\n{{aspect_ratio}}\n\n"
                "DIALOGUE MODE:\n{{dialogue_mode}}\n\n"
                "BOARD TITLE:\n{{board_title}}\n\n"
                "PRODUCTION METADATA:\n{{production_metadata}}\n\n"
                "DIALOGUE CUES:\n{{dialogue_cues}}\n\n"
                "WARDROBE CUES:\n{{wardrobe_cues}}\n\n"
                "SUBJECT DESIGN CUES:\n{{subject_design_cues}}\n\n"
                "PANEL NOTES CUES:\n{{panel_notes_cues}}\n\n"
                "USER STORY BRIEF:\n{{user_prompt}}\n\n"
                "CONNECTED TYPED REFERENCE ROLES:\n{{reference_role_block}}\n\n"
                "TYPED REFERENCE PRIORITY RULE:\n{{reference_priority_rule}}\n\n"
                f"{storyboard_v2_sheet_contract_instruction()}\n\n"
                "BOARD IDENTITY INPUTS:\n"
                "Treat BOARD TITLE and PRODUCTION METADATA as user-owned visible text. Use their exact supplied board number, title, PROJECT, SEQUENCE, LOCATION, DATE, and ARTIST values. When either field explicitly asks for derivation, derive only from USER STORY BRIEF and the supplied segment position. Do not copy a prior board's title or sequence number, and do not invent story names, locations, or production values that are absent from user inputs.\n\n"
                "Create a high-quality cinematic storyboard sheet from the creative direction in USER STORY BRIEF. The user brief can be short; expand it into a readable panel sequence without replacing the user's idea. Character references lock recognizable identity and subject construction. When supplied, WARDROBE CUES and USER STORY BRIEF are the clothing authority and must override clothing depicted only incidentally in a character reference. If an Environment Sheet or location reference is connected, use it only as the location continuity lock for geography, lighting, materials, entrances/exits, set dressing, and action lanes.\n\n"
                "The output should look like a premium storyboard / previsualization sheet whose image cells are photoreal live-action feature-film production stills photographed on a physical set with real lens optics, natural skin and material texture, strong cinematic composition, restrained film color, readable English labels, and concise director notes under each cell. Do not remove the per-cell notes to make the images larger; the notes are part of the deliverable.\n\n"
                "REFERENCE INPUTS:\n"
                "When CONNECTED TYPED REFERENCE ROLES is populated, use that role map as the only source of truth for connected image order and role ownership. [image reference N] and @imageN are aliases for the same ordered image input. For GPT Image 2 prompts, prefer bracketed wording like [image reference 1] in the final prompt because it reads as natural image-reference language; keep @imageN only as an alias when a downstream compiler or non-GPT model needs a stable token anchor.\n"
                "Do not assume a fixed character/environment/storyboard slot number. If the role block says @image1 is an Environment Sheet, then @image1 is the environment. If it says @image2 is the character reference, then @image2 is the character. Apply each role exactly as declared.\n"
                "When CONNECTED TYPED REFERENCE ROLES is empty, infer roles from the user brief and visible content: identity-like references control identity, location-like references control setting geography, prop/product references control only those objects, style references control treatment, and additional references are supporting visual context only.\n"
                "Supporting references, when connected, are supporting set, location, prop, wardrobe, creature, product, vehicle, atmosphere, or environment references only. Do not let them override a declared primary character identity.\n"
                "When an Environment Sheet or location reference is connected, use it for spatial continuity only: geography, lighting, materials, entrances/exits, set dressing, prop zones, action lanes, camera-friendly staging zones, danger areas, hiding places, and final-state handoff. Never use an Environment Sheet for face, body, wardrobe, age, skin tone, hair, character identity, character name, or personality.\n"
                "When no Environment Sheet or location reference is connected, derive the environment from USER STORY BRIEF and keep it consistent with text continuity anchors.\n"
                "The main character must remain visually consistent across the storyboard unless USER STORY BRIEF specifically asks for transformation, mutation, costume change, or abstraction. If transformation is requested, preserve identity continuity in the early and mid shots, then preserve the character's essence, silhouette, movement language, or visual motifs in later abstract shots.\n\n"
                "STORY INTERPRETATION:\n"
                "Treat WARDROBE CUES and SUBJECT DESIGN CUES as user-owned story inputs. Preserve their concrete appearance constraints in the final prompt under the same labels and in the affected panel rows. Do not invent named subjects, garments, colors, anatomy, or creature traits that the user did not supply.\n"
                "Treat PANEL NOTES CUES as user-owned metadata. When populated with PANEL NN — note lines, reproduce each supplied note verbatim as that panel's NOTES value. Do not copy ACTION or MOTION into NOTES, and do not invent a replacement for a supplied note.\n"
                "Read USER STORY BRIEF carefully and convert it into a clear storyboard sequence. Extract the subject, setting, mood, camera style, main action, transformation arc if any, emotional progression, key visual effects, environment, ending beat, and the user's dialogue preference.\n"
                "Do not ignore the user's concept. Do not replace it with a generic action scene. Use USER STORY BRIEF as the story source of truth.\n"
                "If USER STORY BRIEF is loose or abstract, create a strong visual arc from it while staying faithful to the intent.\n"
                "If USER STORY BRIEF includes specific camera language, make camera movement the priority.\n"
                "If USER STORY BRIEF includes a specific ending, make the final shot clearly deliver that ending.\n"
                "If PREVIOUS BOARD HANDOFF is meaningful, make this board pick up from that ending instead of restarting the story.\n\n"
                "ACTION CONTINUITY / CAUSAL BRIDGES:\n"
                "Before writing the final panel sequence, build a hidden continuity ledger. Track the character's physical state, restraints or injuries, hand freedom, prop location, prop ownership, reachable objects, exits, doors, portals, villain positions, room geography, lighting, and what the final panel must hand off. Do not print this ledger unless it appears as compact NOTES metadata.\n"
                "Every panel must earn the next panel. Do not jump from a problem state to a solved state without showing the action, tool, discovery, choice, or consequence that caused the change.\n"
                "A panel may not show the character taking, grabbing, using, unlocking with, aiming, or activating an object unless a previous panel made that object visible, reachable, and logically available to the character. Props must move through clear states: seen -> reachable -> obtained -> used. If the character is restrained, bound, chained, trapped, locked, unconscious, or physically blocked, first show the restraint weakness, loosening, breaking, unlocking, distraction, or assistance before showing free movement or object use.\n"
                "Villains, captors, guards, creatures, vehicles, doors, portals, and important props must react in chronological order. Do not show captors reacting to an action before the action is visible. Do not move a key, weapon, amulet, door, portal, or exit across the room without a clear ACTION/MOTION/NOTES bridge.\n"
                "When the story includes a restraint, locked door, trap, chase, injury, transformation, vehicle launch, magic effect, weapon use, escape, rescue, or other obstacle-to-resolution beat, reserve one panel or a clear ACTION/MOTION/NOTES bridge that shows how the character moves from blocked to free, hidden to discovered, grounded to airborne, unarmed to armed, or powerless to empowered.\n"
                "Use a simple causal chain for each compact board: current state, attempt or pressure, discovery/tool/decision, decisive action, consequence/transition, payoff. Adapt the chain to the user's exact story instead of hardcoding these examples.\n"
                "If a key beat would otherwise be skipped because there are only 4 or 6 panels, combine nearby atmosphere beats first; do not skip the cause of the main action. If a requested action cannot fit causally in this board, end on the earned setup for that action and let the next board perform it.\n\n"
                "PROVIDER-SAFE ACTION LANGUAGE:\n"
                "When the story includes fights, weapons, captors, guards, monsters, threat, escape, or battle, stage it as non-graphic cinematic action. Prefer wording like disarms, disables, escapes, wins the standoff, overpowers, dodges, blocks, distracts, or incapacitates over graphic injury, gore, blood, killing, execution, mutilation, or explicit harm. Keep violence implied, stylized, readable, and production-safe while preserving the user's story stakes.\n\n"
                "OPTIONAL TEMPORAL EFFECT RULE PACK:\n"
                "Use time-freeze rules only when USER STORY BRIEF explicitly requests time freeze, frozen time, stopped time, suspended objects, or snap-triggered freeze/resume action. For those stories, preserve exact causal order: NORMAL -> FREEZE TRIGGER -> FROZEN INTERVENTION -> UNFREEZE TRIGGER -> RESUMED. Show active motion before the trigger, suspended background elements only during the frozen interval, and resumed reactions only after the unfreeze trigger. For all other stories, do not mention time freeze, frozen time, snap triggers, suspended objects, or freeze-state labels.\n\n"
                "CHARACTER NAMING:\n"
                "Treat local project nicknames, media filenames, reference-sheet names, and character labels as internal labels unless USER STORY BRIEF explicitly asks for a name to appear as visible text. Choose one neutral subject label for the recurring lead based on the reference and story, such as the character, the woman, the man, the lead, the rogue, the warrior, the host, the pilot, the captor, or the guards. Use that neutral label throughout storyboard titles, panel descriptions, visible metadata, dialogue attribution, signs, captions, ACTION, MOTION, DIALOG, and NOTES. Do not put a personal name into storyboard action or metadata rows, and do not rely on a name for identity; identity comes from the connected character-sheet reference.\n\n"
                "REFERENCE TEXT GUARD:\n"
                "Connected character sheets and references are visual continuity sources only. Do not copy visible name, title, project, footer, profile-card, stat, or UI label text from connected reference images. Storyboard titles, headers, footers, labels, and director-note rows should use generic subject wording unless USER STORY BRIEF explicitly asks for a visible character name.\n\n"
                "DIALOGUE POLICY:\n"
                "Always keep the DIALOG row label as part of the metadata structure, but leave the value after the colon truly empty when there is no spoken line for that panel. Do not write Silence, No dialogue, None, breath, reaction cue, nonverbal cue, a dash, an em dash, a hyphen, N/A, or any placeholder mark in the DIALOG row; put nonverbal acting in ACTION or NOTES instead.\n"
                "Treat DIALOGUE CUES as user-owned story data. For every supplied spoken line, preserve its speaker label, optional voice hint, exact quoted words, and assigned panel or beat. Format an attributed line as SPEAKER [voice hint] — \"exact line\". When two or more speaking-capable subjects share a frame, the DIALOG row must identify the speaker; never infer a speaker name or voice trait that the user did not supply.\n"
                "Use DIALOGUE MODE as the control unless USER STORY BRIEF gives a more specific instruction. none, silent, or wordless means every DIALOG value is blank. light means one or two short spoken lines only where they clarify the beat. medium or cinematic means two to four short lines across the board when the scene benefits from speech. full means every panel should contain a concise quoted spoken or reaction line, without placeholders and without crowding the metadata. user_specified means preserve exact quoted user lines and place them in the correct chronological panels.\n"
                "If USER STORY BRIEF asks for no dialogue, no speech, silent action, or a wordless board, every DIALOG row should be blank after the colon.\n"
                "If USER STORY BRIEF says the character talks, dialogue enabled, dialog enabled, some dialogue, dialog sort of, medium dialogue, cinematic dialogue, full dialogue, or gives similar direction without exact lines, follow that density using short in-character lines only where they help the beat.\n"
                "If USER STORY BRIEF includes exact quoted dialogue, place those exact words in the relevant DIALOG row. Do not invent extra dialogue beyond the requested density. If DIALOGUE MODE requests light, medium, cinematic, full, or user_specified dialogue, at least the requested number of panels must contain actual quoted speech text rather than blank or placeholder DIALOG values. For full dialogue, every DIALOG value should be actual quoted speech text; never use parenthetical silence.\n\n"
                "LONG STORY / MULTI-BOARD PLANNING:\n"
                "One storyboard sheet should represent one coherent story segment, not an entire long movie. For longer arcs, treat each board as a compact segment with a clear setup, escalation, payoff, and final handoff image.\n"
                "If USER STORY BRIEF says this is Storyboard N, segment N, next board, previous board, continuation, or a 15-second segment, make the sequence feel like that slice of the larger story.\n"
                "Use PREVIOUS BOARD HANDOFF to preserve character state, injuries, wardrobe changes, carried props, location geography, lighting, enemies, and unresolved action from the prior board.\n"
                "Treat PREVIOUS BOARD HANDOFF as private continuity state. Do not copy prior-board visible titles, footers, project names, character names, panel labels, or checklist/meta text into the new board unless USER STORY BRIEF explicitly asks for that visible text.\n"
                "If this board starts from a previous board, the first panel must be compatible with the previous final panel. Explicitly carry forward whether the character is bound or free, what object is held, where the threat is, where the exit is, and what obstacle is still unresolved.\n"
                "When the brief mentions scene/set/prop references, keep those elements consistent enough that later boards can reuse the same world without requiring a new prompt rewrite.\n\n"
                "STORY STRUCTURE:\n"
                "SHOT COUNT is authoritative. Render exactly 4 storyboard cells in a 2x2 grid, 6 cells in a 3x2 grid, or 9 cells in a 3x3 grid. Create exactly the requested number of PANEL NN blocks, numbered consecutively from 01, and never add, omit, or duplicate a panel.\n"
                "Each cell should represent a distinct beat with visual continuity from the previous cell.\n"
                "Use this default progression unless USER STORY BRIEF suggests a better structure:\n"
                "01 - SETUP / ESTABLISHING BEAT / CURRENT STATE\n"
                "02 - PRESSURE / FIRST ATTEMPT / OBSTACLE DETAIL\n"
                "03 - DISCOVERY / TOOL / DECISION / TURNING POINT\n"
                "04 - DECISIVE ACTION / CAUSAL BRIDGE / MAJOR VISUAL CHANGE\n"
                "05 - CONSEQUENCE / TRANSITION / ESCAPE OR RESOLUTION\n"
                "06 - FINAL PAYOFF / CLIMAX / END IMAGE\n\n"
                "VISUAL STYLE:\n"
                "Use STYLE DIRECTION and the visual style requested in USER STORY BRIEF. If no style is specified, use photoreal live-action feature-film production still styling photographed on a physical set with real lens optics, natural skin and material texture, physically plausible production lighting, atmospheric depth, restrained film color, and premium production design.\n"
                "Use a dark near-black production board background, thin yellow-orange UI lines, subtle panel borders, faint film grain, clean typography, and high-end film/game previsualization design.\n"
                "The storyboard should feel professional, cinematic, readable, and production-ready. Images should dominate the board, but every cell must reserve a readable metadata strip below the image. Keep notes compact and useful, not tiny or decorative.\n\n"
                "CAMERA / DIRECTOR LANGUAGE:\n"
                "Each cell must include a practical director-note block below the image. This block is required, not optional, and should take roughly 20-28% of each cell height so it remains readable at final resolution.\n"
                "Use SHOT as the one heading above each image: a two-digit number and short title. Do not repeat SHOT below the image.\n"
                "Use exactly the same five metadata rows under every cell:\n"
                "CAMERA: camera type, angle, movement, and lens feel first; then shot size and subject placement on the same row\n"
                "ACTION: what the character, important prop, creature, vehicle, or scene element is doing\n"
                "MOTION: camera motion, subject motion, environmental motion, rhythm, VFX timing, or transformation timing\n"
                "DIALOG: exact user-requested dialogue, sparse dialogue when requested, or blank after the colon when no spoken line is needed; do not put speech bubbles on the storyboard\n"
                "NOTES: required non-empty concise VFX, continuity, emotion, item/prop-state, environment-state, or video-director handoff note derived from USER STORY BRIEF and the current panel state\n\n"
                "The SHOT heading and all five row labels are mandatory in every panel. DIALOG alone may have a blank value when no spoken line is needed; SHOT, CAMERA, ACTION, MOTION, and NOTES must each contain a complete non-placeholder value. Never omit a required heading or row label.\n\n"
                "The metadata block should read like production handoff data: camera shot, character action, item/prop action, dialogue, motion, and continuity should be understandable without rereading the prompt.\n\n"
                "Use camera language appropriate to USER STORY BRIEF: FPV drone, dolly, orbit, tracking, push-in, pullback, low sweep, overhead, handheld, locked-off, crane, spiral, wraparound, parallax, close-up, extreme wide, over-shoulder, or insert shot.\n\n"
                "CONTINUITY RULES:\n"
                "Keep the main character centered or framed according to USER STORY BRIEF.\n"
                "Maintain continuity of face, body, outfit, environment, lighting, and motion unless the prompt asks for progressive change. If an Environment Sheet is connected, preserve its room geography, landmarks, material palette, lighting logic, entrances/exits, action lanes, and set dressing across every panel without copying character identity from it.\n"
                "If transformation is requested, make it grow clearly from shot to shot rather than appearing randomly.\n"
                "Keep subject placement, camera direction, and scene geography understandable. Every cell should read as part of one continuous sequence.\n\n"
                "ACTION CLARITY:\n"
                "Each frame must communicate what is happening immediately. Use readable silhouettes, clear poses, directional motion, background cues, and strong composition. Avoid vague beauty shots unless USER STORY BRIEF specifically asks for a mood board rather than action beats.\n\n"
                "TEXT RULES:\n"
                "All labels must be in English. Keep text short and readable. Avoid tiny paragraphs. Do not add long character bios, stats, powers lists, or profile-card metadata. Do not omit the SHOT / CAMERA / ACTION / MOTION / DIALOG / NOTES director-note structure. Use neutral subject labels in visible metadata instead of personal names unless the user explicitly asks for the name to be visible. Use a cinematic title based on USER STORY BRIEF unless the user provides one. Do not add a page footer; the top production strip and sequence/title information already identify the board. Use the freed height for larger image cells and readable metadata.\n\n"
                "OUTPUT FORMAT:\n"
                "Return only the final GPT Image 2 prompt. Do not explain, do not use markdown, and do not return JSON.\n"
                "A single 4K-quality cinematic storyboard sheet using the exact SHOT COUNT layout: 2x2 for 4 panels, 3x2 for 6 panels, or 3x3 for 9 panels. Photoreal live-action feature-film production-still image cells unless USER STORY BRIEF requests another style. Readable English labels. Required readable director-note metadata under every cell with SHOT, CAMERA, ACTION, MOTION, DIALOG, and NOTES. CAMERA includes framing on the same row. Strong camera direction and video-director handoff value. Grounded in the approved character sheet / identity references for character continuity and USER STORY BRIEF for the story.\n"
                "Do not append STORY BEATS, missing-beat reminders, hidden ledgers, analysis notes, repair notes, checklist notes, or any other internal planning section to the final prompt. If a beat matters, place it directly inside the appropriate panel ACTION, MOTION, or NOTES row.\n"
                "Do not include model/provider instructions, pricing, node names, biographies, stat blocks, capability lists, or internal planning text."
            ),
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": _storyboard_v2_output_contract(),
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "Story / Scene Brief", required=True, description="Story beat, scene list, or storyboard brief to turn into one sheet."),
                _prompt_recipe_variable("previous_output", "Previous Board Handoff", default_value="No previous board handoff provided.", description="Optional ending state from the prior storyboard board."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="photoreal live-action feature-film production stills, consistent character continuity", description="Reusable visual style and continuity guidance."),
                _prompt_recipe_variable("shot_count", "Shot Count", default_value="6", description="Number of storyboard panels to create, usually 4, 6, or 9."),
                _prompt_recipe_variable("aspect_ratio", "Aspect Ratio", default_value="16:9", description="Target storyboard-sheet aspect ratio."),
                _prompt_recipe_variable("dialogue_mode", "Dialogue Mode", default_value="light", description="Dialogue policy: none, light, medium, cinematic, full, or user_specified."),
            ],
            "custom_fields_json": [
                *_storyboard_board_identity_fields(story_source="story brief"),
                *_storyboard_user_cue_fields(
                    story_source="story brief",
                    dialogue_placeholder='PANEL 03 — DROID [dry synthetic voice] — "Exact line"',
                ),
            ],
            "image_input_json": {
                "enabled": True,
                "required": False,
                "mode": "direct_reference",
                "analysis_variable": "image_analysis",
                "max_files": 4,
                "reference_roles": ["character", "environment"],
            },
            "default_options_json": {"temperature": 0.25, "max_output_tokens": 2400, "strict_output": True},
            "rules_json": {
                "return_only_final_output": True,
                "allow_markdown": False,
                "requires_ordered_image_refs": True,
                "storyboard_stage": "stills_only",
                "allow_external_variables": True,
            },
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "2.28",
            "priority": 462,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-storyboard-continuation-v1",
            "key": "storyboard-continuation-v1",
            "label": "Storyboard Continuation v1",
            "description": "Creates the next Storyboard v2 prompt from a previous storyboard image, previous prompt/handoff, character sheet, and continuation brief.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are Media Studio's Storyboard Continuation v1 prompt compiler for GPT Image 2 image-to-image.\n\n"
                "Create one final Storyboard v2-compatible GPT Image 2 prompt for the next storyboard still sheet in a continuous multi-board story. This recipe creates still storyboard images only; it does not create Seedance, video, clips, motion nodes, graph nodes, runs, saves, or billing actions.\n\n"
                "CONNECTED TYPED REFERENCE ROLES:\n{{reference_role_block}}\n\n"
                "TYPED REFERENCE PRIORITY RULE:\n{{reference_priority_rule}}\n\n"
                "ORDERED VISUAL REFERENCES:\n"
                "Use the connected typed role block above as the only source of truth for actual image order and role ownership. [image reference N] and @imageN are aliases for the same ordered image input. For GPT Image 2 prompts, prefer bracketed wording like [image reference 1] in the final prompt because it reads as natural image-reference language; keep @imageN only as an alias when a downstream compiler or non-GPT model needs a stable token anchor.\n"
                "Do not assume that a particular slot number always means character, environment, or previous storyboard. Apply the role declared on each line: Character references control recognizable identity and subject construction; Environment references control geography, landmarks, materials, lighting, entrances/exits, set dressing, and action lanes; Storyboard references control prior panel order, final visible state, layout geometry, metadata geometry, and visual handoff continuity.\n"
                "When supplied, WARDROBE CUES and CONTINUATION BRIEF are the clothing authority and must override clothing depicted only incidentally in a character reference. Previous-storyboard references are not scene content to duplicate, and their visible text is private evidence. Do not let any reference override another reference's declared role.\n"
                "Compatibility fallback: if this continuation recipe has exactly one Additional supporting reference and no dedicated Storyboard reference, treat that Additional reference as the previous storyboard handoff only when PREVIOUS STORYBOARD PROMPT OR HANDOFF or CONTINUATION BRIEF identifies it as the prior board; otherwise treat it as supporting visual context.\n\n"
                f"{storyboard_v2_sheet_contract_instruction()}\n\n"
                "PREVIOUS STORYBOARD PROMPT OR HANDOFF:\n{{previous_storyboard_prompt}}\n\n"
                "CONTINUATION BRIEF:\n{{continuation_brief}}\n\n"
                "HANDOFF ADVANCE:\n{{handoff_advance}}\n\n"
                "DIALOGUE CUES:\n{{dialogue_cues}}\n\n"
                "WARDROBE CUES:\n{{wardrobe_cues}}\n\n"
                "SUBJECT DESIGN CUES:\n{{subject_design_cues}}\n\n"
                "PANEL NOTES CUES:\n{{panel_notes_cues}}\n\n"
                "SEGMENT NUMBER:\n{{segment_number}}\n\n"
                "TOTAL SEGMENTS:\n{{total_segments}}\n\n"
                "TARGET DURATION SECONDS:\n{{target_duration_seconds}}\n\n"
                "PANEL COUNT:\n{{panel_count}}\n\n"
                "BOARD TITLE:\n{{board_title}}\n\n"
                "PRODUCTION METADATA:\n{{production_metadata}}\n\n"
                "DIALOGUE MODE:\n{{dialogue_mode}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "PREVIOUS BOARD ANALYSIS REQUIREMENTS:\n"
                "Use the declared Storyboard reference, or the compatibility-fallback previous-board reference described above, as the strongest visual evidence for what actually happened and where the prior board ended. Extract the approximate layout/panel count, recurring character look, wardrobe, key props, setting, lighting, action progression, final panel state, unresolved threat, obstacle, emotion, movement, and continuity risks. Treat readable titles and metadata as private evidence, not text to copy.\n"
                "Build a hidden state ledger from the previous board image and previous prompt before writing the next board. Track whether the character is restrained or free, what props are seen/reachable/held/used, where villains or threats are positioned, where the exit or portal is, what room or route geometry is established, and what final-state handoff is allowed. Do not print this ledger unless it becomes compact NOTES metadata.\n"
                "Use PREVIOUS STORYBOARD PROMPT OR HANDOFF as intent context: story premise, intended beats, character terms, style rules, dialogue policy, camera/action/motion metadata format, and ending instruction. If the previous image and prompt conflict, preserve visible continuity first.\n\n"
                "CONTINUATION RULES:\n"
                "Treat BOARD TITLE and PRODUCTION METADATA as user-owned visible text. Use their exact supplied board number, title, PROJECT, SEQUENCE, LOCATION, DATE, and ARTIST values. When either field explicitly asks for derivation, derive only from CONTINUATION BRIEF and SEGMENT NUMBER / TOTAL SEGMENTS. Never copy the previous board's title or visible sequence number.\n"
                "Treat WARDROBE CUES and SUBJECT DESIGN CUES as user-owned story inputs. Preserve their concrete appearance constraints in the final prompt under the same labels and in every affected panel row. Do not invent named subjects, garments, colors, anatomy, or creature traits that the user did not supply.\n"
                "Treat PANEL NOTES CUES as user-owned metadata. When populated with PANEL NN — note lines, reproduce each supplied note verbatim as that panel's NOTES value. Do not copy ACTION or MOTION into NOTES, and do not invent a replacement for a supplied note.\n"
                "Make this board continue from the previous board instead of restarting the story. The first panel should pick up from the previous board's final visible state or handoff, but it must not duplicate that frame. Preserve the established location, subjects, wardrobe, props, lighting, color, and spatial state while applying the user-supplied HANDOFF ADVANCE. Panel 01 must introduce a visible action, reaction, attributed dialogue beat, or purposeful camera angle, framing, lens, or movement change that starts this board's motion without jumping location or unearned time. The continuation brief is the new story direction, not a full replacement for previous continuity.\n"
                "Preserve the previous board's final character state, wardrobe, props, location logic, lighting, unresolved action, and active threat by default. End with a clear visual handoff into the next storyboard segment unless this is explicitly the final board, in which case end with a clear payoff or optional next-adventure handoff.\n"
                "Avoid repeating the same beats from the previous board. Advance the story with a distinct location, action, obstacle, reveal, emotional turn, or payoff.\n"
                "Every major state change must be earned. Do not jump from restrained to free, locked to escaped, hidden to discovered, grounded to airborne, unarmed to armed, powerless to empowered, or problem to solution without showing the action, tool, discovery, choice, or consequence that caused it.\n"
                "A panel may not show the character taking, grabbing, using, unlocking with, aiming, or activating an object unless the prior board or an earlier panel in this board made that object visible, reachable, and logically available. Props must move through clear states: seen -> reachable -> obtained -> used. If the character is restrained, blocked, or captive, show the restraint weakness, loosening, breaking, unlocking, distraction, or assistance before free movement or object use.\n"
                "Villains, captors, guards, creatures, doors, portals, and important props must react in chronological order. Do not show a reaction before the triggering action is visible, and do not move an important prop or exit without a clear ACTION/MOTION/NOTES bridge.\n"
                "Treat each board as roughly one compact 15-second visual segment when TARGET DURATION SECONDS is 15. If the continuation brief contains too many beats for PANEL COUNT, combine atmosphere/setup beats first and preserve the main causal actions.\n\n"
                "PROVIDER-SAFE ACTION LANGUAGE:\n"
                "When continuing fights, weapons, captors, guards, monsters, threat, escape, or battle, stage action as non-graphic cinematic motion. Prefer wording like disarms, disables, escapes, wins the standoff, overpowers, dodges, blocks, distracts, or incapacitates over graphic injury, gore, blood, killing, execution, mutilation, or explicit harm. Keep violence implied, stylized, readable, and production-safe while preserving story stakes and spatial continuity.\n\n"
                "CHARACTER AND REFERENCE TEXT RULES:\n"
                "Keep the character visually consistent from the declared Character reference when one is connected. Treat names, filenames, saved media titles, or labels printed on references as internal labels unless the continuation brief explicitly asks for visible names. Choose one neutral subject label for the recurring lead based on the reference and story, such as the character, the woman, the man, the lead, the rogue, the warrior, the host, the pilot, the captor, or the guards. Use that neutral label throughout storyboard titles, panel descriptions, visible metadata, dialogue attribution, signs, captions, ACTION, MOTION, DIALOG, and NOTES.\n"
                "Do not copy visible name, title, project, footer, profile-card, stat, or UI label text from connected references. Do not put a personal name into storyboard action or metadata rows unless the user explicitly asks for that visible name. Visible text must exclude model names, provider names, filenames, private character names, and invented profile IDs.\n\n"
                "DIALOGUE POLICY:\n"
                "Always keep the DIALOG row label in every panel. If DIALOGUE MODE is none, silent, or wordless, leave every DIALOG value truly blank after the colon. Do not write Silence, No dialogue, None, breath, reaction cues, a dash, an em dash, a hyphen, N/A, or any placeholder mark in DIALOG.\n"
                "Treat DIALOGUE CUES as user-owned story data. Preserve every supplied speaker label, optional voice hint, exact quoted line, and panel/beat assignment. Format attributed dialogue as SPEAKER [voice hint] — \"exact line\". When two or more speaking-capable subjects share a frame, identify the speaker explicitly; never invent a speaker name or voice trait.\n"
                "If DIALOGUE MODE is light, add one or two short spoken lines only where they help the beat. If DIALOGUE MODE is medium or cinematic, use two to four short lines across the board. If DIALOGUE MODE is full, every DIALOG value should be actual quoted speech text, without parenthetical silence or placeholder marks, and without crowding the metadata. If DIALOGUE MODE is user_specified, preserve exact quoted user lines in the correct chronological panels. Most panels can still have blank DIALOG values unless a line matters.\n\n"
                "OUTPUT REQUIREMENTS:\n"
                "Return a complete Storyboard v2 image-generation prompt, not a summary.\n"
                "Include a storyboard title, segment number and total segment count when provided, concise previous-board read, final-panel handoff, continuation brief, target duration, panel count, visual continuity rules, character continuity rules, wardrobe/prop/environment continuity rules, panel-by-panel storyboard structure, and a next-board handoff note.\n"
                "Default to a 3x2 grid for 6 panels, 2x2 for 4 panels, or 3x3 for 9 panels. Use SHOT once as the heading above each image: a two-digit number and short title. Do not repeat SHOT below the image. Each panel must include exactly the same five readable director-note metadata rows under the image:\n"
                "CAMERA: camera type, angle, movement, and lens feel first; then shot size and subject placement on the same row\n"
                "ACTION: what the character, important prop, creature, vehicle, or scene element is doing\n"
                "MOTION: camera motion, subject motion, environmental motion, rhythm, VFX timing, or transformation timing\n"
                "DIALOG: exact requested dialogue, sparse dialogue when requested, or blank after the colon when no spoken line is needed\n"
                "NOTES: required non-empty concise VFX, continuity, emotion, item/prop-state, environment-state, or handoff note derived from CONTINUATION BRIEF and the current panel state\n\n"
                "The SHOT heading and all five row labels are mandatory in every panel. DIALOG alone may have a blank value when no spoken line is needed; SHOT, CAMERA, ACTION, MOTION, and NOTES must each contain a complete non-placeholder value. Never omit a required heading or row label.\n\n"
                "STYLE:\n"
                "Use STYLE DIRECTION and the visible style from the prior board unless the continuation brief explicitly changes style. If no style is provided, every image cell uses photoreal live-action feature-film production still styling photographed on a physical set with real lens optics, natural skin and material texture, physically plausible production lighting, atmospheric depth, restrained film color, and premium production design. Keep dark near-black board chrome, thin yellow-orange UI lines, readable English labels, concise metadata, and high-end production-board design.\n\n"
                "Do not add a page footer. Preserve sequence identification in the title and top production strip, and use the freed height for larger image cells and readable metadata.\n\n"
                "Do not include raw assistant debug language, internal Graph Studio instructions, node names, provider instructions, pricing, Run/Save instructions, Seedance/video instructions, biographies, stat blocks, profile-card metadata, or JSON. Return only the final prompt."
            ),
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{continuation_brief}}",
            "output_format": "single_prompt",
            "output_contract_json": _storyboard_v2_output_contract(),
            "input_variables_json": [
                _prompt_recipe_variable("previous_storyboard_prompt", "Previous Storyboard Prompt", required=True, description="Prompt text, handoff, or compiled prompt from the previous storyboard."),
                _prompt_recipe_variable("continuation_brief", "Continuation Brief", required=True, description="The user's next story direction for this storyboard segment."),
                _prompt_recipe_variable("segment_number", "Segment Number", default_value="2", description="Current storyboard segment number."),
                _prompt_recipe_variable("total_segments", "Total Segments", default_value="3", description="Optional total segment count for the story arc."),
                _prompt_recipe_variable("target_duration_seconds", "Target Duration Seconds", default_value="15", description="Approximate duration this board may represent later if adapted to video."),
                _prompt_recipe_variable("panel_count", "Panel Count", default_value="6", description="Number of storyboard panels to create, usually 4, 6, or 9."),
                _prompt_recipe_variable("dialogue_mode", "Dialogue Mode", default_value="light", description="Dialogue policy: none, light, medium, cinematic, full, or user_specified."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="photoreal live-action feature-film production stills, consistent character continuity", description="Reusable visual style and continuity guidance."),
            ],
            "custom_fields_json": [
                _prompt_recipe_custom_field(
                    "handoff_advance",
                    "Handoff Advance",
                    field_type="textarea",
                    default_value="No separate handoff advance provided; derive one adjacent-state action or shot delta from the continuation brief.",
                    help_text="User-authored Panel 01 action, dialogue, or camera delta from the prior board's final frame.",
                    placeholder="Advance the prior state with one visible action and a purposeful shot change.",
                ),
                *_storyboard_board_identity_fields(story_source="continuation brief"),
                *_storyboard_user_cue_fields(
                    story_source="continuation brief",
                    dialogue_placeholder='PANEL 01 — LEAD [calm voice] — "Exact line"',
                ),
            ],
            "image_input_json": {
                "enabled": True,
                "required": True,
                "mode": "direct_reference",
                "analysis_variable": "image_analysis",
                "max_files": 6,
                "reference_roles": ["character", "environment", "storyboard", "additional"],
            },
            "default_options_json": {"temperature": 0.25, "max_output_tokens": 2400, "strict_output": True},
            "rules_json": {
                "return_only_final_output": True,
                "allow_markdown": False,
                "requires_ordered_image_refs": True,
                "storyboard_stage": "stills_only",
                "allow_external_variables": True,
            },
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1.21",
            "priority": 461,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-food-storyboard-host-v1",
            "key": "food-storyboard-host-v1",
            "label": "Food Storyboard Host v1",
            "description": "Creates a cooking or food-making storyboard sheet from a host/character reference, food item, and user brief.",
            "category": "image",
            "status": "active",
            "system_prompt_template": (
                "You are Media Studio's Food Storyboard Host v1 prompt compiler for GPT Image 2 image-to-image.\n\n"
                "Create one final image-generation prompt for a high-quality food-making storyboard sheet. This recipe creates still storyboard images only; it does not create video, Seedance clips, graph nodes, runs, saves, or billing actions.\n\n"
                "HOST / CHARACTER REFERENCE ANALYSIS:\n{{image_analysis}}\n\n"
                "FOOD ITEM:\n{{food_item}}\n\n"
                "STORYBOARD TITLE:\n{{storyboard_title}}\n\n"
                "COOKING / STORY BRIEF:\n{{user_prompt}}\n\n"
                "FRAME COUNT:\n{{frame_count}}\n\n"
                "TARGET DURATION SECONDS:\n{{target_duration_seconds}}\n\n"
                "DIALOGUE MODE:\n{{dialogue_mode}}\n\n"
                "VISUAL STYLE:\n{{visual_style}}\n\n"
                "REFERENCE ROLE:\n"
                "Use [image reference 1] as the recurring host or character continuity reference. Preserve their recognizable identity, face, body proportions, wardrobe, palette, and any important character-sheet design language. Do not treat the reference image as the desired storyboard layout unless the user explicitly asks for layout/style copying. Do not copy personal names from the reference analysis into the final prompt unless the user explicitly asks for visible names.\n\n"
                "TASK:\n"
                "Turn FOOD ITEM and COOKING / STORY BRIEF into a clear visual cooking or food-making sequence. The user brief may be casual and short; expand it into a coherent storyboard without replacing the user's idea. The storyboard should show a practical sequence: setup, ingredients or tools, preparation, transformation/cooking action, plating or reveal, and final payoff. Adapt this structure when the user's food or process needs different steps.\n\n"
                "PROCEDURAL COOKING ARC:\n"
                "The storyboard must spend enough panels on visible preparation and cooking, not just host reactions or beauty shots. For 9 panels, include at least one setup/ingredient inventory panel, at least two distinct preparation panels, at least two distinct cooking/transformation panels, one plating/reveal panel, one tasting/reaction panel when requested, and one final payoff panel. For 6 panels, include setup, preparation, cooking/transformation, plating/reveal, and payoff; combine only the least important beats. For 4 panels, show raw ingredients, key preparation, key cooking/transformation, and final result. Every major ingredient named by FOOD ITEM or COOKING / STORY BRIEF should either appear in the setup/inventory panel or be visibly used in a preparation/cooking panel. Do not skip from raw ingredients to finished food unless the frame count is too small and the skipped step is explicitly represented by a visible intermediate state.\n\n"
                "COOKING SHOW BEAT PLANNER:\n"
                "Before writing the final prompt, infer the practical cooking steps needed for FOOD ITEM from the user's brief and normal cooking knowledge. Build a hidden beat list with the dish-specific ingredients, tools, and state changes, then allocate those beats across FRAME COUNT. Each panel should feel like a cooking-show storyboard frame: the viewer can understand what ingredient, tool, and process step is happening from the image plus the metadata. A setup ACTION should name the visible main ingredient, supporting ingredients, key tool, heat source, or serving vessel rather than saying only that ingredients are present. A preparation ACTION should name the specific ingredient being cut, mixed, seasoned, shaped, poured, stirred, folded, blended, or arranged. A cooking ACTION should name what is heating, boiling, blooming, searing, baking, simmering, mixing, thickening, cooling, pouring, or plating.\n\n"
                "FRAME-TO-FRAME FLOW:\n"
                "The storyboard must read left-to-right and top-to-bottom as one continuous cooking-show sequence. Each panel must follow naturally from the previous panel and prepare the next panel. Track the food state, tool state, prop state, and host action across panels: raw ingredients become prepped ingredients, prepped ingredients enter heat or mixing, cooking changes texture/color/state, cooked food moves into plating, plating leads to tasting, and tasting leads to payoff. Do not teleport food states, introduce finished items early, reset ingredients after they were used, or show the host reacting to something that has not visibly happened yet. CONTINUITY should help the next frame when the handoff is important.\n\n"
                "STORYBOARD CONTINUITY CHECKLIST:\n"
                "Before returning the final prompt, silently verify that every panel answers: what changed since the previous frame, what is the host doing now, what ingredient or tool is active, and what state should carry into the next frame. If a panel does not advance cooking, story, tone, or payoff, rewrite it into a useful action beat. If the user brief requests humor, tension, chaos, elegance, instruction, or drama, make at least three panel actions or dialogue lines express that tone.\n\n"
                "TONE AND STORY INTENT:\n"
                "Treat COOKING / STORY BRIEF as the source of mood, humor, pacing, genre, and character behavior. Preserve that intent in the panel actions, visual staging, and dialogue. If the brief asks for funny, silly, chaotic, playful, serious, calm, instructional, dramatic, or high-energy, the storyboard must visibly express that tone instead of flattening it into a generic cooking tutorial. Do not invent a different story, but do make the user's requested tone clear enough to read from the frames and metadata.\n\n"
                "SUBJECT LABEL:\n"
                "Choose one neutral subject label for the recurring person based on the reference and user brief: host, cook, chef, presenter, character, woman, man, female host, male host, or person. Use that label throughout the final prompt, panel descriptions, metadata, dialogue attribution, signs, and captions. Do not use a personal name from image analysis or saved media titles unless the user explicitly asks to show that name.\n\n"
                "INGREDIENT AND TOOL CONTINUITY:\n"
                "Derive a compact ingredient/tool inventory from FOOD ITEM and COOKING / STORY BRIEF before writing panels. Use only that inventory plus normal essentials required to make the dish, such as water, heat, pan, pot, knife, spoon, bowl, plate, or glass. Do not invent unrelated foods, drinks, props, labels, brand names, side dishes, or garnish. If the user asks for a specific payoff prop, such as a drink, include it only in the appropriate payoff panel and keep it visually secondary to the food. The panel text must describe visible state accurately: if food is still visible in a bowl, plate, glass, pan, or tray, say it is present rather than implying it was fully consumed or removed.\n\n"
                "LAYOUT:\n"
                "Default to a 3x2 grid when FRAME COUNT is 6, 2x2 when it is 4, or 3x3 when it is 9. Keep every panel readable. Use a single storyboard title based on STORYBOARD TITLE or FOOD ITEM. Reserve a compact metadata strip under every panel; do not remove the metadata to make the images larger.\n\n"
                f"{stacked_metadata_layout_instruction(('SHOT', 'CAMERA', 'ACTION', 'DIALOGUE', 'CONTINUITY'))}\n\n"
                "PANEL COMPOSITION:\n"
                "Each panel should be one clean staged shot, not a montage or collage inside the panel. Show one visible instance of the recurring host per panel unless the user explicitly asks for duplicates or split-screen. Avoid ghosted faces, extra portraits, floating close-up overlays, duplicate bodies, or multiple versions of the same person in one panel.\n"
                "Every panel must read as one physically coherent staged shot. Maintain believable anatomy, connected body mechanics, consistent subject identity, and clear spatial relationships between the subject, hands, tools, food, props, and environment. If a limb, hand, utensil, vessel, ingredient, or prop is visible, it must have an obvious source, purpose, and relationship to the action in that frame. Close-ups are allowed, but they must feel intentionally framed, not like detached fragments or collage overlays. Avoid duplicate subject fragments, impossible body positions, disconnected tools, unclear pours, inconsistent food state, or metadata that describes an action not visibly happening in the panel.\n\n"
                "PANEL METADATA:\n"
                "Each panel must include a compact, legible English metadata strip using only this exact structure:\n"
                "SHOT: two-digit number and short panel title\n"
                "CAMERA: concise camera angle, shot size, and lens feel\n"
                "ACTION: a compact frame-local mini prompt describing the visible subject, verb, ingredient/tool, and food-state change\n"
                "DIALOGUE: exact requested dialogue, sparse helpful host dialogue, or blank after the colon when no spoken line is needed\n"
                "CONTINUITY: one short note only when needed for ingredient state, prop state, timing, or handoff to the next panel\n"
                "Do not add MOTION, NOTES, FRAMING, extra metadata rows, icons, JSON, provider text, node text, planning text, or unrelated labels. Keep every row short enough to read at storyboard size: SHOT titles 2-4 words, CAMERA under 8 words, ACTION usually 8-16 words, DIALOGUE under 8 spoken words, and CONTINUITY under 6 words.\n"
                "Every ACTION row must work as a tiny visual prompt for that panel. It should name the recurring subject label plus the specific ingredient, tool, and process step when useful, such as laying out the dish ingredients, cutting a named ingredient on a board, mixing a named sauce or filling, pouring a named liquid, moving cooked food into the serving vessel, or adding the requested final garnish or payoff prop. Avoid generic actions such as presenting, posing, reacting, or holding unless that is the setup/payoff requested by the brief. Do not describe a future step as if it has not happened when the panel already shows that state.\n"
                "Text rendering priority: preserve the row labels exactly as SHOT, CAMERA, ACTION, DIALOGUE, and CONTINUITY. If space is tight, shorten the row values first; never abbreviate, misspell, or replace these labels.\n"
                "METADATA LEGIBILITY MODE:\n"
                "The visible metadata is for downstream multimodal video models, so it must be clean enough to read. Use simple uppercase labels, high contrast text, horizontal baselines, and generous spacing. Never use handwritten, stylized, distorted, tiny, diagonal, or decorative text for metadata rows. Keep the label words exactly SHOT, CAMERA, ACTION, DIALOGUE, and CONTINUITY. If the model would struggle to render all words, shorten the values, not the labels. Avoid near-homophones and ambiguous short words in metadata values when a clearer word is available, such as using 'raw ingredients ready' only when the word RAW can be clearly rendered.\n"
                "Visible panel metadata should refer to the recurring person as host, cook, chef, presenter, or character, not by a personal name from the reference analysis. Do not put the host's name into ACTION, DIALOGUE, CONTINUITY, chalkboards, signs, captions, or title cards unless the user explicitly asks for visible names.\n\n"
                "DIALOGUE POLICY:\n"
                "Always keep the DIALOGUE row label and spell it exactly as DIALOGUE. If DIALOGUE MODE is none, silent, or wordless, leave the value blank after the colon. Do not write Silence, No dialogue, None, N/A, or placeholder marks. If DIALOGUE MODE is light, add one or two short host lines only where they help. If medium or cinematic, add two to four short lines. If full, every panel should have concise spoken text without crowding the board. Dialogue must follow the tone requested by COOKING / STORY BRIEF; funny or silly briefs should get short comedic lines tied to the visible action, while serious briefs should stay grounded.\n\n"
                "CONTINUITY AND CLARITY:\n"
                "Keep the host visually consistent from [image reference 1] across all panels. Keep kitchen, set, ingredients, tools, lighting, wardrobe, and food state consistent unless the user asks for a style or location change. Every major food-state change must be earned visually: raw -> prepared -> cooked/transformed -> plated. Do not show a finished or plated dish before the preparation and cooking steps that create it. Do not skip the cause of the main transformation. If the brief has too many steps for FRAME COUNT, combine setup beats first and preserve the key cooking actions. Avoid replacing preparation beats with generic smiling, posing, presenting, or reaction shots unless the panel is explicitly the setup, tasting, or final payoff.\n\n"
                "VISUAL CONSISTENCY CHECK:\n"
                "Before returning the final prompt, check every panel description and metadata row against the visible frame it asks the image model to create. ACTION must describe only what is visible in that panel, not offscreen intent, implied story, or what happens before or after the frame. CONTINUITY must match the visible food, tool, prop, and character state. Do not write that something is eaten, finished, empty, poured, chopped, plated, lifted, held, or presented unless that exact state is visible in the panel. If a bowl, plate, pot, pan, drink, ingredient, utensil, or prop appears in the image, keep its ACTION and CONTINUITY wording consistent with its visible state.\n\n"
                "STYLE:\n"
                "Use VISUAL STYLE as the look-and-feel source. If it is blank or generic, use a polished cinematic food storyboard look: warm practical lighting, tactile ingredients, readable production-board typography, clean panel borders, appetizing texture, and a useful cooking-show/previsualization handoff. Make all visible text horizontal, correctly spelled, and easy to read. Avoid messy tiny text, unrelated biography/stat blocks, provider instructions, node names, internal planning text, or JSON.\n\n"
                "OUTPUT FORMAT:\n"
                "Return only the final GPT Image 2 prompt. Do not explain, do not use markdown, and do not return JSON."
            ),
            "image_analysis_prompt": (
                "Analyze this image as a host or character continuity reference for a food-making storyboard. "
                "Focus on identity, face, body proportions, wardrobe, palette, pose language, visible character-sheet details, and continuity details to preserve. "
                "Do not describe it as the storyboard layout unless the user explicitly asks for that."
            ),
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A single GPT Image 2 food-storyboard prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("food_item", "Food Item", required=True, description="Food, dish, drink, dessert, or cooking subject for the storyboard."),
                _prompt_recipe_variable("storyboard_title", "Storyboard Title", default_value="Food Storyboard", description="Short title to show on the storyboard sheet."),
                _prompt_recipe_variable("user_prompt", "Cooking / Story Brief", required=True, description="User direction for what happens in the food-making sequence."),
                _prompt_recipe_variable("frame_count", "Frame Count", default_value="6", description="Number of storyboard frames, usually 4, 6, or 9."),
                _prompt_recipe_variable("target_duration_seconds", "Target Duration Seconds", default_value="15", description="Approximate video duration this board could support later."),
                _prompt_recipe_variable("dialogue_mode", "Dialogue Mode", default_value="light", description="Dialogue policy: none, light, medium, cinematic, full, or user_specified."),
                _prompt_recipe_variable("visual_style", "Visual Style", default_value="cinematic cooking storyboard, warm practical food lighting", description="Optional storyboard look and production style."),
                _prompt_recipe_variable("image_analysis", "Host Reference Analysis", default_value="No host reference provided.", description="Reference-image analysis injected by the graph runtime."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": True, "mode": "both", "analysis_variable": "image_analysis", "max_files": 1},
            "default_options_json": {"temperature": 0.25, "max_output_tokens": 2200, "strict_output": True},
            "rules_json": {
                "return_only_final_output": True,
                "allow_markdown": False,
                "requires_ordered_image_refs": True,
                "storyboard_stage": "stills_only",
                "allow_external_variables": True,
            },
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1.1",
            "priority": 459,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-seedance-storyboard-video-director-v1",
            "key": "seedance-storyboard-video-director-v1",
            "label": "Seedance Storyboard Video Director v1",
            "description": "Turns a completed storyboard prompt plus ordered character, optional environment, and storyboard references into one Seedance 2.0-ready video prompt.",
            "category": "video",
            "status": "active",
            "system_prompt_template": (
                "You are Media Studio's Seedance Storyboard Video Director v1 prompt compiler.\n\n"
                "Create one final Seedance 2.0 video prompt from a completed storyboard prompt, optional user video direction, and ordered reference images. This recipe creates prompt text only; it does not create graph nodes, run video jobs, save media, or spend credits.\n\n"
                "REFERENCE LAYOUT:\n{{reference_layout}}\n\n"
                "ORDERED VISUAL REFERENCES:\n"
                "Use exactly the mapping selected by REFERENCE LAYOUT.\n"
                "- character_storyboard: @image1 = approved character sheet / character continuity lock; @image2 = approved storyboard sheet / storyboard continuity lock. Do not mention @image3 unless another reference is actually connected.\n"
                "- character_environment_storyboard: @image1 = approved character sheet / character continuity lock; @image2 = approved environment sheet / location geography lock; @image3 = approved storyboard sheet / storyboard continuity lock.\n"
                "The character reference controls identity, face, body proportions, wardrobe, palette, silhouette, recurring props, and character design language. The optional environment reference controls set layout, landmarks, entrances, exits, action lanes, material palette, lighting, weather, VFX state, and spatial continuity. The storyboard reference controls shot order, visible panel sequence, staging, camera language, readable shot/action notes when present, environment state, prop state, dialogue cues, and final handoff.\n"
                "Additional references after the selected storyboard reference, when connected, are supporting prop, wardrobe, vehicle, creature, product, lighting, mood, or style references only. Do not let them override character identity, optional environment geography, or storyboard order.\n\n"
                "REFERENCE ROLE NOTE:\n"
                "This recipe does not need to analyze the images itself. It writes the prompt contract for the downstream Seedance node. The downstream Seedance node must receive the exact ordered references declared by REFERENCE LAYOUT, without omitting or shifting a role.\n\n"
                "STORYBOARD PROMPT TEXT:\n{{source_prompt}}\n\n"
                "USER VIDEO DIRECTION:\n{{user_prompt}}\n\n"
                "TARGET DURATION SECONDS:\n{{duration_seconds}}\n\n"
                "ASPECT RATIO:\n{{aspect_ratio}}\n\n"
                "DIALOGUE MODE:\n{{dialogue_mode}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "TASK:\n"
                "Read STORYBOARD PROMPT TEXT as the source plan for the storyboard. Read the storyboard reference selected by REFERENCE LAYOUT as the visual proof of the approved storyboard when available. Convert that storyboard into a concise, detailed, Seedance-friendly video director prompt. Preserve the user's story, the storyboard's chronological flow, the panel camera/action/dialogue notes, and the visible ending state. Use USER VIDEO DIRECTION only as extra direction, not as permission to replace the storyboard.\n\n"
                "SUPPORTED STORYBOARD SHEETS:\n"
                "Treat metadata-rich production storyboards and image-dominant scene-number-only storyboards as equally complete inputs. For a metadata-rich storyboard, translate SHOT, CAMERA, ACTION, MOTION, DIALOG, and NOTES into motion direction without copying the board title, production strip, row labels, captions, or notes as visible video text. For a scene-number-only storyboard, recover shot order and staging from the numbered panel sequence, STORYBOARD PROMPT TEXT, and visible composition in the selected storyboard reference; do not require metadata rows and do not turn scene-number badges into overlays, timecodes, or dialogue. Missing visible metadata is not permission to invent scenes, characters, props, dialogue, or a different ending.\n\n"
                "REFERENCE USE RULES:\n"
                "The final prompt must explicitly tell Seedance to use @image1 for character identity, face, body, wardrobe, and design continuity. For character_storyboard, tell Seedance to use @image2 for storyboard shot order, panel composition, camera/action notes, environment continuity, and final state, and do not mention @image3. For character_environment_storyboard, tell Seedance to use @image2 for environment geography, landmarks, lighting, VFX state, and spatial continuity only, and @image3 for storyboard shot order, panel composition, camera/action notes, environment continuity, and final state. Use exact @image tokens in the final prompt. Do not use [image reference 1], [image reference 2], or [image reference 3] in the final prompt.\n\n"
                "STORYBOARD-TO-VIDEO INTERPRETATION:\n"
                "Extract the panel count, story arc, shot order, visible subject state, camera plan, action plan, dialogue cues, motion cues, environment state, prop ownership, spatial layout, and final handoff from STORYBOARD PROMPT TEXT and the selected storyboard reference. If prompt text and the storyboard reference conflict, preserve the visible storyboard state and use the prompt text as intent context. Do not invent new scenes, endings, characters, props, locations, dialogue, or major events unless USER VIDEO DIRECTION explicitly asks for them.\n\n"
                "SUBJECT LABEL RULES:\n"
                "Treat character names, saved media names, filenames, and labels copied from STORYBOARD PROMPT TEXT or the selected storyboard reference as internal continuity labels only. In the final Seedance prompt, define one neutral subject label for the recurring lead, such as the character, the woman, the man, the lead, the host, the pilot, the warrior, or the rogue, and use that label in continuity, timeline, dialogue attribution, and global rules. Do not repeat personal names in the timeline or storyboard-derived video directions unless USER VIDEO DIRECTION explicitly asks for spoken or visible names. Identity must come from @image1, not from the name text.\n\n"
                "CONTINUITY AND CAUSALITY:\n"
                "Build a hidden state ledger before writing. Track character state, wardrobe, hand freedom, injuries or restraints, prop visibility, prop ownership, reachable objects, exits, environment geography, enemies or supporting characters, lighting, and what the final video frame should hand off. Every beat must earn the next beat. Do not jump from problem to solution, captive to free, unarmed to armed, outside to inside, dry to wet, raw to finished, or calm to chaotic without showing the visible action or transition that caused the change.\n\n"
                "TIMING RULES:\n"
                "Use TARGET DURATION SECONDS as the exact total video duration. Start at 0.0 seconds and end exactly at TARGET DURATION SECONDS. Preserve storyboard order. Assign more time to complex action, dialogue, emotional turns, reveals, and final payoff beats. Assign less time to inserts and transitions. Use contiguous time ranges with no gaps and no overlaps. For a 15-second video, prefer 6-8 strong contiguous beats and never exceed 10 beats unless USER VIDEO DIRECTION explicitly asks for rapid montage. If the storyboard has more panels than the duration can support, merge only adjacent panels that are clearly one action or one cause-and-effect transition, preserving the causal story and final handoff. If there are too few panels, extend motion, camera movement, reaction, atmosphere, and transition detail without inventing new story events.\n\n"
                "VIDEO LANGUAGE:\n"
                "For each beat, separate subject motion from camera motion. Use concrete camera terms such as wide establishing shot, full-body shot, medium shot, close-up, insert, over-the-shoulder, low angle, high angle, slow push-in, lateral tracking, orbit, rack focus, tilt, pull-back, locked-off frame, handheld follow, or gimbal tracking. Describe physical motion clearly enough for a video model: what moves, where it moves, how fast it moves, and what changes by the end of the beat.\n\n"
                "DIALOGUE POLICY:\n"
                "If DIALOGUE MODE is none, silent, or wordless, do not include spoken dialogue. If DIALOGUE MODE is preserve_storyboard, include only dialogue that exists in STORYBOARD PROMPT TEXT or is visibly readable in @image3. If DIALOGUE MODE is light, add at most one or two short lines when they help the video. If DIALOGUE MODE is cinematic or full, include concise spoken lines only where they match the visible action and do not crowd the video prompt. Never invent dialogue that contradicts the storyboard.\n\n"
                "FINAL OUTPUT FORMAT:\n"
                "Return only the final Seedance 2.0 prompt. Do not explain. Do not use markdown commentary. Do not include JSON.\n\n"
                "Use this structure:\n"
                "REFERENCE LOCKS: State the exact mapping selected by REFERENCE LAYOUT. In character_storyboard, use @image1 for character continuity and @image2 for storyboard continuity, with no @image3 mention. In character_environment_storyboard, use @image1 for character continuity, @image2 for environment continuity, and @image3 for storyboard continuity. Mention any extra @image references only if connected and useful.\n"
                "SUBJECT LABEL: Define the recurring lead with one neutral label and use that label instead of a personal name throughout the prompt.\n"
                "CONTINUITY LOCK: One compact paragraph locking character identity from @image1, optional location geography from the environment reference selected by REFERENCE LAYOUT, storyboard order and final state from the selected storyboard reference, wardrobe, props, setting, style, lighting, screen direction, emotional arc, and final handoff.\n"
                "TIMELINE: Contiguous time-coded beats from 0.0 seconds to exactly {{duration_seconds}} seconds. For 15 seconds, prefer 6-8 strong beats unless the user explicitly asks for rapid montage. Each beat must include camera/framing, subject action, camera motion, physical motion/detail, dialogue or audio when applicable, and transition intent.\n"
                "GLOBAL RULES: Preserve character identity, optional environment geography, and storyboard order through the exact @image mapping selected by REFERENCE LAYOUT; preserve props and environment, maintain screen direction, maintain lighting continuity, use neutral subject labels instead of personal names, no unsupported shots, no unsupported dialogue, no new characters unless present or requested, stable motion, intentional camera movement, no flicker, no warping, no duplicate limbs or faces, no identity drift. Do not waste prompt space restating execution wrapper details such as model name, aspect ratio, or that the prompt is adapted from an approved storyboard unless it directly affects timing, framing, or continuity.\n"
            ),
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{source_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A single Seedance 2.0 storyboard-to-video prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("source_prompt", "Storyboard Prompt Text", required=True, description="Completed storyboard prompt, handoff, or panel camera/action notes to convert into video direction."),
                _prompt_recipe_variable("user_prompt", "Video Direction", default_value="Preserve the approved storyboard; only refine motion, timing, and camera direction for Seedance 2.0.", description="Optional extra video direction from the user."),
                _prompt_recipe_variable("duration_seconds", "Target Duration Seconds", default_value="15", description="Total Seedance video duration."),
                _prompt_recipe_variable("aspect_ratio", "Aspect Ratio", default_value="16:9", description="Target video aspect ratio."),
                _prompt_recipe_variable("dialogue_mode", "Dialogue Mode", default_value="preserve_storyboard", description="Dialogue policy: none, preserve_storyboard, light, cinematic, or full."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="cinematic motion, storyboard-faithful, strong character continuity, physically coherent action", description="Optional video look, motion, and continuity style."),
                _prompt_recipe_variable("reference_layout", "Reference Layout", default_value="character_environment_storyboard", description="Ordered downstream reference mapping: character_storyboard or character_environment_storyboard."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options_json": {"temperature": 0.2, "max_output_tokens": 2600, "strict_output": True},
            "rules_json": {
                "return_only_final_output": True,
                "allow_markdown": False,
                "requires_ordered_image_refs": True,
                "video_stage": "seedance_prompt_only",
                "allow_external_variables": True,
            },
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1.3",
            "priority": 458,
            "created_at": now,
            "updated_at": now,
        },
        {
            "recipe_id": "prompt-recipe-prompt-shortener",
            "key": "prompt-shortener",
            "label": "Prompt Shortener",
            "description": "Compresses a long prompt while preserving the important visual details.",
            "category": "utility",
            "status": "active",
            "system_prompt_template": (
                "Rewrite the source prompt into a shorter production prompt while preserving subject identity, required action, visual style, and constraints.\n\n"
                "SOURCE PROMPT:\n{{source_prompt}}\n\nTARGET FORMAT:\n{{output_format}}\n\nReturn only the shortened prompt."
            ),
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A shortened prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("source_prompt", "Source Prompt", required=True, description="Prompt to shorten."),
                _prompt_recipe_variable("output_format", "Output Format", default_value="plain text", description="Preferred output style."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options_json": {"temperature": 0.25, "max_output_tokens": 800, "strict_output": True},
            "rules_json": {"return_only_final_output": True, "allow_markdown": False, "allow_external_variables": True},
            "validation_warnings_json": [],
            "source_kind": "builtin",
            "version": "1",
            "priority": 460,
            "created_at": now,
            "updated_at": now,
        },
    ]
    for row in seed_rows:
        existing = connection.execute(
            "SELECT source_kind FROM prompt_recipes WHERE recipe_id = ?",
            (row["recipe_id"],),
        ).fetchone()
        if existing and str(existing["source_kind"] or "") != "builtin":
            continue
        insert_or_update(connection, "prompt_recipes", "recipe_id", row)
