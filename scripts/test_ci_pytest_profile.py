"""Pure hook tests: no pytest invocation, application imports or databases."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from ci_pytest_profile import TimingProfile, main


class TimingProfileTests(unittest.TestCase):
    def test_records_complete_phase_identity_and_fixture_scope(self):
        profile = TimingProfile()
        profile.pytest_collection_finish(SimpleNamespace(items=[SimpleNamespace(nodeid="test_a.py::test_a")]))
        for phase, duration in (("setup", 3), ("call", 2), ("teardown", 1)):
            profile.pytest_runtest_logreport(SimpleNamespace(
                nodeid="test_a.py::test_a", when=phase, outcome="passed", duration=duration,
            ))
        fixture = SimpleNamespace(argname="app_modules", scope="function")
        request = SimpleNamespace(node=SimpleNamespace(nodeid="test_a.py::test_a"))
        with patch("ci_pytest_profile.perf_counter", side_effect=[10, 13]):
            hook = profile.pytest_fixture_setup(fixture, request)
            next(hook)
            with self.assertRaises(StopIteration):
                hook.send("fixture value")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "profile.json"
            profile.write(output, 1)
            report = json.loads(output.read_text())
        self.assertEqual(report["exit_code"], 1)
        self.assertEqual(report["collected"], ["test_a.py::test_a"])
        self.assertEqual(report["phase_seconds"], {"setup": 3, "call": 2, "teardown": 1})
        self.assertEqual(len(report["phases"]), 3)
        self.assertEqual(report["fixture_setups"], [{
            "nodeid": "test_a.py::test_a", "fixture": "app_modules", "scope": "function", "seconds": 3,
        }])
        self.assertEqual(len(report["sampled_setup_profiles"]), 1)

    def test_collection_hooks_preserve_results_and_errors(self):
        profile = TimingProfile()
        with patch("ci_pytest_profile.perf_counter", side_effect=[10, 12, 20, 25]):
            hook = profile.pytest_load_initial_conftests()
            next(hook)
            with self.assertRaises(StopIteration) as result:
                hook.send("original result")
            self.assertEqual(result.exception.value, "original result")
            hook = profile.pytest_collection()
            next(hook)
            with self.assertRaisesRegex(ValueError, "collection failed"):
                hook.throw(ValueError("collection failed"))
        self.assertEqual(profile.initial_conftests_seconds, 2)
        self.assertEqual(profile.collection_seconds, 5)

    def test_expensive_setup_profile_is_capped_and_stops_on_failure(self):
        profile = TimingProfile()
        fixture = SimpleNamespace(argname="app_modules", scope="function")
        request = SimpleNamespace(node=SimpleNamespace(nodeid="test_a.py::test_a"))
        with patch("ci_pytest_profile.cProfile.Profile") as create:
            for _ in range(5):
                hook = profile.pytest_fixture_setup(fixture, request)
                next(hook)
                with self.assertRaisesRegex(ValueError, "setup failed"):
                    hook.throw(ValueError("setup failed"))
            self.assertEqual(create.call_count, 3)
            self.assertEqual(create.return_value.enable.call_count, 3)
            self.assertEqual(create.return_value.disable.call_count, 3)
        self.assertEqual(len(profile.fixtures), 5)

    def test_main_preserves_nonzero_exit_and_writes_on_unexpected_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "profile.json"
            with patch("sys.argv", ["profile", str(output), "-q", "tests"]):
                with patch("ci_pytest_profile.pytest.main", return_value=1) as run:
                    self.assertEqual(main(), 1)
                    self.assertEqual(run.call_args.args, (["-q", "tests"],))
                self.assertEqual(json.loads(output.read_text())["exit_code"], 1)
                with (
                    patch("ci_pytest_profile.pytest.main", side_effect=RuntimeError("failed")),
                    self.assertRaisesRegex(RuntimeError, "failed"),
                ):
                    main()
                self.assertEqual(json.loads(output.read_text())["exit_code"], 3)


if __name__ == "__main__":
    unittest.main()
