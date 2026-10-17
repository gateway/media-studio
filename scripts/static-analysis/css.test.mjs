import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReport, cssFindings, regressions } from './css-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.STATIC_ANALYSIS_PYTHON || path.join(root, '.venv/static-analysis', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

test('Stylelint JSON accepts either stream and rejects missing or malformed reports', () => {
  const report = [{ source: 'a.css', warnings: [], parseErrors: [], invalidOptionWarnings: [] }];
  assert.deepEqual(parseReport(JSON.stringify(report), ''), report);
  assert.deepEqual(parseReport('', JSON.stringify(report)), report);
  for (const invalid of ['', '[]', '{}', '[{}]', 'broken']) assert.throws(() => parseReport(invalid, ''), /invalid/);
});

test('CSS baseline follows declaration context, preserving line shifts but rejecting new occurrences', () => {
  const warning = { rule: 'color-hex-length', line: 2, column: 10, text: 'Expected short hex', severity: 'error' };
  const source = '.old {\n  color: #ffffff;\n}\n';
  const findings = cssFindings('a.css', source, [warning]);
  const baseline = { schema: 1, contract: 'same', findings };
  const shifted = cssFindings('a.css', '\n' + source, [{ ...warning, line: 3 }]);
  assert.equal(regressions(shifted, baseline, 'same').length, 0);
  assert.throws(() => regressions([...findings, ...findings], baseline, 'same'), /Ambiguous/);
  const renamed = cssFindings('a.css', source.replace('.old', '.new'), [warning]);
  assert.equal(regressions(renamed, baseline, 'same').length, 1);
  assert.throws(() => regressions(findings, baseline, 'changed'), /contract/);
  const first = '.same {\n color: #ffffff;\n background: red;\n}\n.same {\n color: #fff;\n background: blue;\n}\n';
  const second = first.replace('color: #ffffff;', 'color: #fff;').replace('color: #fff;\n background: blue;', 'color: #ffffff;\n background: blue;');
  const old = cssFindings('a.css', first, [{ ...warning, column: 9 }]);
  const moved = cssFindings('a.css', second, [{ ...warning, line: 6, column: 9 }]);
  assert.equal(regressions(moved, { ...baseline, findings: old }, 'same').length, 1);
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'media-studio-css-fixture-'));
  await mkdir(path.join(directory, 'scripts/static-analysis'), { recursive: true });
  await mkdir(path.join(directory, 'apps/web/app'), { recursive: true });
  const files = ['stylelint.config.mjs', 'package-lock.json', 'scripts/check_style_drift.py',
    'scripts/static-analysis/css.mjs', 'scripts/static-analysis/css-policy.mjs'];
  await Promise.all(files.map((file) => copyFile(path.join(root, file), path.join(directory, file))));
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  const git = spawnSync('git', ['init', '-q', directory], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  return directory;
}

function run(directory, args = []) {
  return spawnSync(process.execPath, ['scripts/static-analysis/css.mjs', ...args], {
    cwd: directory, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, STATIC_ANALYSIS_PYTHON: python },
  });
}

async function checkReplacement(directory, file) {
  const original = '@media (width >= 1px) {\n  .same {\n    color: #ffffff;\n    background: red;\n  }\n}\n\n@media (width >= 1px) {\n  .same {\n    color: #fff;\n    background: blue;\n  }\n}\n';
  await writeFile(file, original);
  const initial = run(directory, ['--update-baseline', 'Reviewed fixture hex notation']);
  assert.equal(initial.status, 0, initial.stdout + initial.stderr);
  const replacement = original.replace('color: #ffffff;', 'color: #fff;').replace('color: #fff;\n    background: blue;', 'color: #ffffff;\n    background: blue;');
  await writeFile(file, replacement);
  const result = run(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /color-hex-length/);
}

test('real focused gate accepts Tailwind/tokens and rejects new CSS and theme violations', async () => {
  const directory = await fixture();
  const file = path.join(directory, 'apps/web/app/globals.css');
  const valid = '@import "tailwindcss";\n\n@theme {\n  --color-brand: #abc;\n}\n\n.button {\n  @apply flex;\n\n  color: var(--color-brand);\n}\n';
  try {
    const specificity = '.a .b {\n  color: red;\n}\n\n.b {\n  color: blue;\n}\n';
    await writeFile(file, specificity);
    assert.equal(run(directory, ['--update-baseline', 'Reviewed fixture specificity debt']).status, 0);
    const historical = JSON.parse(await readFile(path.join(directory, 'scripts/static-analysis/css-baseline.json'), 'utf8'));
    assert.ok(historical.findings.some((item) => item.rule === 'no-descending-specificity'));
    await writeFile(file, '\n\n' + specificity);
    const shifted = run(directory);
    assert.equal(shifted.status, 0, shifted.stdout + shifted.stderr);
    await checkReplacement(directory, file);
    await writeFile(file, valid);
    const initial = run(directory, ['--update-baseline', 'Fixture adoption']);
    assert.equal(initial.status, 0, initial.stdout + initial.stderr);
    const baseline = await readFile(path.join(directory, 'scripts/static-analysis/css-baseline.json'), 'utf8');
    assert.equal(JSON.parse(baseline).findings.length, 0);
    assert.equal(run(directory).status, 0);
    await writeFile(file, valid + '\n/* stylelint-disable */\n.bad {\n  colro: red;\n}\n');
    const invalid = run(directory);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /property-no-unknown/);
    assert.equal(run(directory, ['--update-baseline', 'Must reject unknown properties']).status, 1);
    await writeFile(file, '.broken {');
    assert.equal(run(directory).status, 1);
    await writeFile(file, valid);
    await writeFile(path.join(directory, 'apps/web/app/drift.css'), '.drift {\n' + Array.from({ length: 221 }, (_, i) => `  --shade-${i}: #abc;`).join('\n') + '\n}\n');
    const drift = run(directory);
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /theme-drift guard failed/);
    assert.equal(await readFile(path.join(directory, 'scripts/static-analysis/css-baseline.json'), 'utf8'), baseline);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
