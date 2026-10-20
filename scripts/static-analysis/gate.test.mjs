import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compare, fingerprint, validateReport, uniqueFindings, groupSummary } from './policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const report = { rule: 'complexity', message: 'Function complexity of 16', line: 1, column: 1, severity: 1, metric: 16 };
const identify = (text, overrides = {}, file = 'apps/web/example.ts') => fingerprint(file, text, { ...report, ...overrides });
const baseline = (findings) => ({ schema: 1, contract: 'same', findings });

test('production and test metrics are reported separately', () => {
  const files = ['apps/web/view.tsx', 'apps/web/view.test.tsx', 'scripts/test_demo.mjs', 'ops/ecosystem.config.cjs'];
  const findings = files.map((file) => ({ file, rule: 'complexity' }));
  const groups = groupSummary(files, findings);
  assert.deepEqual(groups.production, { eslintFiles: 2, findings: 2, complexityFindings: 2 });
  assert.deepEqual(groups.tests, { eslintFiles: 2, findings: 2, complexityFindings: 2 });
});

test('line shifts preserve identities; metrics cannot worsen', () => {
  const before = identify('function existing() {}');
  const moved = identify('\n// comment\nfunction existing() {}', { line: 3 });
  assert.deepEqual(compare([moved], baseline([before]), 'same'), []);
  assert.equal(compare([{ ...moved, metric: 17 }], baseline([before]), 'same').length, 1);
  assert.deepEqual(compare([{ ...moved, metric: 15 }], baseline([before]), 'same'), []);
});

test('new files, renames, and replacement violations do not inherit exemptions', () => {
  const before = identify('function existing() {}');
  for (const replacement of [identify('function renamed() {}'), identify('function existing() {}', {}, 'apps/web/new.ts')]) {
    assert.equal(compare([replacement], baseline([before]), 'same').length, 1);
  }
  assert.deepEqual(compare([], baseline([before]), 'same'), []);
});

test('correctness identities tolerate line shifts but not a replacement declaration', () => {
  const issue = { rule: '@typescript-eslint/no-unused-vars', message: "'unused' is defined but never used.", column: 7, metric: undefined };
  const before = identify('const unused = 1;', issue);
  const shifted = identify('\nconst unused = 1;', { ...issue, line: 2 });
  const different = identify('const other = 1;', { ...issue, message: "'other' is defined but never used." });
  assert.deepEqual(compare([shifted], baseline([before]), 'same'), []);
  assert.equal(compare([different], baseline([before]), 'same').length, 1);
});

test('invalid output, ambiguity and tool/config drift fail closed', () => {
  for (const invalid of [null, {}, { files: [], findings: [] }, { files: ['a'], findings: [{}] }]) {
    assert.throws(() => validateReport(invalid));
  }
  const finding = identify('function existing() {}');
  assert.throws(() => uniqueFindings([finding, finding]), /Ambiguous/);
  assert.throws(() => compare([], baseline([]), 'changed'), /mismatch/);
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'static-gate-test-'));
  await mkdir(path.join(directory, 'apps/web'), { recursive: true });
  await mkdir(path.join(directory, 'ops'));
  await writeFile(path.join(directory, 'ops/example.cjs'), 'module.exports = {};\n');
  await cp(path.join(root, 'scripts/static-analysis'), path.join(directory, 'scripts/static-analysis'), {
    recursive: true, filter: (file) => !file.endsWith('baseline.json') && !file.endsWith('.test.mjs'),
  });
  for (const file of ['eslint.config.mjs', 'package-lock.json']) await cp(path.join(root, file), path.join(directory, file));
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  await writeFile(path.join(directory, 'apps/web/tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'bundler', module: 'esnext' }, include: ['*.ts', '*.tsx'] }));
  await cp(path.join(root, 'apps/web/tsconfig.lint.json'), path.join(directory, 'apps/web/tsconfig.lint.json'));
  await writeFile(path.join(directory, 'scripts/lint_web.mjs'), 'process.exit(0);\n');
  return directory;
}

function run(directory, args = []) {
  return spawnSync(process.execPath, ['scripts/static-analysis/gate.mjs', ...args], {
    cwd: directory, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, STATIC_ANALYSIS_OUTPUT: path.join(directory, 'evidence') },
  });
}

function expectStatus(result, expected) {
  assert.equal(result.status, expected, result.stdout + result.stderr);
}

async function cleanupFixture(directory) {
  if (process.env.STATIC_ANALYSIS_OUTPUT) {
    await cp(path.join(directory, 'evidence'), path.join(process.env.STATIC_ANALYSIS_OUTPUT, path.basename(directory)), { recursive: true });
  }
  await rm(directory, { recursive: true, force: true });
}

