from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from .store_seed_presets import seed_default_presets
from .store_seed_prompt_recipes import seed_default_prompt_recipes
from .queue_limits import (
    QUEUE_DEFAULT_MAX_CONCURRENT_JOBS,
    QUEUE_DEFAULT_MAX_RETRY_ATTEMPTS,
    QUEUE_DEFAULT_POLL_SECONDS,
)
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


def _positive_int(value: Any) -> Optional[int]:
    try:
        next_value = int(value)
    except (TypeError, ValueError):
        return None
    return next_value if next_value > 0 else None


def _dimensions_from_asset_payload(payload: Any) -> tuple[Optional[int], Optional[int]]:
    if not isinstance(payload, dict):
        return None, None
    outputs = payload.get("outputs")
    if not isinstance(outputs, list):
        return None, None
    for output in outputs:
        if not isinstance(output, dict):
            continue
        width = _positive_int(output.get("width"))
        height = _positive_int(output.get("height"))
        if width and height:
            return width, height
    return None, None


def _backfill_media_asset_dimensions(connection: sqlite3.Connection) -> None:
    if not table_exists(connection, "media_assets"):
        return
    rows = connection.execute(
        """
        SELECT asset_id, width, height, payload_json
        FROM media_assets
        WHERE (width IS NULL OR height IS NULL)
          AND payload_json IS NOT NULL
          AND payload_json != '{}'
        """
    ).fetchall()
    for row in rows:
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except (TypeError, ValueError):
            continue
        width, height = _dimensions_from_asset_payload(payload)
        if not width or not height:
            continue
        connection.execute(
            """
            UPDATE media_assets
            SET width = COALESCE(width, ?), height = COALESCE(height, ?)
            WHERE asset_id = ?
            """,
            (width, height, row["asset_id"]),
        )


def _apply_media_asset_dimensions(connection: sqlite3.Connection) -> None:
    ensure_column(connection, "media_assets", "width", "INTEGER")
    ensure_column(connection, "media_assets", "height", "INTEGER")
    _backfill_media_asset_dimensions(connection)


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


def _apply_media_preset_category_backfill(connection: sqlite3.Connection) -> None:
    ensure_column(
        connection,
        "media_presets",
        "category",
        "TEXT NOT NULL DEFAULT 'general'",
    )
    connection.execute(
        """
        UPDATE media_presets
        SET category = CASE
            WHEN lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*restor*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*coloriz*'
              THEN 'restoration'
            WHEN lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*grid*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*storyboard*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*sheet*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*infographic*'
              THEN 'layout'
            WHEN lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*video*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*kling*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*seedance*'
              THEN 'video'
            WHEN lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*product*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*food*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*advertisement*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*automotive*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*vehicle*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*vintage car*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*jeep*'
              THEN 'product'
            WHEN lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*character*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*cyborg*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*mech*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*samurai*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*mascot*'
              THEN 'character'
            WHEN lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*portrait*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*selfie*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*person*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*caricature*'
              THEN 'portrait'
            WHEN lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*style*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*poster*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*cinematic*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*retro*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*graffiti*'
              OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*punk*'
              THEN 'style'
            ELSE 'general'
        END
        WHERE COALESCE(category, 'general') = 'general'
        """
    )


def _apply_media_preset_category_backfill_corrections(connection: sqlite3.Connection) -> None:
    ensure_column(
        connection,
        "media_presets",
        "category",
        "TEXT NOT NULL DEFAULT 'general'",
    )
    connection.execute(
        """
        UPDATE media_presets
        SET category = 'portrait'
        WHERE category = 'product'
          AND (
            lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*caricature*'
            OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*portrait*'
            OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*selfie*'
            OR lower(key || ' ' || label || ' ' || COALESCE(description, '')) GLOB '*person*'
          )
        """
    )

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
                            "provider_supports_images": True,
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
                            "provider_supports_images": True,
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
                            "provider_supports_images": True,
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
                            "provider_supports_images": True,
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
                            "provider_supports_images": True,
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
    seed_default_prompt_recipes(connection)


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


