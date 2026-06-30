from __future__ import annotations

import sqlite3
from pathlib import Path

from app.store_schema import LATEST_SCHEMA_VERSION


def _migration_count(db_path: Path) -> int:
    connection = sqlite3.connect(db_path)
    try:
        row = connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()
    finally:
        connection.close()
    return int(row[0] or 0)


def _columns(db_path: Path, table_name: str) -> set[str]:
    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute("PRAGMA table_info(%s)" % table_name).fetchall()
    finally:
        connection.close()
    return {str(row[1]) for row in rows}


def test_bootstrap_schema_is_idempotent_and_preserves_latest_version(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "idempotent-schema.sqlite"

    store.bootstrap_schema(db_path)
    first_status = store.get_schema_status(db_path)
    first_migration_count = _migration_count(db_path)

    store.bootstrap_schema(db_path)
    second_status = store.get_schema_status(db_path)
    second_migration_count = _migration_count(db_path)

    assert first_status["schema_version"] == LATEST_SCHEMA_VERSION
    assert first_status["latest_version"] == LATEST_SCHEMA_VERSION
    assert first_status["pending_migrations"] == []
    assert second_status["schema_version"] == LATEST_SCHEMA_VERSION
    assert second_status["latest_version"] == LATEST_SCHEMA_VERSION
    assert second_status["pending_migrations"] == []
    assert second_migration_count == first_migration_count
    assert len(second_status["applied_migrations"]) == first_migration_count
    assert second_status["applied_migrations"][-1]["version"] == LATEST_SCHEMA_VERSION
    assert {"width", "height"}.issubset(_columns(db_path, "media_assets"))


def test_bootstrap_schema_refreshes_new_builtin_prompt_recipes_on_existing_database(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "existing-prompt-recipe-seed-refresh.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM prompt_recipes WHERE recipe_id = ?", ("prompt-recipe-storyboard-continuation-v1",))
        connection.execute(
            "DELETE FROM schema_migrations WHERE migration_id = ?",
            ("20260628_024_prompt_recipe_storyboard_continuation_seed_refresh",),
        )
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("23", "schema_version"))
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        recipe = connection.execute(
            """
            SELECT recipe_id, key, label, status, source_kind
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-storyboard-continuation-v1",),
        ).fetchone()
    finally:
        connection.close()

    assert recipe is not None
    assert recipe[1] == "storyboard-continuation-v1"
    assert recipe[2] == "Storyboard Continuation v1"
    assert recipe[3] == "active"
    assert recipe[4] == "builtin"
