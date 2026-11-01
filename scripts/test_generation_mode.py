"""Database-free tests of the real runner method; isolate service and persistence boundaries."""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock

APP = Path(__file__).resolve().parents[1] / "apps/api/app"
PACKAGE = "generation_mode_unit"
package = ModuleType(PACKAGE)
package.__path__ = [str(APP)]
sys.modules[PACKAGE] = package
for name in ("kie_adapter", "service", "store", "settings"):
    sys.modules[f"{PACKAGE}.{name}"] = ModuleType(f"{PACKAGE}.{name}")
settings = SimpleNamespace(kie_api_key="test-only", media_enable_live_submit=False)
sys.modules[f"{PACKAGE}.settings"].settings = settings
store = sys.modules[f"{PACKAGE}.store"]
store.has_pending_generation = Mock(return_value=False)
spec = importlib.util.spec_from_file_location(f"{PACKAGE}.runner", APP / "runner.py")
runner_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner_module)


class GenerationModeTests(unittest.TestCase):
    def setUp(self):
        settings.kie_api_key = "test-only"
        settings.media_enable_live_submit = False
        store.has_pending_generation.reset_mock(return_value=True)
        store.has_pending_generation.return_value = False
        self.runner = runner_module.MediaRunner()

    def test_enabling_idle_runner_changes_shared_settings_without_submitting(self):
        self.runner.tick = Mock()
        self.runner.enable_live_submission()
        self.assertTrue(settings.media_enable_live_submit)
        self.runner.tick.assert_not_called()

    def test_pending_work_stays_in_simulation(self):
        store.has_pending_generation.return_value = True
        with self.assertRaisesRegex(ValueError, "pending jobs"):
            self.runner.enable_live_submission()
        self.assertFalse(settings.media_enable_live_submit)

    def test_missing_key_stays_in_simulation(self):
        settings.kie_api_key = None
        with self.assertRaisesRegex(ValueError, "KIE API key"):
            self.runner.enable_live_submission()
        self.assertFalse(settings.media_enable_live_submit)

    def test_repeated_enable_is_idempotent_even_with_pending_work(self):
        settings.media_enable_live_submit = True
        store.has_pending_generation.return_value = True
        self.runner.enable_live_submission()
        store.has_pending_generation.assert_not_called()
        self.assertTrue(settings.media_enable_live_submit)


if __name__ == "__main__":
    unittest.main()
