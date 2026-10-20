"""Static-only Ruff/Radon gate. Dependencies are installed separately."""
import argparse
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import traceback

from policy import Source, compare, digest, normalize_radon, normalize_ruff, unique

ROOT = Path(__file__).resolve().parents[3]
TOOLING = Path('scripts/static-analysis')
EXCLUDED = {'.git', '.venv', 'node_modules', '__pycache__', '.next', 'data', 'build', 'dist', 'test-results'}
SCOPE = ['apps/api', 'scripts', 'tests', '*.py']


def save(output, name, value):
    (output / name).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def source_files(root):
    files = list(root.glob('*.py'))
    for scope in SCOPE[:-1]:
        for directory, dirs, names in os.walk(root / scope, followlinks=False):
            dirs[:] = sorted(name for name in dirs if name not in EXCLUDED and not (Path(directory) / name).is_symlink())
            files.extend(Path(directory) / name for name in names if name.endswith('.py'))
    relative = sorted(file.relative_to(root).as_posix() for file in files)
    if not relative:
        raise ValueError('Empty Python source coverage')
    for file in files:
        if file.is_symlink():
            raise ValueError(f'Symlinked source needs explicit scope review: {file}')
    return relative


def tool(output, name, command, root, allowed=(0,)):
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=120,
                            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    (output / f'{name}.stdout').write_text(result.stdout)
    (output / f'{name}.stderr').write_text(result.stderr)
    save(output, f'{name}.execution.json', dict(command=command, status=result.returncode))
    if result.returncode not in allowed:
        raise ValueError(f'{name} failed with exit {result.returncode}; see raw evidence')
    return result


def contract(root):
    requirements = (root / TOOLING / 'requirements.txt').read_text().splitlines()
    versions = {}
    for requirement in requirements:
        name, expected = requirement.split('==')
        versions[name] = importlib.metadata.version(name)
        if versions[name] != expected:
            raise ValueError(f'{name} version mismatch: expected {expected}, installed {versions[name]}')
    paths = [TOOLING / name for name in ['requirements.txt', 'ruff.toml', 'python.mjs', 'python/gate.py', 'python/policy.py', 'python/radon_functions.py']]
    return dict(versions=versions, scope=SCOPE, excluded=sorted(EXCLUDED),
                files={path.as_posix(): digest((root / path).read_text()) for path in paths})


def validate_mi(report, files):
    if not isinstance(report, dict) or set(report) != set(files):
        raise ValueError('Incomplete or invalid Radon MI coverage')
    for value in report.values():
        number = value.get('mi')
        if not isinstance(number, (int, float)) or not math.isfinite(number):
            raise ValueError('Invalid Radon maintainability metric')


def analyze(root, output):
    files = source_files(root)
    sources = {file: Source((root / file).read_text(encoding='utf-8-sig'), file) for file in files}
    save(output, 'scope.json', dict(files=files, excludes=sorted(EXCLUDED)))
    ruff = [sys.executable, '-m', 'ruff', 'check', '--no-cache', '--no-respect-gitignore',
            '--config', str(TOOLING / 'ruff.toml')]
    coverage = tool(output, 'ruff-files', [*ruff, '--show-files', *files], root)
    actual = {Path(line).resolve().relative_to(root).as_posix() for line in coverage.stdout.splitlines()}
    if actual != set(files):
        raise ValueError('Incomplete Ruff source coverage')
    tool(output, 'ruff-settings', [*ruff, '--show-settings', files[0]], root)
    lint = tool(output, 'ruff', [*ruff, '--ignore-noqa', '--output-format', 'json', *files], root, (0, 1))
    raw_lint = json.loads(lint.stdout)
    findings = normalize_ruff(raw_lint, root, sources)
    if (lint.returncode == 1) != bool(findings):
        raise ValueError('Ruff status and findings disagree')
    cc = tool(output, 'radon-cc', [sys.executable, '-B', str(TOOLING / 'python/radon_functions.py'), *files], root)
    findings.extend(normalize_radon(json.loads(cc.stdout), sources))
    mi = tool(output, 'radon-mi', [sys.executable, '-m', 'radon', 'mi', '--json', *files], root)
    validate_mi(json.loads(mi.stdout), files)
    unique(findings)
    return files, sorted(findings, key=lambda item: item['id'])


def groups(files, findings):
    def is_test(file):
        return '/tests/' in '/' + file or Path(file).name.startswith('test_')
    return {name: dict(files=sum(is_test(file) == flag for file in files),
                       findings=sum(is_test(item['file']) == flag for item in findings))
            for name, flag in [('production', False), ('tests', True)]}


def run(root, output, reason=None):
    metadata = contract(root)
    signature = digest(json.dumps(metadata, sort_keys=True))
    save(output, 'contract.json', metadata)
    files, findings = analyze(root, output)
    save(output, 'findings.json', findings)
    baseline_file = root / TOOLING / 'python-baseline.json'
    if reason:
        if any(item['file'].startswith('scripts/static-analysis/') and
               item['rule'] not in ('ruff/C901', 'radon/CC') for item in findings):
            raise ValueError('Gate correctness findings cannot be baselined')
        save(baseline_file.parent, baseline_file.name,
             dict(schema=1, contract=signature, metadata=metadata, reason=reason, findings=findings))
        print(f'Explicit Python baseline update: {len(findings)} findings; review the diff.')
        return
    regressions = compare(findings, json.loads(baseline_file.read_text()), signature)
    save(output, 'summary.json', dict(passed=not regressions, files=len(files), findings=len(findings),
                                    groups=groups(files, findings), regressions=regressions))
    for item in regressions:
        print(f"{item['file']}:{item['line']} {item['rule']}: {item['message']}", file=sys.stderr)
    if regressions:
        raise ValueError(f'{len(regressions)} new or worsened Python findings')
    print(f'Python gate passed: {len(files)} files, {len(findings)} baseline findings, zero regressions; MI informational.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--update-baseline', nargs='+', help='Explicit review reason')
    args = parser.parse_args()
    parent = os.environ.get('STATIC_ANALYSIS_OUTPUT')
    if parent:
        Path(parent).mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix='media-studio-python-', dir=parent))
    print(f'Python analysis evidence: {output}', flush=True)
    save(output, 'execution.json', dict(python=sys.version, command=sys.argv))
    try:
        run(ROOT, output, ' '.join(args.update_baseline) if args.update_baseline else None)
    except (ValueError, OSError, KeyError, TypeError, SyntaxError, subprocess.SubprocessError, importlib.metadata.PackageNotFoundError):
        error = traceback.format_exc()
        save(output, 'failure.json', dict(passed=False, error=error))
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
