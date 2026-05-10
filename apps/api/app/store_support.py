from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .db import get_connection


JSON_FIELDS = {
    "default_options_json",
    "rules_json",
    "input_schema_json",
    "input_slots_json",
    "choice_groups_json",
    "applies_to_models_json",
    "applies_to_task_modes_json",
    "applies_to_input_patterns_json",
    "system_prompt_ids_json",
    "request_summary_json",
    "selected_system_prompt_ids_json",
    "selected_system_prompts_json",
    "resolved_system_prompt_json",
    "resolved_options_json",
    "normalized_request_json",
    "prompt_context_json",
    "validation_json",
    "preflight_json",
    "prepared_json",
    "submit_response_json",
    "final_status_json",
    "artifact_json",
    "tags_json",
    "payload_json",
    "provider_capabilities_json",
    "metadata_json",
}

MIGRATION_TABLES = {"schema_meta", "schema_migrations"}


@dataclass(frozen=True)
class SchemaMigration:
    migration_id: str
    version: int
    description: str
    apply: Callable[[sqlite3.Connection], None]


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return "%s_%s" % (prefix, uuid.uuid4().hex[:12])


def _json_default(column: str) -> Any:
    if column.endswith("_json"):
        if column in {
            "input_slots_json",
            "choice_groups_json",
            "applies_to_models_json",
            "applies_to_task_modes_json",
            "applies_to_input_patterns_json",
            "selected_system_prompt_ids_json",
            "selected_system_prompts_json",
            "tags_json",
        }:
            return []
        return {}
    return None


def encode_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def decode_row(row: sqlite3.Row) -> Dict[str, Any]:
    payload = {}
    for key in row.keys():
        value = row[key]
        if key in JSON_FIELDS:
            payload[key] = json.loads(value) if value else _json_default(key)
        elif key in {
            "queue_enabled",
            "enabled",
            "requires_image",
            "requires_video",
            "requires_audio",
            "supports_text_enhancement",
            "supports_image_analysis",
            "favorited",
            "dismissed",
            "hidden_from_dashboard",
            "hidden_from_global_gallery",
        }:
            payload[key] = bool(value)
        else:
            payload[key] = value
    return payload


def connect_path(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (table_name,),
    ).fetchone()
    return row is not None


def ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
    rows = connection.execute("PRAGMA table_info(%s)" % table_name).fetchall()
    existing = {row["name"] for row in rows}
    if column_name in existing:
        return
    connection.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table_name, column_name, definition))


def table_columns(connection: sqlite3.Connection, table_name: str) -> set[str]:
    rows = connection.execute("PRAGMA table_info(%s)" % table_name).fetchall()
    return {row["name"] for row in rows}


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


def list_table(table: str, order_by: str = "created_at DESC") -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM %s ORDER BY %s" % (table, order_by)).fetchall()
    return [decode_row(row) for row in rows]


def get_table(table: str, pk_field: str, pk_value: str) -> Optional[Dict[str, Any]]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM %s WHERE %s = ?" % (table, pk_field),
            (pk_value,),
        ).fetchone()
    return decode_row(row) if row else None


def delete_table(table: str, pk_field: str, pk_value: str) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM %s WHERE %s = ?" % (table, pk_field), (pk_value,))


def upsert_table(table: str, pk_field: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    now = utcnow_iso()
    resolved = payload.copy()
    resolved.setdefault(pk_field, new_id(pk_field.replace("_id", "")))
    resolved.setdefault("created_at", now)
    with get_connection() as connection:
        existing_columns = table_columns(connection, table)
        if "updated_at" in existing_columns:
            resolved["updated_at"] = now
        resolved = {key: value for key, value in resolved.items() if key in existing_columns}
        columns = sorted(resolved.keys())
        placeholders = ", ".join(["?"] * len(columns))
        updates = ", ".join(
            ["%s = excluded.%s" % (column, column) for column in columns if column not in {pk_field, "created_at"}]
        )
        values = [encode_value(resolved[column]) for column in columns]
        connection.execute(
            "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s"
            % (table, ", ".join(columns), placeholders, pk_field, updates),
            values,
        )
    return get_table(table, pk_field, resolved[pk_field])  # type: ignore


def insert_or_update(connection: sqlite3.Connection, table: str, pk_field: str, payload: Dict[str, Any]) -> None:
    columns = sorted(payload.keys())
    placeholders = ", ".join(["?"] * len(columns))
    updates = ", ".join(
        ["%s = excluded.%s" % (column, column) for column in columns if column != pk_field]
    )
    connection.execute(
        "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s"
        % (table, ", ".join(columns), placeholders, pk_field, updates),
        [encode_value(payload[column]) for column in columns],
    )


def next_queue_position(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COALESCE(MAX(queue_position), 0) + 1 AS next_position FROM media_jobs").fetchone()
    return int(row["next_position"])


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
    _migrate_gpt_image_seed_preset_scopes(connection)
    _seed_default_model_queue_policies(connection)


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
]

LATEST_SCHEMA_VERSION = MIGRATIONS[-1].version


def bootstrap_connection_schema(connection: sqlite3.Connection) -> None:
    _ensure_migration_tables(connection)
    for migration in list_pending_migrations(connection):
        migration.apply(connection)
        _record_migration(connection, migration)
