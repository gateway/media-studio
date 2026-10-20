"""Standalone gate tests; never collects or imports application tests."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from gate import ROOT, TOOLING, tool, validate_mi
from policy import Source, compare, normalize_radon, normalize_ruff, unique


def issue(text, line=1, file='apps/api/example.py', metric=16):
    return Source(text, file).identify(dict(file=file, line=line, column=1, metric=metric,
                                            rule='radon/CC', message='complexity', severity=2))


class PolicyTests(unittest.TestCase):
    def test_identity_and_metric_ratchet(self):
        old = issue('def existing():\n    pass\n')
        baseline = dict(schema=1, contract='same', findings=[old])
        moved = issue('\n# comment\ndef existing():\n    pass\n', line=3)
        self.assertEqual(compare([moved], baseline, 'same'), [])
        for changed in [issue('def renamed():\n    pass\n'),
                        issue('def existing():\n    pass\n', file='new.py'),
                        dict(moved, metric=17)]:
            self.assertEqual(len(compare([changed], baseline, 'same')), 1)
        self.assertEqual(compare([], baseline, 'same'), [])
        with self.assertRaises(ValueError):
            compare([], baseline, 'changed')
        with self.assertRaises(ValueError):
            unique([old, old])

    def test_invalid_and_empty_tool_reports(self):
        source = Source('def present():\n    pass\n', 'example.py')
        with self.assertRaises(ValueError):
            normalize_ruff({}, ROOT, {})
        with self.assertRaises(ValueError):
            normalize_radon({}, {'example.py': source})
        with self.assertRaises(ValueError):
            normalize_radon({'example.py': [{'complexity': 'bad'}]}, {'example.py': source})
        for report in [{}, {'example.py': {'mi': 'bad'}}, {'example.py': {'mi': float('nan')}}]:
            with self.assertRaises(ValueError):
                validate_mi(report, ['example.py'])
        with self.assertRaises(json.JSONDecodeError):
            json.loads('')

    def test_tool_errors_are_not_success(self):
        with tempfile.TemporaryDirectory(prefix='python-tool-test-') as directory:
            output = Path(directory)
            with self.assertRaises(ValueError):
                tool(output, 'failure', [sys.executable, '-c', 'raise SystemExit(2)'], output)
            self.assertEqual(json.loads((output / 'failure.execution.json').read_text())['status'], 2)
            with self.assertRaises(FileNotFoundError):
                tool(output, 'missing', [str(output / 'no-such-binary')], output)
            with patch('gate.subprocess.run', side_effect=subprocess.TimeoutExpired('fixture', 1)):
                with self.assertRaises(subprocess.TimeoutExpired):
                    tool(output, 'timeout', [sys.executable], output)


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix='python-gate-test-')).resolve()
        self.tooling = self.directory / TOOLING
        self.tooling.mkdir(parents=True)
        for name in ['ruff.toml', 'requirements.txt', 'python.mjs']:
            shutil.copy2(ROOT / TOOLING / name, self.tooling / name)
        shutil.copytree(ROOT / TOOLING / 'python', self.tooling / 'python',
                        ignore=shutil.ignore_patterns('test_gate.py', '__pycache__'))
        self.source = self.directory / 'apps/api/example.py'
        self.source.parent.mkdir(parents=True)
        self.source.write_text('raise RuntimeError("Source must never be imported")\n')
        self.evidence = self.directory / 'evidence'

    def tearDown(self):
        if os.environ.get('STATIC_ANALYSIS_OUTPUT') and self.evidence.exists():
            target = Path(os.environ['STATIC_ANALYSIS_OUTPUT']) / self.directory.name
            shutil.copytree(self.evidence, target)
        self.assertEqual(list(self.directory.rglob('*.db')), [])
        shutil.rmtree(self.directory)

    def run_gate(self, args=(), expected=0, no_packages=False):
        command = [sys.executable, '-B']
        if no_packages:
            command.append('-S')
        command.extend([str(self.tooling / 'python/gate.py'), *args])
        result = subprocess.run(command, cwd=self.directory, text=True, capture_output=True,
                                timeout=120, env={**os.environ, 'STATIC_ANALYSIS_OUTPUT': str(self.evidence)})
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def baseline(self):
        self.run_gate(['--update-baseline', 'Disposable acceptance fixture'])
        return (self.tooling / 'python-baseline.json').read_bytes()

    def test_correctness_replacement_and_failures(self):
        self.source.write_text('import os\nraise RuntimeError("Never import application source")\n')
        saved = self.baseline()
        self.run_gate()
        self.source.write_text('import sys\nraise RuntimeError("Never import application source")\n')
        self.assertIn('ruff/F401', self.run_gate(expected=1).stderr)
        self.source.write_text('import os\nraise RuntimeError("Never import application source")\n')
        self.assertIn('PackageNotFoundError', self.run_gate(expected=1, no_packages=True).stderr)
        config = self.tooling / 'ruff.toml'
        original = config.read_text()
        config.write_bytes(original.replace('\n', '\r\n').encode())
        self.run_gate()
        config.write_text(original + '\n# changed config\n')
        self.assertIn('mismatch', self.run_gate(expected=1).stderr)
        config.write_text('invalid TOML = [')
        self.run_gate(expected=1)
        config.write_text(original)
        self.source.write_text('def invalid(:\n')
        self.run_gate(expected=1)
        self.assertEqual((self.tooling / 'python-baseline.json').read_bytes(), saved)

    def test_complexity_line_shift_rename_and_new_file(self):
        def code(count):
            branches = ''.join(f'    if value == {number}:\n        return {number}\n' for number in range(count))
            return 'def existing(value):\n' + branches + '    return -1\n'
        self.source.write_text(code(7))  # CC 8 is allowed.
        self.baseline()
        self.source.write_text(code(8))  # CC 9 must fail.
        failed = self.run_gate(expected=1)
        self.assertIn('ruff/C901', failed.stderr)
        self.assertIn('radon/CC', failed.stderr)
        self.baseline()
        self.source.write_text('\n# moved down\n' + code(8))
        self.run_gate()
        self.source.write_text(code(9))
        self.run_gate(expected=1)
        self.source.write_text(code(8).replace('existing', 'renamed'))
        self.run_gate(expected=1)
        self.source.write_text(code(8))
        (self.source.parent / 'new.py').write_text(code(8))
        self.run_gate(expected=1)
        (self.source.parent / 'new.py').unlink()
        nested = 'def outer():\n    class Inner:\n' + ''.join('        ' + line + '\n' for line in code(8).splitlines())
        self.source.write_text(nested)
        self.assertIn('radon/CC', self.run_gate(expected=1).stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