test('real analyzers and CLI reject regressions and failures without changing baseline', { timeout: 180000 }, async () => {
  const directory = await fixture();
  const source = path.join(directory, 'apps/web/example.ts');
  const baselineFile = path.join(directory, 'scripts/static-analysis/baseline.json');
  try {
    await writeFile(source, 'export const value: number = 1;\n');
    expectStatus(run(directory, ['--update-baseline', 'Disposable acceptance fixture']), 0);
    const savedBaseline = await readFile(baselineFile, 'utf8');
    assert.ok(JSON.parse(savedBaseline).findings.some((finding) =>
      finding.file.startsWith('scripts/static-analysis/') && finding.rule === 'complexity'));
    const brokenTool = path.join(directory, 'scripts/static-analysis/broken.mjs');
    await writeFile(brokenTool, 'export const value = missingToolValue;\n');
    const rejected = run(directory, ['--update-baseline', 'Must reject tooling correctness']);
    expectStatus(rejected, 1);
    assert.match(rejected.stderr, /Gate correctness findings cannot be baselined/);
    assert.equal(await readFile(baselineFile, 'utf8'), savedBaseline);
    await rm(brokenTool);
    expectStatus(run(directory), 0);
    await writeFile(path.join(directory, 'ops/example.cjs'), 'module.exports = missingConfiguration;\n');
    const operational = run(directory);
    assert.match(operational.stderr, /no-undef/);
    expectStatus(operational, 1);
    await writeFile(path.join(directory, 'ops/example.cjs'), 'module.exports = {};\n');
    await writeFile(source, 'export const value: number = "wrong";\n');
    expectStatus(run(directory), 1);
    await writeFile(source, 'export function bad() { debugger; }\n');
    expectStatus(run(directory), 1);
    await writeFile(source, `export function complex(n: number) { ${Array.from({ length: 21 }, (_, i) => `if (n === ${i}) return ${i};`).join(' ')} return -1; }\n`);
    const complexity = run(directory);
    expectStatus(complexity, 1);
    assert.match(complexity.stderr, /complexity/);
    assert.match(complexity.stderr, /cognitive-complexity/);
    await writeFile(source, 'export const value: number = 1;\n');
    const lock = path.join(directory, 'package-lock.json');
    const savedLock = await readFile(lock, 'utf8');
    await writeFile(lock, savedLock.replaceAll('\n', '\r\n'));
    expectStatus(run(directory), 0);
    await writeFile(lock, savedLock + '\n');
    const mismatch = run(directory);
    expectStatus(mismatch, 1);
    assert.match(mismatch.stderr, /configuration\/version\/scope mismatch/);
    await writeFile(lock, savedLock);
    await writeFile(path.join(directory, 'scripts/lint_web.mjs'), 'process.exit(2);\n');
    expectStatus(run(directory), 1);
    await writeFile(path.join(directory, 'scripts/lint_web.mjs'), 'process.exit(0);\n');
    await writeFile(path.join(directory, 'eslint.config.mjs'), 'throw new Error("invalid config");\n');
    expectStatus(run(directory), 1);
    await rm(path.join(directory, 'node_modules'));
    const missing = run(directory);
    expectStatus(missing, 1);
    assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.equal(await readFile(baselineFile, 'utf8'), savedBaseline);
  } finally {
    await cleanupFixture(directory);
  }
});

test('real complexity baseline tolerates line shifts and rejects worsening or renames', { timeout: 120000 }, async () => {
  const directory = await fixture();
  const source = path.join(directory, 'apps/web/example.ts');
  const code = (count) => `export function existing(n: number) { ${Array.from({ length: count }, (_, i) => `if (n === ${i}) return ${i};`).join(' ')} return -1; }\n`;
  try {
    await writeFile(source, code(7)); // Cyclomatic 8 is allowed.
    expectStatus(run(directory, ['--update-baseline', 'At cyclomatic limit']), 0);
    await writeFile(source, code(8));
    const cyclomatic = run(directory);
    expectStatus(cyclomatic, 1);
    assert.match(cyclomatic.stderr, /complexity/);
    await writeFile(source, code(12)); // Cognitive 12 is allowed; baseline cyclomatic debt.
    expectStatus(run(directory, ['--update-baseline', 'At cognitive limit']), 0);
    await writeFile(source, code(13));
    const cognitive = run(directory);
    expectStatus(cognitive, 1);
    assert.match(cognitive.stderr, /sonarjs\/cognitive-complexity/);
    await writeFile(source, code(21));
    expectStatus(run(directory, ['--update-baseline', 'Existing complex fixture']), 0);
    await writeFile(source, '\n// Moved down\n' + code(21));
    expectStatus(run(directory), 0);
    await writeFile(source, code(22));
    expectStatus(run(directory), 1);
    await writeFile(source, code(21).replace('existing', 'renamed'));
    expectStatus(run(directory), 1);
    await writeFile(source, code(21));
    await cp(source, path.join(directory, 'apps/web/new-file.ts'));
    expectStatus(run(directory), 1);
  } finally {
    await cleanupFixture(directory);
  }
});

test('React, promise, exhaustive switch and array rules reject real regressions', { timeout: 180000 }, async () => {
  const directory = await fixture();
  const source = path.join(directory, 'apps/web/example.tsx');
  const cases = [
    ['react-hooks/rules-of-hooks', 'import { useState } from "react"; export function Example({on}: {on: boolean}) { if (on) useState(0); return null; }'],
    ['react-hooks/exhaustive-deps', 'import { useEffect } from "react"; export function Example({value}: {value: string}) { useEffect(() => { document.title = value; }, []); return null; }'],
    ['@typescript-eslint/no-floating-promises', 'export function example() { void Promise.resolve(1); }'],
    ['@typescript-eslint/no-misused-promises', 'export function example() { [1].forEach(async () => { await Promise.resolve(); }); }'],
    ['@typescript-eslint/switch-exhaustiveness-check', 'export function example(value: "a" | "b") { switch(value) { case "a": return 1; } }'],
    ['array-callback-return', 'export const example = [1].map(() => { });'],
  ];
  try {
    await writeFile(source, 'export const value = 1;\n');
    expectStatus(run(directory, ['--update-baseline', 'Clean rule fixtures']), 0);
    for (const [rule, code] of cases) {
      await writeFile(source, code);
      const result = run(directory);
      expectStatus(result, 1);
      assert.ok(result.stderr.includes(rule), result.stdout + result.stderr);
    }
    await writeFile(source, 'export function example() { return Promise.resolve(1); }');
    expectStatus(run(directory), 0);
  } finally {
    await cleanupFixture(directory);
  }
});
