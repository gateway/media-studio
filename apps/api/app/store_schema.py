from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from .store_support import (
    decode_row,
    ensure_column,
    insert_or_update,
    table_exists,
    utcnow_iso,
)

MIGRATION_TABLES = {"schema_meta", "schema_migrations"}


@dataclass(frozen=True)
class SchemaMigration:
    migration_id: str
    version: int
    description: str
    apply: Callable[[sqlite3.Connection], None]


def database_has_user_schema(connection: sqlite3.Connection) -> bool:
    rows = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        """
    ).fetchall()
    user_tables = {str(row["name"]) for row in rows}
    return bool(user_tables - MIGRATION_TABLES)


def _ensure_migration_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS schema_migrations (
                migration_id TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """
    )


def _set_schema_meta(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO schema_meta (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, utcnow_iso()),
    )


def _get_schema_meta(connection: sqlite3.Connection, key: str) -> Optional[str]:
    if not table_exists(connection, "schema_meta"):
        return None
    row = connection.execute("SELECT value FROM schema_meta WHERE key = ?", (key,)).fetchone()
    if row is None:
        return None
    return str(row["value"])


def _list_applied_migrations(connection: sqlite3.Connection) -> List[Dict[str, Any]]:
    if not table_exists(connection, "schema_migrations"):
        return []
    rows = connection.execute(
        """
        SELECT migration_id, version, description, applied_at
        FROM schema_migrations
        ORDER BY version ASC, migration_id ASC
        """
    ).fetchall()
    return [
        {
            "migration_id": str(row["migration_id"]),
            "version": int(row["version"]),
            "description": str(row["description"]),
            "applied_at": str(row["applied_at"]),
        }
        for row in rows
    ]


def _applied_migration_ids(connection: sqlite3.Connection) -> set[str]:
    return {entry["migration_id"] for entry in _list_applied_migrations(connection)}


def list_pending_migrations(connection: sqlite3.Connection) -> List[SchemaMigration]:
    applied = _applied_migration_ids(connection)
    return [migration for migration in MIGRATIONS if migration.migration_id not in applied]


def schema_status(connection: sqlite3.Connection) -> Dict[str, Any]:
    applied = _list_applied_migrations(connection)
    pending = list_pending_migrations(connection)
    schema_version_raw = _get_schema_meta(connection, "schema_version")
    schema_version = int(schema_version_raw) if schema_version_raw and schema_version_raw.isdigit() else 0
    return {
        "schema_version": schema_version,
        "latest_version": LATEST_SCHEMA_VERSION,
        "applied_migrations": applied,
        "pending_migrations": [
            {
                "migration_id": migration.migration_id,
                "version": migration.version,
                "description": migration.description,
            }
            for migration in pending
        ],
        "user_schema_present": database_has_user_schema(connection),
    }


def _record_migration(connection: sqlite3.Connection, migration: SchemaMigration) -> None:
    applied_at = utcnow_iso()
    connection.execute(
        """
        INSERT OR REPLACE INTO schema_migrations (migration_id, version, description, applied_at)
        VALUES (?, ?, ?, ?)
        """,
        (migration.migration_id, migration.version, migration.description, applied_at),
    )
    _set_schema_meta(connection, "schema_version", str(migration.version))
    _set_schema_meta(connection, "last_migration_id", migration.migration_id)
    _set_schema_meta(connection, "last_migrated_at", applied_at)

