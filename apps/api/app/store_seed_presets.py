from __future__ import annotations

import sqlite3

from .store_support import insert_or_update, utcnow_iso


def seed_default_presets(connection: sqlite3.Connection) -> None:
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
            "category": "layout",
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
            "category": "portrait",
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
            "category": "product",
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
            "category": "layout",
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
            "category": "style",
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
            "category": "restoration",
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
            "category": "character",
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
