from __future__ import annotations

import sqlite3
from typing import Any, Dict

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
                "Default format: a cinematic 3x3 grid of nine panels with clear borders, readable panel numbers, and short captions below each panel.\n\n"
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
            "version": "1",
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
            "description": "Creates a cinematic storyboard-sheet prompt from an approved character sheet, compact story brief, and optional previous-board handoff.",
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
                "USER STORY BRIEF:\n{{user_prompt}}\n\n"
                "Create a high-quality cinematic storyboard sheet from the creative direction in USER STORY BRIEF. The user brief can be short; expand it into a readable panel sequence without replacing the user's idea. Use [image reference 1] as the facial lock / identity reference when present and [image reference 2] as the approved character sheet / body, outfit, and style reference when present. If only one image reference is connected and it is an approved character sheet, treat it as the primary continuity anchor for identity, wardrobe, body, palette, and genre language.\n\n"
                "The output should look like a premium storyboard / previsualization sheet with pencil-sketch or inked concept-art styling, strong cinematic composition, readable English labels, and concise director notes under each cell. Do not remove the per-cell notes to make the images larger; the notes are part of the deliverable.\n\n"
                "REFERENCE INPUTS:\n"
                "[image reference 1] = facial lock / identity reference when a separate face ref is connected, or primary approved character sheet when it is the only connected image.\n"
                "[image reference 2] = approved character sheet / body, outfit, and style reference when connected separately. Use this as the source for body proportions, outfit, accessories, silhouette, styling, and overall character design language.\n"
                "Additional image references, when connected, are supporting set, location, prop, wardrobe, creature, product, vehicle, atmosphere, or environment references only. Do not let them override the primary character identity.\n"
                "The main character must remain visually consistent across the storyboard unless USER STORY BRIEF specifically asks for transformation, mutation, costume change, or abstraction. If transformation is requested, preserve identity continuity in the early and mid shots, then preserve the character's essence, silhouette, movement language, or visual motifs in later abstract shots.\n\n"
                "STORY INTERPRETATION:\n"
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
                "CHARACTER NAMING:\n"
                "Treat local project nicknames and character labels as internal labels unless USER STORY BRIEF explicitly asks for a name to appear as visible text. In storyboard labels and director notes, prefer generic subject wording like the character, the woman, the lead, the rogue, the warrior, the captor, or the guards. Do not combine a private character name with staging notes, and do not rely on a name for identity; identity comes from the connected character-sheet reference.\n\n"
                "REFERENCE TEXT GUARD:\n"
                "Connected character sheets and references are visual continuity sources only. Do not copy visible name, title, project, footer, profile-card, stat, or UI label text from connected reference images. Storyboard titles, headers, footers, labels, and director-note rows should use generic subject wording unless USER STORY BRIEF explicitly asks for a visible character name.\n\n"
                "DIALOGUE POLICY:\n"
                "Always keep the DIALOG row label as part of the metadata structure, but leave the value after the colon truly empty when there is no spoken line for that panel. Do not write Silence, No dialogue, None, breath, reaction cue, nonverbal cue, a dash, an em dash, a hyphen, N/A, or any placeholder mark in the DIALOG row; put nonverbal acting in ACTION or NOTES instead.\n"
                "Use DIALOGUE MODE as the control unless USER STORY BRIEF gives a more specific instruction. none, silent, or wordless means every DIALOG value is blank. light means one or two short spoken lines only where they clarify the beat. medium or cinematic means two to four short lines across the board when the scene benefits from speech. full means every panel should contain a concise quoted spoken or reaction line, without placeholders and without crowding the metadata. user_specified means preserve exact quoted user lines and place them in the correct chronological panels.\n"
                "If USER STORY BRIEF asks for no dialogue, no speech, silent action, or a wordless board, every DIALOG row should be blank after the colon.\n"
                "If USER STORY BRIEF says the character talks, dialogue enabled, dialog enabled, some dialogue, dialog sort of, medium dialogue, cinematic dialogue, full dialogue, or gives similar direction without exact lines, follow that density using short in-character lines only where they help the beat.\n"
                "If USER STORY BRIEF includes exact quoted dialogue, place those exact words in the relevant DIALOG row. Do not invent extra dialogue beyond the requested density. If DIALOGUE MODE requests light, medium, cinematic, full, or user_specified dialogue, at least the requested number of panels must contain actual quoted speech text rather than blank or placeholder DIALOG values. For full dialogue, every DIALOG value should be actual quoted speech text; never use parenthetical silence.\n\n"
                "LONG STORY / MULTI-BOARD PLANNING:\n"
                "One storyboard sheet should represent one coherent story segment, not an entire long movie. For longer arcs, treat each board as a compact segment with a clear setup, escalation, payoff, and final handoff image.\n"
                "If USER STORY BRIEF says this is Storyboard N, segment N, next board, previous board, continuation, or a 15-second segment, make the sequence feel like that slice of the larger story.\n"
                "Use PREVIOUS BOARD HANDOFF to preserve character state, injuries, wardrobe changes, carried props, location geography, lighting, enemies, and unresolved action from the prior board.\n"
                "If this board starts from a previous board, the first panel must be compatible with the previous final panel. Explicitly carry forward whether the character is bound or free, what object is held, where the threat is, where the exit is, and what obstacle is still unresolved.\n"
                "When the brief mentions scene/set/prop references, keep those elements consistent enough that later boards can reuse the same world without requiring a new prompt rewrite.\n\n"
                "STORY STRUCTURE:\n"
                "Default to exactly 6 storyboard cells in a 3x2 grid. If SHOT COUNT explicitly requests 4 or 9, adapt the same rules to a 2x2 or 3x3 grid.\n"
                "Each cell should represent a distinct beat with visual continuity from the previous cell.\n"
                "Use this default progression unless USER STORY BRIEF suggests a better structure:\n"
                "01 - SETUP / ESTABLISHING BEAT / CURRENT STATE\n"
                "02 - PRESSURE / FIRST ATTEMPT / OBSTACLE DETAIL\n"
                "03 - DISCOVERY / TOOL / DECISION / TURNING POINT\n"
                "04 - DECISIVE ACTION / CAUSAL BRIDGE / MAJOR VISUAL CHANGE\n"
                "05 - CONSEQUENCE / TRANSITION / ESCAPE OR RESOLUTION\n"
                "06 - FINAL PAYOFF / CLIMAX / END IMAGE\n\n"
                "VISUAL STYLE:\n"
                "Use STYLE DIRECTION and the visual style requested in USER STORY BRIEF. If no style is specified, use premium pencil-sketch / inked cinematic concept-art storyboard styling.\n"
                "Use a dark near-black production board background, thin yellow-orange UI lines, subtle panel borders, faint film grain, clean typography, and high-end film/game previsualization design.\n"
                "The storyboard should feel professional, cinematic, readable, and production-ready. Images should dominate the board, but every cell must reserve a readable metadata strip below the image. Keep notes compact and useful, not tiny or decorative.\n\n"
                "CAMERA / DIRECTOR LANGUAGE:\n"
                "Each cell must include a practical director-note block below the image. This block is required, not optional, and should take roughly 20-28% of each cell height so it remains readable at final resolution.\n"
                "Use the same compact structure under every cell:\n"
                "SHOT: two-digit number and short title\n"
                "CAMERA: camera type, angle, movement, and lens feel\n"
                "FRAMING: shot size and subject placement\n"
                "ACTION: what the character, important prop, creature, vehicle, or scene element is doing\n"
                "MOTION: camera motion, subject motion, environmental motion, rhythm, VFX timing, or transformation timing\n"
                "DIALOG: exact user-requested dialogue, sparse dialogue when requested, or blank after the colon when no spoken line is needed; do not put speech bubbles on the storyboard\n"
                "NOTES: optional, only if useful for VFX, continuity, emotion, item/prop state, or handoff to a video director\n\n"
                "The metadata block should read like production handoff data: camera shot, character action, item/prop action, dialogue, motion, and continuity should be understandable without rereading the prompt.\n\n"
                "Use camera language appropriate to USER STORY BRIEF: FPV drone, dolly, orbit, tracking, push-in, pullback, low sweep, overhead, handheld, locked-off, crane, spiral, wraparound, parallax, close-up, extreme wide, over-shoulder, or insert shot.\n\n"
                "CONTINUITY RULES:\n"
                "Keep the main character centered or framed according to USER STORY BRIEF.\n"
                "Maintain continuity of face, body, outfit, environment, lighting, and motion unless the prompt asks for progressive change.\n"
                "If transformation is requested, make it grow clearly from shot to shot rather than appearing randomly.\n"
                "Keep subject placement, camera direction, and scene geography understandable. Every cell should read as part of one continuous sequence.\n\n"
                "ACTION CLARITY:\n"
                "Each frame must communicate what is happening immediately. Use readable silhouettes, clear poses, directional motion, background cues, and strong composition. Avoid vague beauty shots unless USER STORY BRIEF specifically asks for a mood board rather than action beats.\n\n"
                "TEXT RULES:\n"
                "All labels must be in English. Keep text short and readable. Avoid tiny paragraphs. Do not add long character bios, stats, powers lists, or profile-card metadata. Do not omit the SHOT / CAMERA / FRAMING / ACTION / MOTION / DIALOG director-note structure. Use a cinematic title based on USER STORY BRIEF unless the user provides one. Include a subtle footer with PROJECT, VERSION, STYLE / MOOD, and BOARD number.\n\n"
                "OUTPUT FORMAT:\n"
                "Return only the final GPT Image 2 prompt. Do not explain, do not use markdown, and do not return JSON.\n"
                "A single 4K-quality 3x2 cinematic storyboard sheet by default. Premium pencil-sketch / inked concept-art storyboard look unless USER STORY BRIEF requests another style. Readable English labels. Required readable director-note metadata under every cell with SHOT, CAMERA, FRAMING, ACTION, MOTION, DIALOG, and optional NOTES. Strong camera framing and video-director handoff value. Grounded in the approved character sheet / identity references for character continuity and USER STORY BRIEF for the story.\n"
                "Do not include model/provider instructions, pricing, node names, biographies, stat blocks, capability lists, or internal planning text."
            ),
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A single GPT Image 2 storyboard-sheet prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("user_prompt", "Story / Scene Brief", required=True, description="Story beat, scene list, or storyboard brief to turn into one sheet."),
                _prompt_recipe_variable("previous_output", "Previous Board Handoff", default_value="No previous board handoff provided.", description="Optional ending state from the prior storyboard board."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="cinematic production storyboard, consistent character continuity", description="Reusable visual style and continuity guidance."),
                _prompt_recipe_variable("shot_count", "Shot Count", default_value="6", description="Number of storyboard panels to create, usually 4, 6, or 9."),
                _prompt_recipe_variable("aspect_ratio", "Aspect Ratio", default_value="16:9", description="Target storyboard-sheet aspect ratio."),
                _prompt_recipe_variable("dialogue_mode", "Dialogue Mode", default_value="light", description="Dialogue policy: none, light, medium, cinematic, full, or user_specified."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": False, "mode": "direct_reference", "analysis_variable": "image_analysis", "max_files": 4},
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
            "version": "2.7",
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
                "ORDERED VISUAL REFERENCES:\n"
                "[image reference 1] = approved character sheet / character continuity anchor. Use it for identity, face, body, wardrobe, palette, silhouette, props, and genre language.\n"
                "[image reference 2] = previous storyboard sheet output when connected. Visually inspect it for the actual ending state, final panel, environment, character state, props, enemies, lighting, and readable panel metadata.\n"
                "Additional image references are optional supporting set, prop, wardrobe, creature, vehicle, or atmosphere references only. Do not let them override the character sheet.\n\n"
                "PREVIOUS STORYBOARD PROMPT OR HANDOFF:\n{{previous_storyboard_prompt}}\n\n"
                "CONTINUATION BRIEF:\n{{continuation_brief}}\n\n"
                "SEGMENT NUMBER:\n{{segment_number}}\n\n"
                "TOTAL SEGMENTS:\n{{total_segments}}\n\n"
                "TARGET DURATION SECONDS:\n{{target_duration_seconds}}\n\n"
                "PANEL COUNT:\n{{panel_count}}\n\n"
                "DIALOGUE MODE:\n{{dialogue_mode}}\n\n"
                "STYLE DIRECTION:\n{{style_direction}}\n\n"
                "PREVIOUS BOARD ANALYSIS REQUIREMENTS:\n"
                "Use [image reference 2] as the strongest evidence for what actually happened and where the prior board ended. Extract the visible board title if readable, approximate layout/panel count, recurring character look, wardrobe, key props, setting, lighting, action progression, final panel state, readable text metadata, unresolved threat, obstacle, emotion, movement, and continuity risks.\n"
                "Build a hidden state ledger from the previous board image and previous prompt before writing the next board. Track whether the character is restrained or free, what props are seen/reachable/held/used, where villains or threats are positioned, where the exit or portal is, what room or route geometry is established, and what final-state handoff is allowed. Do not print this ledger unless it becomes compact NOTES metadata.\n"
                "Use PREVIOUS STORYBOARD PROMPT OR HANDOFF as intent context: story premise, intended beats, character terms, style rules, dialogue policy, camera/action/motion metadata format, and ending instruction. If the previous image and prompt conflict, preserve visible continuity first.\n\n"
                "CONTINUATION RULES:\n"
                "Make this board continue from the previous board instead of restarting the story. The first panel should pick up from the previous board's final visible state or handoff. The continuation brief is the new story direction, not a full replacement for previous continuity.\n"
                "Preserve the previous board's final character state, wardrobe, props, location logic, lighting, unresolved action, and active threat by default. End with a clear visual handoff into the next storyboard segment unless this is explicitly the final board, in which case end with a clear payoff or optional next-adventure handoff.\n"
                "Avoid repeating the same beats from the previous board. Advance the story with a distinct location, action, obstacle, reveal, emotional turn, or payoff.\n"
                "Every major state change must be earned. Do not jump from restrained to free, locked to escaped, hidden to discovered, grounded to airborne, unarmed to armed, powerless to empowered, or problem to solution without showing the action, tool, discovery, choice, or consequence that caused it.\n"
                "A panel may not show the character taking, grabbing, using, unlocking with, aiming, or activating an object unless the prior board or an earlier panel in this board made that object visible, reachable, and logically available. Props must move through clear states: seen -> reachable -> obtained -> used. If the character is restrained, blocked, or captive, show the restraint weakness, loosening, breaking, unlocking, distraction, or assistance before free movement or object use.\n"
                "Villains, captors, guards, creatures, doors, portals, and important props must react in chronological order. Do not show a reaction before the triggering action is visible, and do not move an important prop or exit without a clear ACTION/MOTION/NOTES bridge.\n"
                "Treat each board as roughly one compact 15-second visual segment when TARGET DURATION SECONDS is 15. If the continuation brief contains too many beats for PANEL COUNT, combine atmosphere/setup beats first and preserve the main causal actions.\n\n"
                "PROVIDER-SAFE ACTION LANGUAGE:\n"
                "When continuing fights, weapons, captors, guards, monsters, threat, escape, or battle, stage action as non-graphic cinematic motion. Prefer wording like disarms, disables, escapes, wins the standoff, overpowers, dodges, blocks, distracts, or incapacitates over graphic injury, gore, blood, killing, execution, mutilation, or explicit harm. Keep violence implied, stylized, readable, and production-safe while preserving story stakes and spatial continuity.\n\n"
                "CHARACTER AND REFERENCE TEXT RULES:\n"
                "Keep the character visually consistent from [image reference 1]. Treat names or labels printed on references as internal labels unless the continuation brief explicitly asks for visible names. In storyboard titles and panel metadata, prefer generic subject wording like the character, the woman, the lead, the rogue, the warrior, the captor, or the guards.\n"
                "Do not copy visible name, title, project, footer, profile-card, stat, or UI label text from connected references.\n\n"
                "DIALOGUE POLICY:\n"
                "Always keep the DIALOG row label in every panel. If DIALOGUE MODE is none, silent, or wordless, leave every DIALOG value truly blank after the colon. Do not write Silence, No dialogue, None, breath, reaction cues, a dash, an em dash, a hyphen, N/A, or any placeholder mark in DIALOG.\n"
                "If DIALOGUE MODE is light, add one or two short spoken lines only where they help the beat. If DIALOGUE MODE is medium or cinematic, use two to four short lines across the board. If DIALOGUE MODE is full, every DIALOG value should be actual quoted speech text, without parenthetical silence or placeholder marks, and without crowding the metadata. If DIALOGUE MODE is user_specified, preserve exact quoted user lines in the correct chronological panels. Most panels can still have blank DIALOG values unless a line matters.\n\n"
                "OUTPUT REQUIREMENTS:\n"
                "Return a complete Storyboard v2 image-generation prompt, not a summary.\n"
                "Include a storyboard title, segment number and total segment count when provided, concise previous-board read, final-panel handoff, continuation brief, target duration, panel count, visual continuity rules, character continuity rules, wardrobe/prop/environment continuity rules, panel-by-panel storyboard structure, and a next-board handoff note.\n"
                "Default to a 3x2 grid for 6 panels, 2x2 for 4 panels, or 3x3 for 9 panels. Each panel must include readable director-note metadata under the image:\n"
                "SHOT: two-digit number and short title\n"
                "CAMERA: camera type, angle, movement, and lens feel\n"
                "FRAMING: shot size and subject placement\n"
                "ACTION: what the character, important prop, creature, vehicle, or scene element is doing\n"
                "MOTION: camera motion, subject motion, environmental motion, rhythm, VFX timing, or transformation timing\n"
                "DIALOG: exact requested dialogue, sparse dialogue when requested, or blank after the colon when no spoken line is needed\n"
                "NOTES: optional VFX, continuity, emotion, item/prop state, or handoff notes\n\n"
                "STYLE:\n"
                "Use STYLE DIRECTION and the visible style from the prior board unless the continuation brief explicitly changes style. If no style is provided, use premium cinematic production storyboard styling: dark near-black board, thin yellow-orange UI lines, readable English labels, concise metadata, and high-end film/game previsualization design.\n\n"
                "Do not include raw assistant debug language, internal Graph Studio instructions, node names, provider instructions, pricing, Run/Save instructions, Seedance/video instructions, biographies, stat blocks, profile-card metadata, or JSON. Return only the final prompt."
            ),
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{continuation_brief}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text", "description": "A single Storyboard v2-compatible continuation prompt."},
            "input_variables_json": [
                _prompt_recipe_variable("previous_storyboard_prompt", "Previous Storyboard Prompt", required=True, description="Prompt text, handoff, or compiled prompt from the previous storyboard."),
                _prompt_recipe_variable("continuation_brief", "Continuation Brief", required=True, description="The user's next story direction for this storyboard segment."),
                _prompt_recipe_variable("segment_number", "Segment Number", default_value="2", description="Current storyboard segment number."),
                _prompt_recipe_variable("total_segments", "Total Segments", default_value="3", description="Optional total segment count for the story arc."),
                _prompt_recipe_variable("target_duration_seconds", "Target Duration Seconds", default_value="15", description="Approximate duration this board may represent later if adapted to video."),
                _prompt_recipe_variable("panel_count", "Panel Count", default_value="6", description="Number of storyboard panels to create, usually 4, 6, or 9."),
                _prompt_recipe_variable("dialogue_mode", "Dialogue Mode", default_value="light", description="Dialogue policy: none, light, medium, cinematic, full, or user_specified."),
                _prompt_recipe_variable("style_direction", "Style Direction", default_value="cinematic production storyboard, consistent character continuity", description="Reusable visual style and continuity guidance."),
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": True, "required": True, "mode": "direct_reference", "analysis_variable": "image_analysis", "max_files": 6},
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
            "version": "1.5",
            "priority": 461,
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