def _seed_default_presets(connection: sqlite3.Connection) -> None:
    now = utcnow_iso()
    seed_rows = [
        {
            "preset_id": "media-preset-2x2-pose-grid-shared",
            "key": "2x2-pose-grid",
            "label": "2x2 Pose Grid",
            "description": (
                "Takes the exact reference image of a person and generates 4 additional images in a grid at "
                "various poses and positions while maintaining the exact clothing, facial features and background."
            ),
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["nano-banana-2", "nano-banana-pro", "gpt-image-2-image-to-image"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": (
                "Use [[person]] as identity/style reference only,never as output.\n\n"
                "Create 4 brand new final images in a 2x2 grid of 4 newly generated renders of the same character.\n"
                "All 4 panels must be fresh renders. Do not paste,copy,repeat,or preserve the original uploaded "
                "image as any panel. Do not recreate the exact source pose,source crop,or source framing.\n\n"
                "Main goal:\n"
                "preserve character consistency while creating 4 clearly different shots.\n\n"
                "Keep locked across all 4 panels:\n"
                "same identity,same face,same facial structure,same skin tone,same hairstyle,same hair color,same "
                "body type,same clothing,same accessories,same props,same materials,same wear and tear,same tattoos,"
                "same background environment,same lighting mood,same realism level,same overall visual style.\n\n"
                "Allowed variation only:\n"
                "pose,stance,arm position,hand placement,torso rotation,head angle,camera angle,framing,facial "
                "expression.\n\n"
                "Hard rules:\n"
                "the character must remain the exact same person in every panel\n"
                "the environment must remain the same\n"
                "the outfit and gear must remain the same\n"
                "all 4 panels must look like shots from the same shoot in the same place at nearly the same time\n"
                "no panel may look like a reused crop of the reference\n"
                "no duplicate poses\n"
                "no duplicate camera angles\n"
                "no duplicate expressions\n"
                "no text,no labels,no borders,no captions,no graphic design elements,no extra characters\n\n"
                "Dynamic variation behavior:\n"
                "for each of the 4 panels,choose a different combination of pose,camera,framing,and expression so "
                "the panels have strong visual separation while keeping identity fully consistent.\n\n"
                "Choose 1 unique option per panel from these pose ideas:\n"
                "relaxed standing,strong stance,casual ready stance,action-ready stance,walking,turning slightly,"
                "looking over shoulder,arms crossed,one hand raised,hands at sides,subtle crouch,weight shifted to "
                "one leg\n\n"
                "Choose 1 unique option per panel from these camera ideas:\n"
                "front view,left 3/4,right 3/4,side view,slight low angle,slight high angle,eye level\n\n"
                "Choose 1 unique option per panel from these framing ideas:\n"
                "full body,three-quarter body,medium full\n\n"
                "Choose 1 unique option per panel from these expression ideas:\n"
                "serious,focused,calm,determined,intense,alert,subtle smirk\n\n"
                "Priorities:\n"
                "1 preserve identity exactly\n"
                "2 ensure all 4 panels are newly rendered and not reused from source\n"
                "3 maximize panel-to-panel variety using only approved changes\n"
                "4 keep composition clean and balanced as a readable 2x2 grid\n\n"
                "If no other direction is given,automatically choose the 4 panel combinations from the lists above "
                "to create the best balanced and most visually distinct result."
            ),
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": 1,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [],
            "input_slots_json": [
                {
                    "key": "person",
                    "label": "Person",
                    "help_text": "Detailed image of a person",
                    "required": True,
                    "max_files": 1,
                }
            ],
            "choice_groups_json": [],
            "thumbnail_path": "preset-thumbnails/2x2-pose-grid-1777711962216.webp",
            "thumbnail_url": "/api/preset-thumbnails/2x2-pose-grid-1777711962216.webp",
            "notes": None,
            "version": "v1",
            "priority": 880,
            "created_at": now,
            "updated_at": now,
        },
        {
            "preset_id": "media-preset-3d-caricature-style-nano-banana-shared",
            "key": "3d-caricature-style-nano-banana",
            "label": "3D Caricature Style",
            "description": "Turn a portrait photo into a polished 3D caricature with exaggerated features and recognizable likeness.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["nano-banana-2", "nano-banana-pro", "gpt-image-2-image-to-image"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": "Create a polished 3D caricature portrait of {{subject_style}} using [[person]]. Keep the likeness recognizable, exaggerate the defining features in a flattering way, and preserve a premium cinematic render finish.",
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": 1,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [
                {
                    "key": "subject_style",
                    "label": "Style Direction",
                    "placeholder": "Pixar-inspired studio lighting with premium skin detail",
                    "default_value": "Pixar-inspired studio lighting with premium skin detail",
                    "required": True,
                }
            ],
            "input_slots_json": [
                {
                    "key": "person",
                    "label": "Portrait",
                    "help_text": "Upload the reference portrait for the caricature.",
                    "required": True,
                    "max_files": 1,
                }
            ],
            "choice_groups_json": [],
            "thumbnail_path": "preset-thumbnails/3d-caricature-style-1775803238496.webp",
            "thumbnail_url": "/api/preset-thumbnails/3d-caricature-style-1775803238496.webp",
            "notes": "Built-in Nano Banana portrait workflow.",
            "version": "v1",
            "priority": 900,
            "created_at": now,
            "updated_at": now,
        },
        {
            "preset_id": "media-preset-exploding-food-shared",
            "key": "exploding-food",
            "label": "Exploding Food",
            "description": "Generate high-end commercial exploding-food photography.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["nano-banana-2", "gpt-image-2-text-to-image", "nano-banana-pro"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": (
                "Exploding {{food}}, broken into two pieces. visible, crumbs or particles suspended mid-air. Clean "
                "{{background}}, studio lighting, high-end commercial food photography, ultra-detailed, sharp focus."
            ),
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": 0,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [
                {
                    "key": "food",
                    "label": "Food",
                    "placeholder": "bacon burger with cheese and jalapenos",
                    "default_value": "bacon burger with cheese and jalapenos",
                    "required": True,
                },
                {
                    "key": "background",
                    "label": "Background",
                    "placeholder": "Solid White Studio background",
                    "default_value": "Solid White Studio background",
                    "required": True,
                },
            ],
            "input_slots_json": [],
            "choice_groups_json": [],
            "thumbnail_path": "preset-thumbnails/exploding-food-1777711842837.webp",
            "thumbnail_url": "/api/preset-thumbnails/exploding-food-1777711842837.webp",
            "notes": None,
            "version": "v1",
            "priority": 860,
            "created_at": now,
            "updated_at": now,
        },
        {
            "preset_id": "media-preset-food-recipe-infographic-shared",
            "key": "food-recipe-infographic",
            "label": "Food Recipe Infographic",
            "description": "Generate a custom food recipe infographic.",
            "status": "active",
            "model_key": "gpt-image-2-text-to-image",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["gpt-image-2-text-to-image", "nano-banana-pro", "nano-banana-2"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": (
                "Ultra-clean modern recipe infographic. Showcase {{foodname}} in a visually appealing finished form, "
                "sliced, plated, or portioned, floating slightly in perspective or angled view. Arrange ingredients, "
                "steps, and tips around the dish in a dynamic editorial layout, not restricted to top-down. "
                "Ingredients Section: Include icons or mini illustrations for each ingredient with quantities. "
                "Arrange them in clusters, lists, or circular flows connected visually to the dish. Steps Section: "
                "Show preparation steps with numbered panels, arrows, or lines, forming a logical flow around the "
                "main dish. Include small cooking icons (knife, pan, oven, timer) where helpful. Additional Info "
                "(optional): Total calories, prep/cook time, servings, spice level - displayed as clean bubbles or "
                "badges near the dish. Visual Style: Editorial infographic meets lifestyle food photography. "
                "Vibrant, natural food colors, subtle drop shadows, clean vector icons, modern typography, soft "
                "gradients or glassmorphism for step panels. Accent colors can highlight key info (calories, prep "
                "time). Composition Guidelines: Finished meal as hero visual (perspective or angled) Ingredients and "
                "steps flow dynamically around the dish Clear visual hierarchy: dish > steps > ingredients > "
                "optional stats Enough negative space to keep design airy and readable Lighting & Background: Soft, "
                "natural studio lighting, minimal textured or gradient background for premium editorial feel. \n\n"
                "ultra-crisp, social-feed optimized, no watermark"
            ),
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": 0,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [
                {
                    "key": "foodname",
                    "label": "Food Name",
                    "placeholder": "Cheeseburger",
                    "default_value": "Cheeseburger",
                    "required": True,
                }
            ],
            "input_slots_json": [],
            "choice_groups_json": [],
            "thumbnail_path": "preset-thumbnails/food-recipe-infographic-1778383734839.webp",
            "thumbnail_url": "/api/preset-thumbnails/food-recipe-infographic-1778383734839.webp",
            "notes": None,
            "version": "v1",
            "priority": 850,
            "created_at": now,
            "updated_at": now,
        },
        {
            "preset_id": "media-preset-giant-animal-anywhere-shared",
            "key": "giant-animal-anywhere",
            "label": "Giant Animal Anywhere",
            "description": (
                "Place an enormous adorable animal into any real-world setting with miniature-looking surroundings "
                "and a calm cinematic mood."
            ),
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["nano-banana-2", "gpt-image-2-text-to-image", "nano-banana-pro"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": (
                "A scene where {{location}} is occupied by a super gigantic, adorable {{animal}}. The environment "
                "around the {{animal}} appears miniature by comparison, emphasizing the creature's enormous scale. "
                "The setting must faithfully reflect the real visual character of {{location}}, whether it is a "
                "city, town, landmark, coastline, forest, mountain, desert, or lakeside environment, with believable "
                "environmental details, cinematic depth, and soft natural atmosphere. The animal must clearly and "
                "unmistakably be a {{animal}}, preserving the requested species, color, and overall appearance, and "
                "must not be replaced by any other animal. The overall mood is quiet, warm, soothing, and cute."
            ),
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": 0,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [
                {
                    "key": "location",
                    "label": "Location",
                    "placeholder": "Paris",
                    "default_value": "Paris",
                    "required": True,
                },
                {
                    "key": "animal",
                    "label": "Animal",
                    "placeholder": "Labrador Retriever",
                    "default_value": "Labrador Retriever",
                    "required": True,
                },
            ],
            "input_slots_json": [],
            "choice_groups_json": [],
            "thumbnail_path": "preset-thumbnails/giant-animal-anywhere-1778384247159.webp",
            "thumbnail_url": "/api/preset-thumbnails/giant-animal-anywhere-1778384247159.webp",
            "notes": None,
            "version": "v1",
            "priority": 840,
            "created_at": now,
            "updated_at": now,
        },
        {
            "preset_id": "media-preset-photo-restoration-shared",
            "key": "photo-restoration",
            "label": "Photo Restoration",
            "description": "Restore old photos from one uploaded image with colorized, cleaned outputs.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["nano-banana-2", "gpt-image-2-image-to-image", "nano-banana-pro"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": (
                "Colorize this black and white photo [[source_photo]] to look like a modern, high-end image taken "
                "today on a Canon EOS R5. Apply hyper-realistic skin tones and natural volumetric lighting with "
                "accurate shadows. If outdoor, enhance the foliage, grass, trees, and sky with vibrant, "
                "high-definition textures and sunlight. If indoor, create realistic ambient lighting. CRITICAL "
                "INSTRUCTION: Strictly preserve the original facial features, expressions, and clothing of all "
                "people; do not alter identities or the physical structure of the photo."
            ),
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": 1,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [],
            "input_slots_json": [
                {
                    "key": "source_photo",
                    "label": "Source Photo",
                    "help_text": "Source Photo",
                    "required": True,
                    "max_files": 1,
                }
            ],
            "choice_groups_json": [],
            "thumbnail_path": "preset-thumbnails/photo-restoration-1778385279913.webp",
            "thumbnail_url": "/api/preset-thumbnails/photo-restoration-1778385279913.webp",
            "notes": None,
            "version": "v1",
            "priority": 830,
            "created_at": now,
            "updated_at": now,
        },
        {
            "preset_id": "media-preset-selfie-with-movie-character-nano-banana-shared",
            "key": "selfie-with-movie-character-nano-banana",
            "label": "Selfie with Movie Character",
            "description": "Place your uploaded portrait into a polished selfie scene with a named movie character.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "base_builtin_key": None,
            "applies_to_models_json": ["nano-banana-2", "nano-banana-pro", "gpt-image-2-image-to-image"],
            "applies_to_task_modes_json": [],
            "applies_to_input_patterns_json": [],
            "prompt_template": "Create a premium selfie of [[person]] standing beside {{character_name}} from {{movie_name}}. Make the shot feel candid, cinematic, and believable with natural framing and polished lighting.",
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {},
            "rules_json": {},
            "requires_image": 1,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [
                {
                    "key": "character_name",
                    "label": "Character",
                    "placeholder": "John Wick",
                    "default_value": "",
                    "required": True,
                },
                {
                    "key": "movie_name",
                    "label": "Movie",
                    "placeholder": "John Wick Chapter 4",
                    "default_value": "",
                    "required": True,
                },
            ],
            "input_slots_json": [
                {
                    "key": "person",
                    "label": "Portrait",
                    "help_text": "Upload the portrait that should appear in the selfie.",
                    "required": True,
                    "max_files": 1,
                }
            ],
            "choice_groups_json": [],
            "thumbnail_path": "preset-thumbnails/selfie-with-movie-character-1777711871772.webp",
            "thumbnail_url": "/api/preset-thumbnails/selfie-with-movie-character-1777711871772.webp",
            "notes": "Built-in Nano Banana selfie composition workflow.",
            "version": "v1",
            "priority": 890,
            "created_at": now,
            "updated_at": now,
        },
    ]
    seed_ids = tuple(row["preset_id"] for row in seed_rows)
    existing_shared = connection.execute(
        f"SELECT COUNT(*) AS count FROM media_presets WHERE preset_id IN ({', '.join(['?'] * len(seed_ids))})",
        seed_ids,
    ).fetchone()
    if existing_shared and int(existing_shared["count"] or 0) >= len(seed_ids):
        return
    for row in seed_rows:
        insert_or_update(connection, "media_presets", "preset_id", row)


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