def _apply_assistant_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_sessions (
            assistant_session_id TEXT PRIMARY KEY,
            owner_kind TEXT NOT NULL DEFAULT 'standalone',
            owner_id TEXT,
            provider_kind TEXT NOT NULL DEFAULT 'codex_local',
            provider_model_id TEXT,
            provider_thread_id TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            title TEXT,
            summary_json TEXT NOT NULL DEFAULT '{}',
            state_snapshot_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_assistant_sessions_owner
        ON assistant_sessions(owner_kind, owner_id, updated_at DESC)
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_messages (
            assistant_message_id TEXT PRIMARY KEY,
            assistant_session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content_text TEXT NOT NULL DEFAULT '',
            content_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(assistant_session_id) REFERENCES assistant_sessions(assistant_session_id)
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_session
        ON assistant_messages(assistant_session_id, created_at ASC)
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_attachments (
            assistant_attachment_id TEXT PRIMARY KEY,
            assistant_session_id TEXT NOT NULL,
            reference_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'image',
            label TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(assistant_session_id) REFERENCES assistant_sessions(assistant_session_id),
            FOREIGN KEY(reference_id) REFERENCES reference_media(reference_id)
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_assistant_attachments_session
        ON assistant_attachments(assistant_session_id, created_at ASC)
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_plans (
            assistant_plan_id TEXT PRIMARY KEY,
            assistant_session_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            capability TEXT NOT NULL DEFAULT 'plan_graph',
            plan_json TEXT NOT NULL DEFAULT '{}',
            validation_json TEXT NOT NULL DEFAULT '{}',
            pricing_json TEXT NOT NULL DEFAULT '{}',
            workflow_json TEXT NOT NULL DEFAULT '{}',
            applied_workflow_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(assistant_session_id) REFERENCES assistant_sessions(assistant_session_id)
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_assistant_plans_session
        ON assistant_plans(assistant_session_id, created_at DESC)
        """
    )
    _apply_assistant_turn_usage_schema(connection)


def _apply_assistant_plan_workflow_snapshot_schema(connection: sqlite3.Connection) -> None:
    if not table_exists(connection, "assistant_plans"):
        _apply_assistant_schema(connection)
    ensure_column(connection, "assistant_plans", "workflow_json", "TEXT NOT NULL DEFAULT '{}'")


def _apply_assistant_turn_usage_schema(connection: sqlite3.Connection) -> None:
    if not table_exists(connection, "assistant_sessions"):
        _apply_assistant_schema(connection)
        return
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_turn_usage (
            assistant_turn_usage_id TEXT PRIMARY KEY,
            assistant_session_id TEXT NOT NULL,
            assistant_message_id TEXT,
            provider_kind TEXT NOT NULL DEFAULT 'codex_local',
            provider_model_id TEXT,
            provider_response_id TEXT,
            token_input_count INTEGER,
            token_output_count INTEGER,
            image_count INTEGER NOT NULL DEFAULT 0,
            latency_ms INTEGER,
            cost_usd REAL NOT NULL DEFAULT 0,
            usage_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(assistant_session_id) REFERENCES assistant_sessions(assistant_session_id)
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_assistant_turn_usage_session
        ON assistant_turn_usage(assistant_session_id, created_at DESC)
        """
    )


def _ensure_graph_seed_schema(connection: sqlite3.Connection) -> None:
    if not table_exists(connection, "graph_templates") or not table_exists(connection, "graph_workflows"):
        _apply_graph_studio_schema(connection)


def _apply_graph_prompt_recipe_seed_refresh(connection: sqlite3.Connection) -> None:
    _ensure_graph_seed_schema(connection)
    seed_default_prompt_recipes(connection)
    _seed_default_graph_templates(connection)


def _apply_prompt_recipe_graph_runtime_refresh(connection: sqlite3.Connection) -> None:
    _ensure_graph_seed_schema(connection)
    seed_default_prompt_recipes(connection)
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
                category TEXT NOT NULL DEFAULT 'general',
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
                max_concurrent_jobs INTEGER NOT NULL DEFAULT 10,
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
                width INTEGER,
                height INTEGER,
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
        VALUES (1, ?, 1, ?, ?)
        """,
        (
            QUEUE_DEFAULT_MAX_CONCURRENT_JOBS,
            QUEUE_DEFAULT_POLL_SECONDS,
            QUEUE_DEFAULT_MAX_RETRY_ATTEMPTS,
        ),
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
    ensure_column(connection, "media_assets", "width", "INTEGER")
    ensure_column(connection, "media_assets", "height", "INTEGER")
    _backfill_media_asset_dimensions(connection)
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
    seed_default_presets(connection)
    seed_default_prompt_recipes(connection)
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
    SchemaMigration(
        migration_id="20260524_017_media_studio_assistant",
        version=17,
        description="Add Media Studio Creative Assistant sessions, messages, attachments, and plans.",
        apply=_apply_assistant_schema,
    ),
    SchemaMigration(
        migration_id="20260524_018_assistant_plan_workflow_snapshots",
        version=18,
        description="Persist validated assistant workflow snapshots for apply review.",
        apply=_apply_assistant_plan_workflow_snapshot_schema,
    ),
    SchemaMigration(
        migration_id="20260524_019_assistant_turn_usage",
        version=19,
        description="Track assistant provider usage and diagnostics per turn.",
        apply=_apply_assistant_turn_usage_schema,
    ),
    SchemaMigration(
        migration_id="20260612_020_media_preset_categories",
        version=20,
        description="Add lightweight category metadata for Media Presets.",
        apply=lambda connection: ensure_column(
            connection,
            "media_presets",
            "category",
            "TEXT NOT NULL DEFAULT 'general'",
        ),
    ),
    SchemaMigration(
        migration_id="20260612_021_media_preset_category_backfill",
        version=21,
        description="Backfill obvious Media Preset categories from existing preset names.",
        apply=_apply_media_preset_category_backfill,
    ),
    SchemaMigration(
        migration_id="20260612_022_media_preset_category_backfill_corrections",
        version=22,
        description="Correct over-broad product category matches from initial preset backfill.",
        apply=_apply_media_preset_category_backfill_corrections,
    ),
    SchemaMigration(
        migration_id="20260612_023_media_asset_dimensions",
        version=23,
        description="Persist lightweight media asset dimensions for compact gallery summaries.",
        apply=_apply_media_asset_dimensions,
    ),
    SchemaMigration(
        migration_id="20260628_024_prompt_recipe_storyboard_continuation_seed_refresh",
        version=24,
        description="Refresh built-in Prompt Recipes with Storyboard Continuation support.",
        apply=seed_default_prompt_recipes,
    ),
    SchemaMigration(
        migration_id="20260628_025_prompt_recipe_storyboard_continuation_simplify",
        version=25,
        description="Refresh Storyboard Continuation built-in recipe with simplified exposed fields.",
        apply=seed_default_prompt_recipes,
    ),
    SchemaMigration(
        migration_id="20260628_026_prompt_recipe_storyboard_safe_action_language",
        version=26,
        description="Refresh Storyboard built-in recipes with provider-safe action language.",
        apply=seed_default_prompt_recipes,
    ),
    SchemaMigration(
        migration_id="20260628_027_prompt_recipe_storyboard_continuity_ledger",
        version=27,
        description="Refresh Storyboard built-in recipes with continuity ledger and dialogue mode controls.",
        apply=seed_default_prompt_recipes,
    ),
    SchemaMigration(
        migration_id="20260628_028_prompt_recipe_storyboard_dialogue_placeholders",
        version=28,
        description="Refresh Storyboard built-in recipes to avoid dialogue placeholder marks.",
        apply=seed_default_prompt_recipes,
    ),
    SchemaMigration(
        migration_id="20260628_029_prompt_recipe_storyboard_full_dialogue",
        version=29,
        description="Refresh Storyboard built-in recipes with stricter full-dialogue behavior.",
        apply=seed_default_prompt_recipes,
    ),
]

LATEST_SCHEMA_VERSION = MIGRATIONS[-1].version


def bootstrap_connection_schema(connection: sqlite3.Connection) -> None:
    _ensure_migration_tables(connection)
    for migration in list_pending_migrations(connection):
        migration.apply(connection)
        _record_migration(connection, migration)
