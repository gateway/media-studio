"""Exercise standalone unit bytecode policy without pytest or application imports."""
import builtins
import runpy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULES = (
    'assistant_communication', 'assistant_continuity_edits', 'assistant_display_latency',
    'assistant_failure', 'assistant_planning_recovery', 'assistant_results',
    'assistant_run_handoff', 'assistant_width_layout', 'captioned_storyboard',
    'generation_contract', 'generation_inspection', 'recipe_discovery', 'storyboard_image_edit',
    'storyboard_reference_sections',
)
TESTS = Path(__file__).resolve().parents[1] / 'apps/api/tests'


class ApplicationImportDenied(Exception):
    pass


class BytecodePolicyTests(unittest.TestCase):
    def load_case(self, name):
        # run_path executes only stdlib imports and class definitions, never __main__.
        with patch.object(sys, 'path', sys.path.copy()):
            namespace = runpy.run_path(str(TESTS / f'test_{name}_unit.py'))
        return next(value for value in namespace.values()
                    if isinstance(value, type) and issubclass(value, unittest.TestCase))

    def test_collection_preserves_incoming_policy(self):
        for incoming in (False, True):
            for name in MODULES:
                with self.subTest(incoming=incoming, module=name):
                    with patch.object(sys, 'dont_write_bytecode', incoming):
                        self.load_case(name)
                        self.assertIs(sys.dont_write_bytecode, incoming)

    def test_case_restores_policy_after_each_failure_phase(self):
        for incoming in (False, True):
            for name in MODULES:
                for failure in (None, 'setup', 'test', 'teardown', 'cleanup'):
                    with self.subTest(incoming=incoming, module=name, failure=failure):
                        self.check_case(name, incoming, failure)

    def check_case(self, name, incoming, failure):
        case = self.load_case(name)
        observed = []
        real_import = builtins.__import__

        def deny_application(name, *args, **kwargs):
            if name == 'app' or name.startswith('app.'):
                self.assertIs(sys.dont_write_bytecode, True)
                raise ApplicationImportDenied(name)
            return real_import(name, *args, **kwargs)

        def phase(label):
            self.assertIs(sys.dont_write_bytecode, True)
            observed.append(label)
            if failure == label:
                raise RuntimeError(label)

        class Probe(case):
            def setUp(self):
                # Exercise the real setup entry, stopping before any application code.
                with patch('builtins.__import__', side_effect=deny_application):
                    try:
                        super().setUp()
                    except ApplicationImportDenied:
                        pass
                self.addCleanup(phase, 'cleanup')
                phase('setup')

            def probe(self):
                phase('test')

            def tearDown(self):
                phase('teardown')

        with patch.object(sys, 'dont_write_bytecode', incoming):
            result = unittest.TestResult()
            Probe('probe').run(result)
            self.assertIs(sys.dont_write_bytecode, incoming)
        self.assertEqual(len(result.errors), int(failure is not None), result.errors)
        self.assertEqual(result.failures, [])
        self.assertEqual(observed, ['setup', 'cleanup'] if failure == 'setup'
                         else ['setup', 'test', 'teardown', 'cleanup'])


if __name__ == '__main__':
    unittest.main()
