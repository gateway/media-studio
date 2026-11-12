"""Run startup decisions with mocked directories, stores, threads and schema state."""

import ast
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from startup_preflight import check_startup, readonly_database_uri


APP = Path(__file__).resolve().parents[1] / "apps" / "api" / "app"


def source(file):
    return ast.parse((APP / file).read_text())


def named(nodes, name):
    return next(node for node in nodes if getattr(node, "name", None) == name)


def isolated_definition(node, scope):
    # Compile only the decision under test: app imports and module startup cannot run.
    exec(compile(ast.Module(body=[node], type_ignores=[]), "<startup test>", "exec"), scope)
    return scope[node.name]


def recovery_setting(env):
    nodes = source("settings.py").body
    env_bool = isolated_definition(named(nodes, "_env_bool"), {"os": SimpleNamespace(getenv=env.get)})
    configured = next(node.value for node in nodes if isinstance(node, ast.Assign) and
                      any(isinstance(target, ast.Name) and target.id == "settings" for target in node.targets))
    expression = next(arg.value for arg in configured.keywords if arg.arg == "media_startup_recovery_enabled")
    return eval(compile(ast.Expression(expression), "<startup setting>", "eval"), {"_env_bool": env_bool})


class StartupRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def exercise_startup(self, env, *, poll_enabled):
        thread = Mock()
        graph = Mock()
        store = Mock()
        runner = Mock(_thread=None)
        settings = SimpleNamespace(
            media_startup_recovery_enabled=recovery_setting(env),
            media_background_poll_enabled=poll_enabled,
            media_pricing_refresh_on_startup=False,
            data_root=Mock(), uploads_dir=Mock(), downloads_dir=Mock(), outputs_dir=Mock(),
        )
        runner_class = named(source("runner.py").body, "MediaRunner")
        start = isolated_definition(named(runner_class.body, "start"), {
            "settings": settings, "threading": SimpleNamespace(Thread=Mock(return_value=thread)),
        })
        runner.start.side_effect = lambda: start(runner)
        lifespan = isolated_definition(named(source("main.py").body, "lifespan"), {
            "asynccontextmanager": asynccontextmanager, "FastAPI": object, "settings": settings,
            "store": store, "runner": runner, "logger": Mock(), "codex_local_provider": Mock(),
            "kie_adapter": Mock(),
            "__builtins__": {"__import__": Mock(return_value=SimpleNamespace(runtime=graph)), "Exception": Exception},
        })
        async with lifespan(None):
            store.bootstrap_schema.assert_called_once_with()
        return graph, store, runner, thread

    async def test_recovery_defaults_to_previous_graph_and_media_behavior(self):
        graph, store, runner, thread = await self.exercise_startup({}, poll_enabled=True)
        graph.recover_interrupted_runs.assert_called_once_with()
        store.mark_interrupted_graph_runs.assert_called_once_with()
        runner.reconcile.assert_called_once_with()
        thread.start.assert_called_once_with()

    async def test_disabling_recovery_skips_both_systems_but_starts_the_worker(self):
        graph, store, runner, thread = await self.exercise_startup({"MEDIA_STARTUP_RECOVERY_ENABLED": "0"}, poll_enabled=True)
        graph.recover_interrupted_runs.assert_not_called()
        store.mark_interrupted_graph_runs.assert_not_called()
        runner.reconcile.assert_not_called()
        thread.start.assert_called_once_with()

    async def test_verification_keeps_worker_and_recovery_disabled(self):
        graph, store, runner, thread = await self.exercise_startup({"MEDIA_STARTUP_RECOVERY_ENABLED": "false"}, poll_enabled=False)
        graph.recover_interrupted_runs.assert_not_called()
        store.mark_interrupted_graph_runs.assert_not_called()
        runner.start.assert_not_called()
        thread.start.assert_not_called()


class StartupPreflightTests(unittest.TestCase):
    def setUp(self):
        self.connection = Mock()
        self.status = Mock(return_value={"user_schema_present": True, "pending_migrations": []})
        pending = isolated_definition(named(source("store_support.py").body, "pending_generation_exists"), {"sqlite3": sqlite3})
        self.enterContext(patch.dict(sys.modules, {
            "app.store_schema": SimpleNamespace(schema_status=self.status),
            "app.store_support": SimpleNamespace(pending_generation_exists=pending),
        }))

    def test_pending_migration_blocks_before_queue_check(self):
        self.status.return_value["pending_migrations"] = ["next"]
        for mode in ("live", "verification"):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "Pending database migrations"):
                check_startup(self.connection, mode)
        self.connection.execute.assert_not_called()

    def test_live_blocks_pending_media_or_graph_but_accepts_empty_queue(self):
        for media, graph in ((True, False), (False, True), (False, False)):
            with self.subTest(media=media, graph=graph):
                self.connection.execute.reset_mock()
                self.connection.execute.side_effect = lambda sql, media=media, graph=graph: SimpleNamespace(
                    fetchone=lambda: (1,) if (media if "media_jobs" in sql else graph) else None,
                )
                if media or graph:
                    with self.assertRaisesRegex(ValueError, "Pending media jobs or Graph runs"):
                        check_startup(self.connection, "live")
                else:
                    check_startup(self.connection, "live")
                self.assertEqual(self.connection.execute.call_count, 2)

    def test_verification_does_not_require_empty_queue(self):
        check_startup(self.connection, "verification")
        self.connection.execute.assert_not_called()

    def test_readonly_uri_rejects_wal_without_opening_sqlite(self):
        db_path = Mock()
        resolved = db_path.resolve.return_value
        resolved.as_uri.return_value = "file:///example/studio.db"
        for version in (b"\x01\x01", b"\x02\x02"):
            with self.subTest(version=version):
                resolved.open.return_value = BytesIO(b"SQLite format 3\x00\x10\x00" + version)
                if version == b"\x01\x01":
                    self.assertEqual(readonly_database_uri(db_path), "file:///example/studio.db?mode=ro")
                else:
                    with self.assertRaisesRegex(ValueError, "WAL is unsupported"):
                        readonly_database_uri(db_path)


if __name__ == "__main__":
    unittest.main()
