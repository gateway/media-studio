"""CI-only synthetic pytest verification; never imports the application harness."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TimingProfileIntegrationTests(unittest.TestCase):
    def test_real_pytest_pass_failure_and_collection_error(self):
        recorder = Path(__file__).with_name("ci_pytest_profile.py").resolve()
        cases = (
            ("def test_ok(value): assert value == 42\n", 0, ["setup", "call", "teardown"]),
            ("def test_bad(value): assert value == 0\n", 1, ["setup", "call", "teardown"]),
            ("raise ValueError('collection error')\n", 2, []),
        )
        for source, expected_exit, phases in cases:
            with self.subTest(expected_exit=expected_exit), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "conftest.py").write_text(
                    "import pytest\n@pytest.fixture\ndef value():\n    yield 42\n"
                )
                (root / "test_sample.py").write_text(source)
                output = root / "profile.json"
                result = subprocess.run(
                    [sys.executable, str(recorder), str(output), "-q", "-c", os.devnull, str(root)],
                    cwd=root, env={**os.environ, "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1", "PYTEST_ADDOPTS": ""},
                    capture_output=True, text=True, check=False,
                )
                self.assertEqual(result.returncode, expected_exit, result.stdout + result.stderr)
                report = json.loads(output.read_text())
                self.assertEqual(report["exit_code"], expected_exit)
                self.assertIsNotNone(report["initial_conftests_seconds"])
                self.assertIsNotNone(report["collection_seconds"])
                self.assertEqual([phase["phase"] for phase in report["phases"]], phases)
                if phases:
                    self.assertEqual(len(report["collected"]), 1)
                    self.assertEqual([fixture["fixture"] for fixture in report["fixture_setups"]], ["value"])


if __name__ == "__main__":
    unittest.main()
