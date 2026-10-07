from contextlib import contextmanager
import importlib
import sqlite3

from conftest import app_modules as app_modules_fixture


def test_fixture_reuses_schemas_but_isolates_application_and_database(tmp_path):
    fixture = contextmanager(app_modules_fixture.__wrapped__)
    first_path = tmp_path / "first"
    first_path.mkdir()
    with fixture(first_path) as first:
        schemas = first["schemas"]
        graph_schemas = importlib.import_module("app.graph.schemas")
        first_settings = importlib.import_module("app.settings").settings
        first["main"].app.state.fixture_probe = True
        first["runner"].runner.fixture_probe = True
        with sqlite3.connect(first_settings.db_path) as connection:
            connection.execute("CREATE TABLE fixture_probe (value TEXT)")

    second_path = tmp_path / "second"
    second_path.mkdir()
    with fixture(second_path) as second:
        # Schema compilation is shared; application singletons and storage are not.
        assert second["schemas"] is schemas
        assert importlib.import_module("app.graph.schemas") is graph_schemas
        assert importlib.import_module("app").schemas is schemas
        assert importlib.import_module("app.graph").schemas is graph_schemas
        settings = importlib.import_module("app.settings").settings
        assert settings is not first_settings
        assert settings.db_path == second_path / "test.db"
        assert second["main"] is not first["main"]
        assert second["store"] is not first["store"]
        assert second["runner"].runner is not first["runner"].runner
        assert not hasattr(second["main"].app.state, "fixture_probe")
        assert not hasattr(second["runner"].runner, "fixture_probe")
        with sqlite3.connect(settings.db_path) as connection:
            assert connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'fixture_probe'"
            ).fetchone() is None
        # Default mutable instance values still belong to individual models.
        one = graph_schemas.GraphWorkflow(name="one")
        two = graph_schemas.GraphWorkflow(name="two")
        one.metadata["fixture_probe"] = True
        assert "fixture_probe" not in two.metadata
