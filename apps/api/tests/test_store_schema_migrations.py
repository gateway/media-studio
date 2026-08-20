from __future__ import annotations

import json
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


def test_bootstrap_schema_refreshes_food_storyboard_prompt_recipe_on_existing_database(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "existing-food-storyboard-seed-refresh.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM prompt_recipes WHERE recipe_id = ?", ("prompt-recipe-food-storyboard-host-v1",))
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (33,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("32", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260701_032_prompt_recipe_legacy_node_type_conversion", "last_migration_id"),
        )
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
            ("prompt-recipe-food-storyboard-host-v1",),
        ).fetchone()
    finally:
        connection.close()

    assert recipe is not None
    assert recipe[1] == "food-storyboard-host-v1"
    assert recipe[2] == "Food Storyboard Host v1"
    assert recipe[3] == "active"
    assert recipe[4] == "builtin"


def test_bootstrap_schema_refreshes_seedance_storyboard_video_director_prompt_recipe_on_existing_database(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "existing-seedance-storyboard-video-director-seed-refresh.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM prompt_recipes WHERE recipe_id = ?", ("prompt-recipe-seedance-storyboard-video-director-v1",))
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (34,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("33", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260701_033_prompt_recipe_food_storyboard_host_seed", "last_migration_id"),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        recipe = connection.execute(
            """
            SELECT recipe_id, key, label, status, source_kind, category
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        ).fetchone()
    finally:
        connection.close()

    assert recipe is not None
    assert recipe[1] == "seedance-storyboard-video-director-v1"
    assert recipe[2] == "Seedance Storyboard Video Director v1"
    assert recipe[3] == "active"
    assert recipe[4] == "builtin"
    assert recipe[5] == "video"


def test_bootstrap_schema_refreshes_storyboard_neutral_subject_label_prompt_recipes(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "existing-storyboard-neutral-subject-labels.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (35,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("34", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260705_034_prompt_recipe_seedance_storyboard_video_director_seed", "last_migration_id"),
        )
        connection.execute(
            """
            UPDATE prompt_recipes
            SET system_prompt_template = 'old seedance prompt'
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        recipe = connection.execute(
            """
            SELECT system_prompt_template
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        ).fetchone()
    finally:
        connection.close()

    assert recipe is not None
    assert "SUBJECT LABEL RULES" in recipe[0]
    assert "For a 15-second video, prefer 6-8 strong contiguous beats" in recipe[0]
    assert "use neutral subject labels instead of personal names" in recipe[0]


def test_bootstrap_schema_refreshes_seedance_storyboard_sheet_modes(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "existing-seedance-storyboard-sheet-modes.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (53,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("52", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260716_052_prompt_recipe_storyboard_concise_display_contract", "last_migration_id"),
        )
        connection.execute(
            """
            UPDATE prompt_recipes
            SET system_prompt_template = 'old seedance storyboard sheet prompt',
                version = '1.1'
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        recipe = connection.execute(
            """
            SELECT system_prompt_template, version
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        ).fetchone()
    finally:
        connection.close()

    assert recipe is not None
    assert recipe[1] == "1.3"
    assert "metadata-rich production storyboards and image-dominant scene-number-only storyboards" in recipe[0]
    assert "do not require metadata rows" in recipe[0]
    assert "do not turn scene-number badges into overlays, timecodes, or dialogue" in recipe[0]


def test_bootstrap_schema_refreshes_seedance_reference_layout(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "existing-seedance-reference-layout.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (54,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("53", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260728_053_prompt_recipe_seedance_storyboard_sheet_modes", "last_migration_id"),
        )
        connection.execute(
            """
            UPDATE prompt_recipes
            SET system_prompt_template = 'old fixed three-reference seedance prompt',
                version = '1.2'
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        recipe = connection.execute(
            """
            SELECT system_prompt_template, version, input_variables_json
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-seedance-storyboard-video-director-v1",),
        ).fetchone()
    finally:
        connection.close()

    assert recipe is not None
    assert recipe[1] == "1.3"
    assert "character_storyboard" in recipe[0]
    assert "character_environment_storyboard" in recipe[0]
    assert "do not mention @image3" in recipe[0]
    assert "reference_layout" in {item["key"] for item in json.loads(recipe[2])}


def test_bootstrap_schema_refreshes_storyboard_environment_sheet_lock_prompt_recipe(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "existing-storyboard-environment-lock.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (39,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("38", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260706_038_prompt_recipe_environment_sheet_v1", "last_migration_id"),
        )
        connection.execute(
            """
            UPDATE prompt_recipes
            SET system_prompt_template = 'old storyboard prompt', version = '2.7'
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        recipe = connection.execute(
            """
            SELECT system_prompt_template, version
            FROM prompt_recipes
            WHERE recipe_id = ?
            """,
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        ).fetchone()
    finally:
        connection.close()

    assert recipe is not None
    assert recipe[1] == "2.28"
    assert "identity-like references control identity" in recipe[0]
    assert "use it for spatial continuity only" in recipe[0]
    assert "Treat PREVIOUS BOARD HANDOFF as private continuity state" in recipe[0]


def test_bootstrap_schema_refreshes_phase_16_storyboard_recipes_from_version_42(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "phase-16-storyboard-recipe-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (43,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("42", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260709_042_prompt_recipe_storyboard_continuity_prompt_cleanup", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '2.12' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '1.7' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-continuation-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        versions = dict(
            connection.execute(
                "SELECT recipe_id, version FROM prompt_recipes WHERE recipe_id IN (?, ?)",
                ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
            ).fetchall()
        )
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (43,),
        ).fetchone()[0]
    finally:
        connection.close()

    assert versions == {
        "prompt-recipe-storyboard-v2-gpt-image-2": "2.28",
        "prompt-recipe-storyboard-continuation-v1": "1.21",
    }
    assert migration_count == 1


def test_bootstrap_schema_refreshes_user_owned_board_identity_fields_from_version_43(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-user-owned-board-identity-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (44,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("43", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260712_043_prompt_recipe_storyboard_sequence_quality_refresh", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '2.13' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '1.8' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-continuation-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, custom_fields_json FROM prompt_recipes WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (44,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {recipe_id: (version, json.loads(custom_fields_json)) for recipe_id, version, custom_fields_json in rows}
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    assert all(
        {"board_title", "production_metadata"}.issubset({field["key"] for field in fields})
        for _, fields in by_id.values()
    )
    assert migration_count == 1


def test_bootstrap_schema_refreshes_storyboard_six_row_metadata_from_version_44(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-six-row-metadata-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (45,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("44", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260712_044_prompt_recipe_storyboard_user_owned_board_identity", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '2.16' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '1.11' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-continuation-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template FROM prompt_recipes WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (45,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {recipe_id: (version, prompt) for recipe_id, version, prompt in rows}
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    assert all("five separate horizontal rows stacked vertically" in prompt for _, prompt in by_id.values())
    assert all("SHOT" in prompt and "heading above each image" in prompt for _, prompt in by_id.values())
    assert all("FRAMING:" not in prompt for _, prompt in by_id.values())
    assert all("CAMERA:" in prompt for _, prompt in by_id.values())
    assert migration_count == 1


def test_bootstrap_schema_requires_all_storyboard_metadata_rows_from_version_45(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-mandatory-metadata-rows-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (46,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("45", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260713_045_prompt_recipe_storyboard_six_row_metadata", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '2.17' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '1.12' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-continuation-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template FROM prompt_recipes WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (46,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {recipe_id: (version, prompt) for recipe_id, version, prompt in rows}
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    assert all("SHOT heading and all five row labels are mandatory" in prompt for _, prompt in by_id.values())
    assert all("Never omit a required heading or row label" in prompt for _, prompt in by_id.values())
    assert migration_count == 1


def test_bootstrap_schema_requires_non_empty_storyboard_metadata_from_version_46(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-non-empty-metadata-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (47,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("46", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260713_046_prompt_recipe_storyboard_mandatory_metadata_rows", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '2.18' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-v2-gpt-image-2",),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = '1.13' WHERE recipe_id = ?",
            ("prompt-recipe-storyboard-continuation-v1",),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template, output_contract_json "
            "FROM prompt_recipes WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (47,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {
        recipe_id: (version, prompt, json.loads(output_contract_json))
        for recipe_id, version, prompt, output_contract_json in rows
    }
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    assert all("DIALOG alone may have a blank value" in prompt for _, prompt, _ in by_id.values())
    assert all(
        contract["storyboard_metadata"]["required_non_empty"]
        == ["SHOT", "CAMERA", "ACTION", "MOTION", "NOTES"]
        for _, _, contract in by_id.values()
    )
    assert migration_count == 1


def test_bootstrap_schema_aligns_storyboard_sheet_contracts_from_version_47(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-shared-sheet-contract-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (48,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("47", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260714_047_prompt_recipe_storyboard_non_empty_metadata_values", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = 'old', system_prompt_template = 'drifted' "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template, output_contract_json, default_options_json "
            "FROM prompt_recipes WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (48,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {
        recipe_id: (version, prompt, json.loads(contract), json.loads(options))
        for recipe_id, version, prompt, contract, options in rows
    }
    storyboard = by_id["prompt-recipe-storyboard-v2-gpt-image-2"]
    continuation = by_id["prompt-recipe-storyboard-continuation-v1"]
    assert storyboard[0] == "2.28"
    assert continuation[0] == "1.21"
    assert storyboard[1].count("IMMUTABLE STORYBOARD V2 SHEET CONTRACT") == 1
    assert continuation[1].count("IMMUTABLE STORYBOARD V2 SHEET CONTRACT") == 1
    assert storyboard[2:] == continuation[2:]
    assert migration_count == 1


def test_bootstrap_schema_refreshes_distinct_storyboard_metadata_roles_from_version_48(
    app_modules, tmp_path: Path
) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-distinct-metadata-role-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (49,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("48", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260714_048_prompt_recipe_storyboard_shared_sheet_contract", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = 'old', system_prompt_template = 'drifted' "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template FROM prompt_recipes "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (49,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {recipe_id: (version, prompt) for recipe_id, version, prompt in rows}
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    assert all("Keep all three values semantically distinct" in prompt for _, prompt in by_id.values())
    assert all("Never omit a required value, copy one row into another" in prompt for _, prompt in by_id.values())
    assert migration_count == 1


def test_bootstrap_schema_refreshes_storyboard_metadata_completion_audit_from_version_49(
    app_modules, tmp_path: Path
) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-metadata-completion-audit-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (50,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("49", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260716_049_prompt_recipe_storyboard_distinct_metadata_roles", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = 'old', system_prompt_template = 'drifted' "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template FROM prompt_recipes "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (50,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {recipe_id: (version, prompt) for recipe_id, version, prompt in rows}
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    assert all("FINAL METADATA AUDIT" in prompt for _, prompt in by_id.values())
    assert all(
        "count exactly one SHOT heading and one CAMERA, ACTION, MOTION, DIALOG, and NOTES row" in prompt
        for _, prompt in by_id.values()
    )
    assert migration_count == 1


def test_bootstrap_schema_refreshes_storyboard_user_owned_panel_notes_from_version_50(
    app_modules, tmp_path: Path
) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-user-owned-panel-notes-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (51,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("50", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260716_050_prompt_recipe_storyboard_metadata_completion_audit", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = 'old', system_prompt_template = 'drifted', custom_fields_json = '[]' "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template, custom_fields_json FROM prompt_recipes "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (51,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {
        recipe_id: (version, prompt, json.loads(custom_fields))
        for recipe_id, version, prompt, custom_fields in rows
    }
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    for _, prompt, custom_fields in by_id.values():
        assert "PANEL NOTES CUES" in prompt
        assert "reproduce each supplied note verbatim as that panel's NOTES value" in prompt
        assert "panel_notes_cues" in {field["key"] for field in custom_fields}
    assert migration_count == 1


def test_bootstrap_schema_refreshes_storyboard_concise_display_contract_from_version_51(
    app_modules, tmp_path: Path
) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "storyboard-concise-display-contract-refresh.sqlite"

    store.bootstrap_schema(db_path)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version = ?", (52,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("51", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260716_051_prompt_recipe_storyboard_user_owned_panel_notes", "last_migration_id"),
        )
        connection.execute(
            "UPDATE prompt_recipes SET version = 'old', system_prompt_template = 'drifted', "
            "output_contract_json = '{}' WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(
            "SELECT recipe_id, version, system_prompt_template, output_contract_json FROM prompt_recipes "
            "WHERE recipe_id IN (?, ?)",
            ("prompt-recipe-storyboard-v2-gpt-image-2", "prompt-recipe-storyboard-continuation-v1"),
        ).fetchall()
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
            (52,),
        ).fetchone()[0]
    finally:
        connection.close()

    by_id = {
        recipe_id: (version, prompt, json.loads(contract))
        for recipe_id, version, prompt, contract in rows
    }
    assert by_id["prompt-recipe-storyboard-v2-gpt-image-2"][0] == "2.28"
    assert by_id["prompt-recipe-storyboard-continuation-v1"][0] == "1.21"
    contracts = []
    for _, prompt, contract in by_id.values():
        assert "SHOT appears exactly once as the panel heading above the image" in prompt
        assert "five separate horizontal rows stacked vertically" in prompt
        contracts.append(contract["storyboard_metadata"])
    assert contracts[0] == contracts[1]
    assert contracts[0]["shot_placement"] == "panel_heading_only"
    assert contracts[0]["max_characters"]["CAMERA"] == 136
    assert migration_count == 1


def test_bootstrap_schema_normalizes_old_prompt_recipe_openrouter_defaults(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "prompt-recipe-provider-backfill.sqlite"

    store.bootstrap_schema(db_path)

    old_workflow = {
        "schema_version": 1,
        "name": "Old assistant recipe defaults",
        "nodes": [
            {
                "id": "recipe-old",
                "type": "prompt.recipe",
                "fields": {
                    "provider": "openrouter",
                    "model_id": "openai/gpt-4o-mini",
                    "provider_model_label": "GPT-4o mini",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {"provider": "openrouter", "model_id": "openai/gpt-4o-mini"},
                },
            },
            {
                "id": "recipe-specialized-old",
                "type": "prompt.recipe.image_prompt_director",
                "fields": {
                    "provider": "openrouter",
                    "model_id": "openai/gpt-4o-mini",
                    "model_supports_images": True,
                },
            },
            {
                "id": "recipe-user-choice",
                "type": "prompt.recipe",
                "fields": {
                    "provider": "openrouter",
                    "model_id": "anthropic/claude-sonnet-4",
                    "provider_supports_images": True,
                },
            },
        ],
        "edges": [],
    }
    old_json = json.dumps(old_workflow)

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("DELETE FROM schema_migrations WHERE version >= ?", (32,))
        connection.execute("UPDATE schema_meta SET value = ? WHERE key = ?", ("31", "schema_version"))
        connection.execute(
            "UPDATE schema_meta SET value = ? WHERE key = ?",
            ("20260701_031_prompt_recipe_studio_default_provider_specialized_nodes", "last_migration_id"),
        )
        connection.execute(
            """
            INSERT INTO graph_workflows (workflow_id, name, status, schema_version, workflow_json, created_at, updated_at)
            VALUES ('wf_old_provider', 'Old provider workflow', 'active', 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (old_json,),
        )
        connection.execute(
            """
            INSERT INTO graph_workflow_versions (version_id, workflow_id, version_number, workflow_json, created_at)
            VALUES ('ver_old_provider', 'wf_old_provider', 1, ?, CURRENT_TIMESTAMP)
            """,
            (old_json,),
        )
        connection.execute(
            """
            INSERT INTO graph_templates (template_id, name, description, status, tags_json, workflow_json, created_at, updated_at)
            VALUES ('tpl_old_provider', 'Old provider template', '', 'active', '[]', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (old_json,),
        )
        connection.execute(
            """
            INSERT INTO assistant_plans (
                assistant_plan_id, assistant_session_id, status, capability, plan_json, validation_json,
                pricing_json, workflow_json, created_at, updated_at
            )
            VALUES (
                'plan_old_provider', 'session_old_provider', 'draft', 'plan_graph', '{}', '{}',
                '{}', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """,
            (old_json,),
        )
        connection.commit()
    finally:
        connection.close()

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        rows = [
            connection.execute("SELECT workflow_json FROM graph_workflows WHERE workflow_id = 'wf_old_provider'").fetchone()[0],
            connection.execute("SELECT workflow_json FROM graph_workflow_versions WHERE version_id = 'ver_old_provider'").fetchone()[0],
            connection.execute("SELECT workflow_json FROM graph_templates WHERE template_id = 'tpl_old_provider'").fetchone()[0],
            connection.execute("SELECT workflow_json FROM assistant_plans WHERE assistant_plan_id = 'plan_old_provider'").fetchone()[0],
        ]
    finally:
        connection.close()

    for raw_json in rows:
        workflow = json.loads(raw_json)
        by_id = {node["id"]: node for node in workflow["nodes"]}
        migrated_fields = by_id["recipe-old"]["fields"]
        specialized_migrated = by_id["recipe-specialized-old"]
        specialized_migrated_fields = by_id["recipe-specialized-old"]["fields"]
        preserved_fields = by_id["recipe-user-choice"]["fields"]
        assert migrated_fields["provider"] == "studio_default"
        assert migrated_fields["model_id"] == ""
        assert migrated_fields["provider_model_label"] == ""
        assert migrated_fields["provider_supports_images"] is None
        assert migrated_fields["provider_capabilities_json"] == {}
        assert specialized_migrated["type"] == "prompt.recipe"
        assert specialized_migrated_fields["provider"] == "studio_default"
        assert specialized_migrated_fields["model_id"] == ""
        assert specialized_migrated_fields["recipe_id"] == "prompt-recipe-image-prompt-director"
        assert specialized_migrated_fields["recipe_category"] == "image"
        assert "model_supports_images" not in specialized_migrated_fields
        assert preserved_fields["provider"] == "openrouter"
        assert preserved_fields["model_id"] == "anthropic/claude-sonnet-4"