def _seed_default_prompt_recipes(connection: sqlite3.Connection) -> None:
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


def _seed_default_graph_templates(connection: sqlite3.Connection) -> None:
    now = utcnow_iso()
    seed_rows = [
        {
            "template_id": "graph-template-prompt-recipe-text-single-prompt",
            "name": "Prompt Recipe - Text Single Prompt",
            "description": "Generic Prompt Recipe node driving a single text output plus JSON inspection.",
            "status": "active",
            "tags_json": ["graph-studio", "prompt-recipes", "smoke"],
            "workflow_json": {
                "schema_version": 1,
                "name": "Prompt Recipe - Text Single Prompt",
                "nodes": [
                    {
                        "id": "recipe",
                        "type": "prompt.recipe",
                        "position": {"x": 0, "y": 0},
                        "fields": {
                            "recipe_id": "prompt-recipe-image-prompt-director",
                            "user_prompt": "Turn this into a premium cinematic portrait prompt for a lone explorer on a rainy neon street.",
                            "provider": "openrouter",
                            "model_id": "openai/gpt-4o-mini",
                            "external_variables_json": '{"aspect_ratio":"16:9","style_direction":"cinematic realism"}',
                        },
                    },
                    {"id": "display", "type": "display.any", "position": {"x": 520, "y": 0}, "fields": {}},
                    {"id": "inspect", "type": "debug.inspect", "position": {"x": 900, "y": 0}, "fields": {}},
                ],
                "edges": [
                    {"id": "edge-recipe-display", "source": "recipe", "source_port": "text", "target": "display", "target_port": "value"},
                    {"id": "edge-recipe-inspect", "source": "recipe", "source_port": "result", "target": "inspect", "target_port": "value"},
                ],
            },
            "created_at": now,
            "updated_at": now,
        },
        {
            "template_id": "graph-template-prompt-recipe-single-image-director",
            "name": "Prompt Recipe - Single Image Director",
            "description": "Single-image director workflow using the Image Prompt Director dynamic node.",
            "status": "active",
            "tags_json": ["graph-studio", "prompt-recipes", "smoke"],
            "workflow_json": {
                "schema_version": 1,
                "name": "Prompt Recipe - Single Image Director",
                "nodes": [
                    {"id": "load_image_1", "type": "media.load_image", "position": {"x": -320, "y": 0}, "fields": {}},
                    {
                        "id": "recipe",
                        "type": "prompt.recipe",
                        "position": {"x": 60, "y": 0},
                        "fields": {
                            "recipe_id": "prompt-recipe-image-prompt-director",
                            "recipe_category": "image",
                            "user_prompt": "Create a polished cinematic portrait prompt using the reference as the main identity.",
                            "provider": "openrouter",
                            "model_id": "openai/gpt-4o-mini",
                            "model_supports_images": True,
                            "style_direction": "cinematic realism",
                            "aspect_ratio": "16:9",
                        },
                    },
                    {"id": "display", "type": "display.any", "position": {"x": 560, "y": 0}, "fields": {}},
                    {"id": "inspect", "type": "debug.inspect", "position": {"x": 920, "y": 0}, "fields": {}},
                ],
                "edges": [
                    {"id": "edge-load1-recipe", "source": "load_image_1", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-recipe-display", "source": "recipe", "source_port": "text", "target": "display", "target_port": "value"},
                    {"id": "edge-recipe-inspect", "source": "recipe", "source_port": "result", "target": "inspect", "target_port": "value"},
                ],
            },
            "created_at": now,
            "updated_at": now,
        },
        {
            "template_id": "graph-template-prompt-recipe-multi-image-director",
            "name": "Prompt Recipe - Multi Image Director",
            "description": "Multi-image director workflow proving ordered image references into one final prompt.",
            "status": "active",
            "tags_json": ["graph-studio", "prompt-recipes", "smoke"],
            "workflow_json": {
                "schema_version": 1,
                "name": "Prompt Recipe - Multi Image Director",
                "nodes": [
                    {"id": "load_image_1", "type": "media.load_image", "position": {"x": -420, "y": -220}, "fields": {}},
                    {"id": "load_image_2", "type": "media.load_image", "position": {"x": -420, "y": 0}, "fields": {}},
                    {"id": "load_image_3", "type": "media.load_image", "position": {"x": -420, "y": 220}, "fields": {}},
                    {
                        "id": "recipe",
                        "type": "prompt.recipe",
                        "position": {"x": 40, "y": -40},
                        "fields": {
                            "recipe_id": "prompt-recipe-image-prompt-director",
                            "recipe_category": "image",
                            "user_prompt": "Use the ordered references to create one prompt that preserves face, body styling, and product continuity.",
                            "provider": "openrouter",
                            "model_id": "openai/gpt-4o-mini",
                            "model_supports_images": True,
                            "style_direction": "premium editorial realism",
                            "aspect_ratio": "16:9",
                        },
                    },
                    {"id": "display", "type": "display.any", "position": {"x": 580, "y": -40}, "fields": {}},
                    {"id": "inspect", "type": "debug.inspect", "position": {"x": 960, "y": -40}, "fields": {}},
                ],
                "edges": [
                    {"id": "edge-load1-recipe", "source": "load_image_1", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-load2-recipe", "source": "load_image_2", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-load3-recipe", "source": "load_image_3", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-recipe-display", "source": "recipe", "source_port": "text", "target": "display", "target_port": "value"},
                    {"id": "edge-recipe-inspect", "source": "recipe", "source_port": "result", "target": "inspect", "target_port": "value"},
                ],
            },
            "created_at": now,
            "updated_at": now,
        },
        {
            "template_id": "graph-template-prompt-recipe-video-director-batch",
            "name": "Prompt Recipe - Video Director Batch",
            "description": "Structured multi-shot video prompt batch with Prompt Parse fanout.",
            "status": "active",
            "tags_json": ["graph-studio", "prompt-recipes", "smoke"],
            "workflow_json": {
                "schema_version": 1,
                "name": "Prompt Recipe - Video Director Batch",
                "nodes": [
                    {"id": "load_image_1", "type": "media.load_image", "position": {"x": -520, "y": -160}, "fields": {}},
                    {"id": "load_image_2", "type": "media.load_image", "position": {"x": -520, "y": 80}, "fields": {}},
                    {
                        "id": "recipe",
                        "type": "prompt.recipe",
                        "position": {"x": -40, "y": -40},
                        "fields": {
                            "recipe_id": "prompt-recipe-video-director-multi-shot-json",
                            "recipe_category": "video",
                            "user_prompt": "Create four cinematic video prompts for an escalating sci-fi escape sequence.",
                            "provider": "openrouter",
                            "model_id": "openai/gpt-4o-mini",
                            "model_supports_images": True,
                            "style_direction": "cinematic sci-fi realism",
                            "shot_count": "4",
                            "duration_seconds": "5",
                        },
                    },
                    {"id": "parse", "type": "prompt.parse", "position": {"x": 420, "y": -40}, "fields": {}},
                    {"id": "display_1", "type": "display.any", "position": {"x": 820, "y": -360}, "fields": {}},
                    {"id": "display_2", "type": "display.any", "position": {"x": 820, "y": -120}, "fields": {}},
                    {"id": "display_3", "type": "display.any", "position": {"x": 820, "y": 120}, "fields": {}},
                    {"id": "display_4", "type": "display.any", "position": {"x": 820, "y": 360}, "fields": {}},
                    {"id": "inspect", "type": "debug.inspect", "position": {"x": 1220, "y": -40}, "fields": {}},
                ],
                "edges": [
                    {"id": "edge-load1-recipe", "source": "load_image_1", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-load2-recipe", "source": "load_image_2", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-recipe-parse", "source": "recipe", "source_port": "result", "target": "parse", "target_port": "result"},
                    {"id": "edge-parse-display1", "source": "parse", "source_port": "prompt_1", "target": "display_1", "target_port": "value"},
                    {"id": "edge-parse-display2", "source": "parse", "source_port": "prompt_2", "target": "display_2", "target_port": "value"},
                    {"id": "edge-parse-display3", "source": "parse", "source_port": "prompt_3", "target": "display_3", "target_port": "value"},
                    {"id": "edge-parse-display4", "source": "parse", "source_port": "prompt_4", "target": "display_4", "target_port": "value"},
                    {"id": "edge-recipe-inspect", "source": "recipe", "source_port": "result", "target": "inspect", "target_port": "value"},
                ],
            },
            "created_at": now,
            "updated_at": now,
        },
        {
            "template_id": "graph-template-prompt-recipe-storyboard-3x3",
            "name": "Prompt Recipe - Storyboard 3x3",
            "description": "Nine-panel storyboard prompt fanout using a structured storyboard shot-sequence recipe.",
            "status": "active",
            "tags_json": ["graph-studio", "prompt-recipes", "smoke"],
            "workflow_json": {
                "schema_version": 1,
                "name": "Prompt Recipe - Storyboard 3x3",
                "nodes": [
                    {"id": "load_image_1", "type": "media.load_image", "position": {"x": -620, "y": -120}, "fields": {}},
                    {"id": "load_image_2", "type": "media.load_image", "position": {"x": -620, "y": 140}, "fields": {}},
                    {
                        "id": "recipe",
                        "type": "prompt.recipe",
                        "position": {"x": -120, "y": 0},
                        "fields": {
                            "recipe_id": "prompt-recipe-storyboard-shot-sequence-3x3",
                            "recipe_category": "image",
                            "user_prompt": "Create a nine-panel storyboard about a lone operative stealing critical data from a collapsing alien fortress.",
                            "provider": "openrouter",
                            "model_id": "openai/gpt-4o-mini",
                            "model_supports_images": True,
                            "style_direction": "cinematic sci-fi realism",
                            "shot_count": "9",
                            "aspect_ratio": "16:9",
                        },
                    },
                    {"id": "parse", "type": "prompt.parse", "position": {"x": 360, "y": 0}, "fields": {}},
                    {"id": "inspect", "type": "debug.inspect", "position": {"x": 1880, "y": 0}, "fields": {}},
                    {"id": "display_1", "type": "display.any", "position": {"x": 760, "y": -520}, "fields": {}},
                    {"id": "display_2", "type": "display.any", "position": {"x": 1160, "y": -520}, "fields": {}},
                    {"id": "display_3", "type": "display.any", "position": {"x": 1560, "y": -520}, "fields": {}},
                    {"id": "display_4", "type": "display.any", "position": {"x": 760, "y": -160}, "fields": {}},
                    {"id": "display_5", "type": "display.any", "position": {"x": 1160, "y": -160}, "fields": {}},
                    {"id": "display_6", "type": "display.any", "position": {"x": 1560, "y": -160}, "fields": {}},
                    {"id": "display_7", "type": "display.any", "position": {"x": 760, "y": 200}, "fields": {}},
                    {"id": "display_8", "type": "display.any", "position": {"x": 1160, "y": 200}, "fields": {}},
                    {"id": "display_9", "type": "display.any", "position": {"x": 1560, "y": 200}, "fields": {}},
                ],
                "edges": [
                    {"id": "edge-load1-recipe", "source": "load_image_1", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-load2-recipe", "source": "load_image_2", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-recipe-parse", "source": "recipe", "source_port": "result", "target": "parse", "target_port": "result"},
                    {"id": "edge-recipe-inspect", "source": "recipe", "source_port": "result", "target": "inspect", "target_port": "value"},
                    {"id": "edge-parse-display1", "source": "parse", "source_port": "prompt_1", "target": "display_1", "target_port": "value"},
                    {"id": "edge-parse-display2", "source": "parse", "source_port": "prompt_2", "target": "display_2", "target_port": "value"},
                    {"id": "edge-parse-display3", "source": "parse", "source_port": "prompt_3", "target": "display_3", "target_port": "value"},
                    {"id": "edge-parse-display4", "source": "parse", "source_port": "prompt_4", "target": "display_4", "target_port": "value"},
                    {"id": "edge-parse-display5", "source": "parse", "source_port": "prompt_5", "target": "display_5", "target_port": "value"},
                    {"id": "edge-parse-display6", "source": "parse", "source_port": "prompt_6", "target": "display_6", "target_port": "value"},
                    {"id": "edge-parse-display7", "source": "parse", "source_port": "prompt_7", "target": "display_7", "target_port": "value"},
                    {"id": "edge-parse-display8", "source": "parse", "source_port": "prompt_8", "target": "display_8", "target_port": "value"},
                    {"id": "edge-parse-display9", "source": "parse", "source_port": "prompt_9", "target": "display_9", "target_port": "value"},
                ],
            },
            "created_at": now,
            "updated_at": now,
        },
        {
            "template_id": "graph-template-prompt-recipe-analysis-only",
            "name": "Prompt Recipe - Analysis Only",
            "description": "Analysis-only Prompt Recipe workflow with text display and JSON inspection.",
            "status": "active",
            "tags_json": ["graph-studio", "prompt-recipes", "smoke"],
            "workflow_json": {
                "schema_version": 1,
                "name": "Prompt Recipe - Analysis Only",
                "nodes": [
                    {"id": "load_image_1", "type": "media.load_image", "position": {"x": -320, "y": 0}, "fields": {}},
                    {
                        "id": "recipe",
                        "type": "prompt.recipe",
                        "position": {"x": 80, "y": 0},
                        "fields": {
                            "recipe_id": "prompt-recipe-image-analysis-character-reference",
                            "recipe_category": "analysis",
                            "user_prompt": "Describe the character and continuity-critical details.",
                            "provider": "openrouter",
                            "model_id": "openai/gpt-4o-mini",
                            "model_supports_images": True,
                        },
                    },
                    {"id": "display", "type": "display.any", "position": {"x": 560, "y": 0}, "fields": {}},
                    {"id": "inspect", "type": "debug.inspect", "position": {"x": 940, "y": 0}, "fields": {}},
                ],
                "edges": [
                    {"id": "edge-load1-recipe", "source": "load_image_1", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
                    {"id": "edge-recipe-display", "source": "recipe", "source_port": "text", "target": "display", "target_port": "value"},
                    {"id": "edge-recipe-inspect", "source": "recipe", "source_port": "result", "target": "inspect", "target_port": "value"},
                ],
            },
            "created_at": now,
            "updated_at": now,
        },
    ]
    for row in seed_rows:
        insert_or_update(connection, "graph_templates", "template_id", row)


def _migrate_multi_model_seed_presets(connection: sqlite3.Connection) -> None:
    duplicate_groups = [
        (
            "media-preset-3d-caricature-style-nano-banana-shared",
            "3d-caricature-style-nano-banana",
            (
                "media-preset-3d-caricature-style-nano-banana-2",
                "media-preset-3d-caricature-style-nano-banana-pro",
            ),
        ),
        (
            "media-preset-selfie-with-movie-character-nano-banana-shared",
            "selfie-with-movie-character-nano-banana",
            (
                "media-preset-selfie-with-movie-character-nano-banana-2",
                "media-preset-selfie-with-movie-character-nano-banana-pro",
            ),
        ),
    ]

    for shared_id, shared_key, legacy_ids in duplicate_groups:
        shared_row = connection.execute(
            "SELECT * FROM media_presets WHERE preset_id = ?",
            (shared_id,),
        ).fetchone()
        rows = connection.execute(
            f"SELECT * FROM media_presets WHERE preset_id IN ({', '.join(['?'] * len(legacy_ids))}) ORDER BY updated_at DESC",
            legacy_ids,
        ).fetchall()
        if len(rows) != len(legacy_ids):
            continue
        canonical = decode_row(shared_row) if shared_row else decode_row(rows[0])
        canonical["preset_id"] = shared_id
        canonical["key"] = shared_key
        canonical["model_key"] = "nano-banana-2"
        canonical["applies_to_models_json"] = ["nano-banana-2", "nano-banana-pro", "gpt-image-2-image-to-image"]
        canonical["applies_to_task_modes_json"] = ["image_edit"]
        canonical["applies_to_input_patterns_json"] = ["single_image", "image_edit"]
        canonical["updated_at"] = utcnow_iso()
        insert_or_update(connection, "media_presets", "preset_id", canonical)
        connection.execute(
            f"DELETE FROM media_presets WHERE preset_id IN ({', '.join(['?'] * len(legacy_ids))})",
            legacy_ids,
        )


def _migrate_gpt_image_seed_preset_scopes(connection: sqlite3.Connection) -> None:
    shared_ids = (
        "media-preset-3d-caricature-style-nano-banana-shared",
        "media-preset-selfie-with-movie-character-nano-banana-shared",
    )
    for preset_id in shared_ids:
        row = connection.execute("SELECT * FROM media_presets WHERE preset_id = ?", (preset_id,)).fetchone()
        if not row:
            continue
        preset = decode_row(row)
        scoped_models = list(preset.get("applies_to_models_json") or [])
        if "gpt-image-2-image-to-image" in scoped_models:
            continue
        preset["applies_to_models_json"] = [*scoped_models, "gpt-image-2-image-to-image"]
        preset["updated_at"] = utcnow_iso()
        insert_or_update(connection, "media_presets", "preset_id", preset)


def _seed_default_model_queue_policies(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT OR IGNORE INTO media_model_queue_policies (model_key, enabled, max_outputs_per_run, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        ("seedance-2.0", 1, 1, utcnow_iso()),
    )
    row = connection.execute(
        """
        SELECT enabled, max_outputs_per_run
        FROM media_model_queue_policies
        WHERE model_key = ?
        """,
        ("seedance-2.0",),
    ).fetchone()
    if row is None:
        return
    if int(row[0] or 0) != 0 or int(row[1] or 0) != 1:
        return
    other_policy_count = int(
        connection.execute(
            "SELECT COUNT(*) FROM media_model_queue_policies WHERE model_key != ?",
            ("seedance-2.0",),
        ).fetchone()[0]
        or 0
    )
    job_count = int(connection.execute("SELECT COUNT(*) FROM media_jobs").fetchone()[0] or 0)
    asset_count = int(connection.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0] or 0)
    batch_count = int(connection.execute("SELECT COUNT(*) FROM media_batches").fetchone()[0] or 0)
    if other_policy_count == 0 and job_count == 0 and asset_count == 0 and batch_count == 0:
        connection.execute(
            """
            UPDATE media_model_queue_policies
            SET enabled = 1, updated_at = ?
            WHERE model_key = ?
            """,
            (utcnow_iso(), "seedance-2.0"),
        )


def _apply_default_model_release_updates(connection: sqlite3.Connection) -> None:
    _migrate_gpt_image_seed_preset_scopes(connection)
    _seed_default_model_queue_policies(connection)


def _ensure_prompt_recipe_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS prompt_recipes (
            recipe_id TEXT PRIMARY KEY,
            key TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            system_prompt_template TEXT NOT NULL,
            image_analysis_prompt TEXT DEFAULT '',
            user_prompt_placeholder TEXT DEFAULT '{{user_prompt}}',
            output_format TEXT NOT NULL DEFAULT 'single_prompt',
            output_contract_json TEXT NOT NULL DEFAULT '{}',
            input_variables_json TEXT NOT NULL DEFAULT '[]',
            custom_fields_json TEXT NOT NULL DEFAULT '[]',
            image_input_json TEXT NOT NULL DEFAULT '{}',
            validation_warnings_json TEXT NOT NULL DEFAULT '[]',
            default_options_json TEXT NOT NULL DEFAULT '{}',
            rules_json TEXT NOT NULL DEFAULT '{}',
            thumbnail_path TEXT,
            thumbnail_url TEXT,
            notes TEXT DEFAULT '',
            source_kind TEXT NOT NULL DEFAULT 'custom',
            version TEXT NOT NULL DEFAULT '1',
            priority INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    ensure_column(connection, "prompt_recipes", "description", "TEXT DEFAULT ''")
    ensure_column(connection, "prompt_recipes", "category", "TEXT NOT NULL DEFAULT 'utility'")
    ensure_column(connection, "prompt_recipes", "status", "TEXT NOT NULL DEFAULT 'active'")
    ensure_column(connection, "prompt_recipes", "system_prompt_template", "TEXT NOT NULL DEFAULT ''")
    ensure_column(connection, "prompt_recipes", "image_analysis_prompt", "TEXT DEFAULT ''")
    ensure_column(connection, "prompt_recipes", "user_prompt_placeholder", "TEXT DEFAULT '{{user_prompt}}'")
    ensure_column(connection, "prompt_recipes", "output_format", "TEXT NOT NULL DEFAULT 'single_prompt'")
    ensure_column(connection, "prompt_recipes", "output_contract_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "prompt_recipes", "input_variables_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "prompt_recipes", "custom_fields_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "prompt_recipes", "image_input_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "prompt_recipes", "validation_warnings_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "prompt_recipes", "default_options_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "prompt_recipes", "rules_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "prompt_recipes", "thumbnail_path", "TEXT")
    ensure_column(connection, "prompt_recipes", "thumbnail_url", "TEXT")
    ensure_column(connection, "prompt_recipes", "notes", "TEXT DEFAULT ''")
    ensure_column(connection, "prompt_recipes", "source_kind", "TEXT NOT NULL DEFAULT 'custom'")
    ensure_column(connection, "prompt_recipes", "version", "TEXT NOT NULL DEFAULT '1'")
    ensure_column(connection, "prompt_recipes", "priority", "INTEGER NOT NULL DEFAULT 0")


def _apply_prompt_recipes_schema(connection: sqlite3.Connection) -> None:
    _ensure_prompt_recipe_schema(connection)
    _seed_default_prompt_recipes(connection)


def _apply_prompt_recipe_validation_warnings_schema(connection: sqlite3.Connection) -> None:
    ensure_column(connection, "prompt_recipes", "validation_warnings_json", "TEXT NOT NULL DEFAULT '[]'")


def _apply_prompt_recipe_drafting_config_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS media_prompt_recipe_drafting_configs (
            config_key TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1,
            provider_kind TEXT NOT NULL DEFAULT 'openrouter',
            provider_label TEXT,
            provider_model_id TEXT,
            provider_base_url TEXT,
            provider_supports_images INTEGER NOT NULL DEFAULT 0,
            provider_status TEXT,
            provider_last_tested_at TEXT,
            provider_capabilities_json TEXT NOT NULL DEFAULT '{}',
            temperature REAL NOT NULL DEFAULT 0.2,
            max_tokens INTEGER NOT NULL DEFAULT 1800,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _apply_prompt_recipe_drafting_enabled_schema(connection: sqlite3.Connection) -> None:
    ensure_column(connection, "media_prompt_recipe_drafting_configs", "enabled", "INTEGER NOT NULL DEFAULT 1")


def _ensure_graph_seed_schema(connection: sqlite3.Connection) -> None:
    if not table_exists(connection, "graph_templates") or not table_exists(connection, "graph_workflows"):
        _apply_graph_studio_schema(connection)


def _apply_graph_prompt_recipe_seed_refresh(connection: sqlite3.Connection) -> None:
    _ensure_graph_seed_schema(connection)
    _seed_default_prompt_recipes(connection)
    _seed_default_graph_templates(connection)


def _apply_prompt_recipe_graph_runtime_refresh(connection: sqlite3.Connection) -> None:
    _ensure_graph_seed_schema(connection)
    _seed_default_prompt_recipes(connection)
    _seed_default_graph_templates(connection)


def _apply_prompt_recipe_smoke_template_provider_refresh(connection: sqlite3.Connection) -> None:
    _ensure_graph_seed_schema(connection)
    _seed_default_graph_templates(connection)


def _apply_external_llm_usage_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS media_external_llm_usage (
            usage_event_id TEXT PRIMARY KEY,
            provider_kind TEXT NOT NULL,
            provider_model_id TEXT NOT NULL,
            provider_response_id TEXT,
            source_kind TEXT NOT NULL,
            workflow_id TEXT,
            run_id TEXT,
            node_id TEXT,
            recipe_id TEXT,
            model_key TEXT,
            task_mode TEXT,
            usage_json TEXT NOT NULL DEFAULT '{}',
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            reasoning_tokens INTEGER,
            cached_tokens INTEGER,
            cache_write_tokens INTEGER,
            cost_usd REAL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_media_external_llm_usage_provider_response
        ON media_external_llm_usage(provider_kind, provider_response_id)
        WHERE provider_response_id IS NOT NULL AND provider_response_id != ''
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_external_llm_usage_created_at
        ON media_external_llm_usage(created_at DESC)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_external_llm_usage_run_node
        ON media_external_llm_usage(run_id, node_id, created_at DESC)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_external_llm_usage_workflow_created
        ON media_external_llm_usage(workflow_id, created_at DESC)
        """
    )


def _apply_graph_rollout_hardening_cleanup(connection: sqlite3.Connection) -> None:
    now = utcnow_iso()
    canonical_smoke_workflow_names = [
        "Prompt Recipe - Text Single Prompt",
        "Prompt Recipe - Single Image Director",
        "Prompt Recipe - Multi Image Director",
        "Prompt Recipe - Video Director Batch",
        "Prompt Recipe - Storyboard 3x3",
        "Prompt Recipe - Analysis Only",
        "Display Any Smoke",
        "Reference Badge Smoke",
    ]
    for name in canonical_smoke_workflow_names:
        rows = connection.execute(
            """
            SELECT workflow_id
            FROM graph_workflows
            WHERE name = ? AND status != 'archived'
            ORDER BY updated_at DESC, workflow_id DESC
            """,
            (name,),
        ).fetchall()
        for row in rows[1:]:
            connection.execute(
                """
                UPDATE graph_workflows
                SET status = 'archived', updated_at = ?
                WHERE workflow_id = ?
                """,
                (now, row["workflow_id"]),
            )

    for name in ("Prompt Recipe - Single Image Director Copy", "Live Prompt Recipe Smoke"):
        connection.execute(
            """
            UPDATE graph_workflows
            SET status = 'archived', updated_at = ?
            WHERE name = ? AND status != 'archived'
            """,
            (now, name),
        )


def _apply_baseline_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
            CREATE TABLE IF NOT EXISTS media_system_prompts (
                prompt_id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                content TEXT NOT NULL,
                role_tag TEXT,
                applies_to_models_json TEXT NOT NULL DEFAULT '[]',
                applies_to_task_modes_json TEXT NOT NULL DEFAULT '[]',
                applies_to_input_patterns_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_presets (
                preset_id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                model_key TEXT,
                source_kind TEXT NOT NULL DEFAULT 'custom',
                base_builtin_key TEXT,
                applies_to_models_json TEXT NOT NULL DEFAULT '[]',
                applies_to_task_modes_json TEXT NOT NULL DEFAULT '[]',
                applies_to_input_patterns_json TEXT NOT NULL DEFAULT '[]',
                prompt_template TEXT NOT NULL DEFAULT '',
                system_prompt_template TEXT NOT NULL DEFAULT '',
                system_prompt_ids_json TEXT NOT NULL DEFAULT '[]',
                default_options_json TEXT NOT NULL DEFAULT '{}',
                rules_json TEXT NOT NULL DEFAULT '{}',
                requires_image INTEGER NOT NULL DEFAULT 0,
                requires_video INTEGER NOT NULL DEFAULT 0,
                requires_audio INTEGER NOT NULL DEFAULT 0,
                input_schema_json TEXT NOT NULL DEFAULT '[]',
                input_slots_json TEXT NOT NULL DEFAULT '[]',
                choice_groups_json TEXT NOT NULL DEFAULT '[]',
                thumbnail_path TEXT,
                thumbnail_url TEXT,
                notes TEXT,
                version TEXT NOT NULL DEFAULT 'v1',
                priority INTEGER NOT NULL DEFAULT 100,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS prompt_recipes (
                recipe_id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                description TEXT DEFAULT '',
                category TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                system_prompt_template TEXT NOT NULL,
                image_analysis_prompt TEXT DEFAULT '',
                user_prompt_placeholder TEXT DEFAULT '{{user_prompt}}',
                output_format TEXT NOT NULL DEFAULT 'single_prompt',
                output_contract_json TEXT NOT NULL DEFAULT '{}',
                input_variables_json TEXT NOT NULL DEFAULT '[]',
                custom_fields_json TEXT NOT NULL DEFAULT '[]',
                image_input_json TEXT NOT NULL DEFAULT '{}',
                validation_warnings_json TEXT NOT NULL DEFAULT '[]',
                default_options_json TEXT NOT NULL DEFAULT '{}',
                rules_json TEXT NOT NULL DEFAULT '{}',
                thumbnail_path TEXT,
                thumbnail_url TEXT,
                notes TEXT DEFAULT '',
                source_kind TEXT NOT NULL DEFAULT 'custom',
                version TEXT NOT NULL DEFAULT '1',
                priority INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_enhancement_configs (
                config_id TEXT PRIMARY KEY,
                model_key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                helper_profile TEXT,
                provider_kind TEXT NOT NULL DEFAULT 'builtin',
                provider_label TEXT,
                provider_model_id TEXT,
                provider_api_key TEXT,
                provider_base_url TEXT,
                provider_supports_images INTEGER NOT NULL DEFAULT 0,
                provider_status TEXT,
                provider_last_tested_at TEXT,
                provider_capabilities_json TEXT NOT NULL DEFAULT '{}',
                system_prompt TEXT,
                image_analysis_prompt TEXT,
                supports_text_enhancement INTEGER NOT NULL DEFAULT 1,
                supports_image_analysis INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_queue_settings (
                setting_id INTEGER PRIMARY KEY CHECK (setting_id = 1),
                max_concurrent_jobs INTEGER NOT NULL DEFAULT 2,
                queue_enabled INTEGER NOT NULL DEFAULT 1,
                default_poll_seconds INTEGER NOT NULL DEFAULT 6,
                max_retry_attempts INTEGER NOT NULL DEFAULT 3,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_model_queue_policies (
                model_key TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                max_outputs_per_run INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_projects (
                project_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                cover_asset_id TEXT,
                hidden_from_global_gallery INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_batches (
                batch_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                model_key TEXT NOT NULL,
                task_mode TEXT,
                requested_outputs INTEGER NOT NULL DEFAULT 1,
                queued_count INTEGER NOT NULL DEFAULT 0,
                running_count INTEGER NOT NULL DEFAULT 0,
                completed_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                cancelled_count INTEGER NOT NULL DEFAULT 0,
                source_asset_id TEXT,
                project_id TEXT,
                requested_preset_key TEXT,
                resolved_preset_key TEXT,
                preset_source TEXT,
                request_summary_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_jobs (
                job_id TEXT PRIMARY KEY,
                batch_id TEXT NOT NULL,
                batch_index INTEGER NOT NULL DEFAULT 0,
                requested_outputs INTEGER NOT NULL DEFAULT 1,
                provider_task_id TEXT,
                status TEXT NOT NULL,
                queued_at TEXT,
                started_at TEXT,
                finished_at TEXT,
                scheduler_attempts INTEGER NOT NULL DEFAULT 0,
                last_polled_at TEXT,
                queue_position INTEGER,
                model_key TEXT NOT NULL,
                task_mode TEXT,
                source_asset_id TEXT,
                project_id TEXT,
                requested_preset_key TEXT,
                resolved_preset_key TEXT,
                preset_source TEXT,
                raw_prompt TEXT,
                enhanced_prompt TEXT,
                final_prompt_used TEXT,
                selected_system_prompt_ids_json TEXT NOT NULL DEFAULT '[]',
                selected_system_prompts_json TEXT NOT NULL DEFAULT '[]',
                resolved_system_prompt_json TEXT NOT NULL DEFAULT '{}',
                resolved_options_json TEXT NOT NULL DEFAULT '{}',
                normalized_request_json TEXT NOT NULL DEFAULT '{}',
                prompt_context_json TEXT NOT NULL DEFAULT '{}',
                validation_json TEXT NOT NULL DEFAULT '{}',
                preflight_json TEXT NOT NULL DEFAULT '{}',
                prepared_json TEXT NOT NULL DEFAULT '{}',
                submit_response_json TEXT NOT NULL DEFAULT '{}',
                final_status_json TEXT NOT NULL DEFAULT '{}',
                artifact_json TEXT NOT NULL DEFAULT '{}',
                remote_output_url TEXT,
                error TEXT,
                dismissed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(batch_id) REFERENCES media_batches(batch_id)
            );

            CREATE TABLE IF NOT EXISTS media_job_events (
                event_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(job_id) REFERENCES media_jobs(job_id)
            );

            CREATE TABLE IF NOT EXISTS media_assets (
                asset_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                provider_task_id TEXT,
                run_id TEXT,
                source_asset_id TEXT,
                project_id TEXT,
                model_key TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'completed',
                task_mode TEXT,
                generation_kind TEXT NOT NULL DEFAULT 'image',
                prompt_summary TEXT,
                artifact_run_dir TEXT,
                manifest_path TEXT,
                run_json_path TEXT,
                source_path TEXT,
                hero_original_path TEXT,
                hero_web_path TEXT,
                hero_thumb_path TEXT,
                hero_poster_path TEXT,
                hero_original_url TEXT,
                hero_web_url TEXT,
                hero_thumb_url TEXT,
                hero_poster_url TEXT,
                remote_output_url TEXT,
                hidden_from_dashboard INTEGER NOT NULL DEFAULT 0,
                favorited INTEGER NOT NULL DEFAULT 0,
                favorited_at TEXT,
                dismissed INTEGER NOT NULL DEFAULT 0,
                preset_key TEXT,
                preset_source TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]',
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(job_id) REFERENCES media_jobs(job_id)
            );

            CREATE TABLE IF NOT EXISTS reference_media (
                reference_id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                original_filename TEXT,
                stored_path TEXT NOT NULL,
                mime_type TEXT,
                file_size_bytes INTEGER NOT NULL DEFAULT 0,
                sha256 TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                duration_seconds REAL,
                thumb_path TEXT,
                poster_path TEXT,
                usage_count INTEGER NOT NULL DEFAULT 0,
                last_used_at TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_project_references (
                project_id TEXT NOT NULL,
                reference_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (project_id, reference_id),
                FOREIGN KEY(project_id) REFERENCES media_projects(project_id),
                FOREIGN KEY(reference_id) REFERENCES reference_media(reference_id)
            );
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_media_dedupe
        ON reference_media(kind, sha256, file_size_bytes)
        """
    )
    connection.execute(
        """
        INSERT OR IGNORE INTO media_queue_settings (setting_id, max_concurrent_jobs, queue_enabled, default_poll_seconds, max_retry_attempts)
        VALUES (1, 2, 1, 6, 3)
        """
    )
    ensure_column(connection, "media_system_prompts", "role_tag", "TEXT")
    ensure_column(connection, "media_system_prompts", "applies_to_models_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_system_prompts", "applies_to_task_modes_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_system_prompts", "applies_to_input_patterns_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "source_kind", "TEXT NOT NULL DEFAULT 'custom'")
    ensure_column(connection, "media_presets", "base_builtin_key", "TEXT")
    ensure_column(connection, "media_presets", "applies_to_models_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "applies_to_task_modes_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "applies_to_input_patterns_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "system_prompt_template", "TEXT NOT NULL DEFAULT ''")
    ensure_column(connection, "media_presets", "system_prompt_ids_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "input_slots_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "choice_groups_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_presets", "thumbnail_path", "TEXT")
    ensure_column(connection, "media_presets", "thumbnail_url", "TEXT")
    ensure_column(connection, "media_presets", "notes", "TEXT")
    ensure_column(connection, "media_presets", "version", "TEXT NOT NULL DEFAULT 'v1'")
    ensure_column(connection, "media_presets", "priority", "INTEGER NOT NULL DEFAULT 100")
    _ensure_prompt_recipe_schema(connection)
    ensure_column(connection, "media_enhancement_configs", "provider_kind", "TEXT NOT NULL DEFAULT 'builtin'")
    ensure_column(connection, "media_enhancement_configs", "provider_label", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_model_id", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_api_key", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_base_url", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_supports_images", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(connection, "media_enhancement_configs", "provider_status", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_last_tested_at", "TEXT")
    ensure_column(connection, "media_enhancement_configs", "provider_capabilities_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "media_batches", "project_id", "TEXT")
    ensure_column(connection, "media_jobs", "remote_output_url", "TEXT")
    ensure_column(connection, "media_jobs", "project_id", "TEXT")
    ensure_column(connection, "media_assets", "provider_task_id", "TEXT")
    ensure_column(connection, "media_assets", "run_id", "TEXT")
    ensure_column(connection, "media_assets", "source_asset_id", "TEXT")
    ensure_column(connection, "media_assets", "project_id", "TEXT")
    ensure_column(connection, "media_assets", "status", "TEXT NOT NULL DEFAULT 'completed'")
    ensure_column(connection, "media_assets", "task_mode", "TEXT")
    ensure_column(connection, "media_assets", "artifact_run_dir", "TEXT")
    ensure_column(connection, "media_assets", "manifest_path", "TEXT")
    ensure_column(connection, "media_assets", "run_json_path", "TEXT")
    ensure_column(connection, "media_assets", "hidden_from_dashboard", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(connection, "media_assets", "preset_key", "TEXT")
    ensure_column(connection, "media_assets", "preset_source", "TEXT")
    ensure_column(connection, "media_assets", "tags_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(connection, "media_assets", "payload_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "reference_media", "status", "TEXT NOT NULL DEFAULT 'active'")
    ensure_column(connection, "reference_media", "original_filename", "TEXT")
    ensure_column(connection, "reference_media", "stored_path", "TEXT")
    ensure_column(connection, "reference_media", "mime_type", "TEXT")
    ensure_column(connection, "reference_media", "file_size_bytes", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(connection, "reference_media", "sha256", "TEXT")
    ensure_column(connection, "reference_media", "width", "INTEGER")
    ensure_column(connection, "reference_media", "height", "INTEGER")
    ensure_column(connection, "reference_media", "duration_seconds", "REAL")
    ensure_column(connection, "reference_media", "thumb_path", "TEXT")
    ensure_column(connection, "reference_media", "poster_path", "TEXT")
    ensure_column(connection, "reference_media", "usage_count", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(connection, "reference_media", "last_used_at", "TEXT")
    ensure_column(connection, "reference_media", "metadata_json", "TEXT NOT NULL DEFAULT '{}'")
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_batches_project_id
        ON media_batches(project_id, created_at DESC)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_jobs_project_id
        ON media_jobs(project_id, created_at DESC)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_assets_project_id
        ON media_assets(project_id, created_at DESC)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_project_references_reference_id
        ON media_project_references(reference_id, created_at DESC)
        """
    )
    _migrate_multi_model_seed_presets(connection)
    _seed_default_presets(connection)
    _seed_default_prompt_recipes(connection)
    _migrate_gpt_image_seed_preset_scopes(connection)
    _seed_default_model_queue_policies(connection)


def _apply_graph_studio_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
            CREATE TABLE IF NOT EXISTS graph_workflows (
                workflow_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                schema_version INTEGER NOT NULL DEFAULT 1,
                workflow_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS graph_workflow_versions (
                version_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                workflow_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workflow_id) REFERENCES graph_workflows(workflow_id)
            );

            CREATE TABLE IF NOT EXISTS graph_templates (
                template_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                tags_json TEXT NOT NULL DEFAULT '[]',
                thumbnail_path TEXT,
                workflow_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS graph_runs (
                run_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                schema_version INTEGER NOT NULL DEFAULT 1,
                workflow_json TEXT NOT NULL DEFAULT '{}',
                compiled_graph_json TEXT NOT NULL DEFAULT '{}',
                output_snapshot_json TEXT NOT NULL DEFAULT '{}',
                metrics_json TEXT NOT NULL DEFAULT '{}',
                error TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                started_at TEXT,
                finished_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workflow_id) REFERENCES graph_workflows(workflow_id)
            );

            CREATE TABLE IF NOT EXISTS graph_run_nodes (
                run_node_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                node_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                progress REAL,
                input_snapshot_json TEXT NOT NULL DEFAULT '{}',
                output_snapshot_json TEXT NOT NULL DEFAULT '{}',
                metrics_json TEXT NOT NULL DEFAULT '{}',
                error TEXT,
                started_at TEXT,
                finished_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(run_id, node_id),
                FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
            );

            CREATE TABLE IF NOT EXISTS graph_run_events (
                event_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                node_id TEXT,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
            );

            CREATE TABLE IF NOT EXISTS graph_artifacts (
                artifact_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                node_type TEXT NOT NULL,
                output_port TEXT NOT NULL,
                output_index INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL,
                media_type TEXT,
                asset_id TEXT,
                reference_id TEXT,
                job_id TEXT,
                value_json TEXT NOT NULL DEFAULT '{}',
                parent_artifact_id TEXT,
                parent_asset_id TEXT,
                parent_reference_id TEXT,
                transform_type TEXT,
                transform_params_json TEXT NOT NULL DEFAULT '{}',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
            );

            CREATE TABLE IF NOT EXISTS graph_node_definitions_cache (
                cache_id TEXT PRIMARY KEY,
                source_fingerprint TEXT,
                definitions_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """
    )
    ensure_column(connection, "graph_runs", "metrics_json", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(connection, "graph_run_nodes", "metrics_json", "TEXT NOT NULL DEFAULT '{}'")
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_run_events_run_created
        ON graph_run_events(run_id, created_at)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_runs_workflow_created
        ON graph_runs(workflow_id, created_at)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_run
        ON graph_artifacts(run_id, node_id, output_port, output_index)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_workflow_node_created
        ON graph_artifacts(workflow_id, node_id, created_at DESC)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_reference_id
        ON graph_artifacts(reference_id)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_asset_id
        ON graph_artifacts(asset_id)
        """
    )
    _seed_default_graph_templates(connection)


def _apply_graph_artifacts_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
            CREATE TABLE IF NOT EXISTS graph_artifacts (
                artifact_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                node_type TEXT NOT NULL,
                output_port TEXT NOT NULL,
                output_index INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL,
                media_type TEXT,
                asset_id TEXT,
                reference_id TEXT,
                job_id TEXT,
                value_json TEXT NOT NULL DEFAULT '{}',
                parent_artifact_id TEXT,
                parent_asset_id TEXT,
                parent_reference_id TEXT,
                transform_type TEXT,
                transform_params_json TEXT NOT NULL DEFAULT '{}',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
            );
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_run
        ON graph_artifacts(run_id, node_id, output_port, output_index)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_workflow_node_created
        ON graph_artifacts(workflow_id, node_id, created_at DESC)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_reference_id
        ON graph_artifacts(reference_id)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_graph_artifacts_asset_id
        ON graph_artifacts(asset_id)
        """
    )


MIGRATIONS = [
    SchemaMigration(
        migration_id="20260419_001_tracked_baseline",
        version=1,
        description="Initialize tracked Media Studio schema baseline.",
        apply=_apply_baseline_schema,
    ),
    SchemaMigration(
        migration_id="20260419_002_project_cover_references",
        version=2,
        description="Add reference-backed project cover images.",
        apply=lambda connection: ensure_column(connection, "media_projects", "cover_reference_id", "TEXT"),
    ),
    SchemaMigration(
        migration_id="20260419_003_project_visibility_flags",
        version=3,
        description="Add project visibility flags for global gallery filtering.",
        apply=lambda connection: ensure_column(
            connection,
            "media_projects",
            "hidden_from_global_gallery",
            "INTEGER NOT NULL DEFAULT 0",
        ),
    ),
    SchemaMigration(
        migration_id="20260501_004_default_model_release_updates",
        version=4,
        description="Enable GPT Image 2 on built-in image presets and preserve Seedance 2 default availability.",
        apply=_apply_default_model_release_updates,
    ),
    SchemaMigration(
        migration_id="20260511_005_graph_studio",
        version=5,
        description="Add Graph Studio workflow, template, run, event, and node definition tables.",
        apply=_apply_graph_studio_schema,
    ),
    SchemaMigration(
        migration_id="20260512_006_graph_run_metrics",
        version=6,
        description="Add Graph Studio aggregate and per-node run metrics columns.",
        apply=lambda connection: (
            ensure_column(connection, "graph_runs", "metrics_json", "TEXT NOT NULL DEFAULT '{}'"),
            ensure_column(connection, "graph_run_nodes", "metrics_json", "TEXT NOT NULL DEFAULT '{}'"),
        ),
    ),
    SchemaMigration(
        migration_id="20260512_007_graph_artifacts",
        version=7,
        description="Add Graph Studio artifact lineage table and indexes for existing workflow databases.",
        apply=_apply_graph_artifacts_schema,
    ),
    SchemaMigration(
        migration_id="20260516_008_prompt_recipes",
        version=8,
        description="Add Prompt Recipes library table and seeded recipe examples.",
        apply=_apply_prompt_recipes_schema,
    ),
    SchemaMigration(
        migration_id="20260516_009_prompt_recipe_validation_warnings",
        version=9,
        description="Persist Prompt Recipe validation warnings for UI guidance.",
        apply=_apply_prompt_recipe_validation_warnings_schema,
    ),
    SchemaMigration(
        migration_id="20260516_010_prompt_recipe_drafting_config",
        version=10,
        description="Add dedicated Prompt Recipe drafting model defaults and runtime settings.",
        apply=_apply_prompt_recipe_drafting_config_schema,
    ),
    SchemaMigration(
        migration_id="20260517_011_graph_prompt_recipe_seed_refresh",
        version=11,
        description="Refresh built-in Prompt Recipes for Graph Studio and seed Prompt Recipe smoke templates.",
        apply=_apply_graph_prompt_recipe_seed_refresh,
    ),
    SchemaMigration(
        migration_id="20260517_012_prompt_recipe_graph_runtime_refresh",
        version=12,
        description="Refresh built-in Prompt Recipes after graph runtime default and validation updates.",
        apply=_apply_prompt_recipe_graph_runtime_refresh,
    ),
    SchemaMigration(
        migration_id="20260517_013_prompt_recipe_smoke_template_provider_refresh",
        version=13,
        description="Refresh built-in Prompt Recipe smoke templates with explicit provider defaults.",
        apply=_apply_prompt_recipe_smoke_template_provider_refresh,
    ),
    SchemaMigration(
        migration_id="20260517_014_external_llm_usage",
        version=14,
        description="Persist actual external LLM usage and spend for OpenRouter-backed Studio flows.",
        apply=_apply_external_llm_usage_schema,
    ),
    SchemaMigration(
        migration_id="20260517_015_graph_rollout_hardening_cleanup",
        version=15,
        description="Archive duplicate Prompt Recipe smoke workflows and rollout-only dev copies.",
        apply=_apply_graph_rollout_hardening_cleanup,
    ),
    SchemaMigration(
        migration_id="20260519_016_prompt_recipe_drafting_enabled",
        version=16,
        description="Persist whether Prompt Recipe drafting is enabled for recipe editors.",
        apply=_apply_prompt_recipe_drafting_enabled_schema,
    ),
]

LATEST_SCHEMA_VERSION = MIGRATIONS[-1].version


def bootstrap_connection_schema(connection: sqlite3.Connection) -> None:
    _ensure_migration_tables(connection)
    for migration in list_pending_migrations(connection):
        migration.apply(connection)
        _record_migration(connection, migration)
