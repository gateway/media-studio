import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cloneEndpoint, cloneFinding, compareClones, validateClones, validateGraph } from './full-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sample = `export function calculate(input: number[]) {
  const values = input.filter(value => value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const count = values.length;
  const average = count ? total / count : 0;
  const maximum = Math.max(...values);
  const minimum = Math.min(...values);
  const spread = maximum - minimum;
  return { total, count, average, maximum, minimum, spread };
}
`;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'full-gate-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const folder of ['scripts/static-analysis', 'apps/web', 'tests']) await mkdir(path.join(directory, folder), { recursive: true });
  const files = ['dependency-cruiser.config.cjs', 'jscpd.config.json', 'package-lock.json',
    ...['full.mjs', 'full-policy.mjs', 'full-scan.mjs', 'changed.mjs'].map(file => `scripts/static-analysis/${file}`)];
  await Promise.all(files.map(file => copyFile(path.join(root, file), path.join(directory, file))));
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  await writeFile(path.join(directory, 'apps/web/tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler' }, include: ['*.ts'] }));
  await writeFile(path.join(directory, 'apps/web/a.ts'), sample);
  await writeFile(path.join(directory, 'tests/check.test.ts'), 'export const fixtureTest = true;');
  return directory;
}

function run(directory, args = []) {
  return spawnSync(process.execPath, ['scripts/static-analysis/full.mjs', ...args], {
    cwd: directory, encoding: 'utf8', timeout: 180000,
  });
}

function passing(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }

test('real full gate catches cross-file clones, renames, replacements and type-only cycles', async t => {
  const directory = await fixture(t);
  const a = path.join(directory, 'apps/web/a.ts');
  const b = path.join(directory, 'apps/web/b.ts');
  passing(run(directory, ['--update-baseline', 'Clean fixture']));
  passing(run(directory));
  await writeFile(b, sample);
  const cloned = run(directory);
  assert.equal(cloned.status, 1);
  assert.match(cloned.stderr, /production clone pairs/);
  passing(run(directory, ['--update-baseline', 'Reviewed fixture clone pair']));
  const baseline = await readFile(path.join(directory, 'scripts/static-analysis/full-baseline.json'), 'utf8');
  await writeFile(a, '\n\n' + sample);
  passing(run(directory));
  await rm(b);
  await writeFile(path.join(directory, 'apps/web/c.ts'), sample);
  assert.match(run(directory).stderr, /production clone pairs/);
  assert.equal(await readFile(path.join(directory, 'scripts/static-analysis/full-baseline.json'), 'utf8'), baseline);
  await rm(path.join(directory, 'apps/web/c.ts'));
  await writeFile(a, "import type { B } from './b';\nexport type A = { other: B };\n");
  await writeFile(b, "import type { A } from './a';\nexport type B = { other: A };\n");
  assert.match(run(directory).stderr, /no-circular/);
  await writeFile(b, 'export type B = string;');
  passing(run(directory));
  await writeFile(a, "import 'server-only';\nexport const marker = true;\n");
  passing(run(directory));
  await writeFile(a, "import './missing';\n");
  assert.match(run(directory).stderr, /no-unresolved/);
  await writeFile(a, "import '../../tests/check.test';\n");
  assert.match(run(directory).stderr, /no-runtime-imports-of-tests/);
});

test('invalid reports, coverage, ambiguity and baseline drift fail closed', () => {
  for (const report of [{}, { modules: [], summary: { violations: [] } }]) assert.throws(() => validateGraph(report, ['a.ts']));
  for (const report of [{}, { duplicates: [], statistics: { total: { sources: 0, clones: 0 } } }]) assert.throws(() => validateClones(report, 1));
  const file = '/fixture/a.ts';
  const endpoint = cloneEndpoint('/fixture', { name: file, start: 1, end: 2 }, ['a.ts'], 'one\ntwo\nend');
  const finding = cloneFinding({ fragment: 'one\ntwo', tokens: 50, lines: 5, format: 'typescript' }, [endpoint, { ...endpoint, file: 'b.ts' }]);
  const baseline = { schema: 1, contract: 'x', findings: [finding] };
  assert.equal(compareClones([finding], baseline, 'x').length, 0);
  assert.throws(() => compareClones([finding], baseline, 'changed'));
  assert.throws(() => compareClones([finding, finding], baseline, 'x'), /Ambiguous/);
  assert.equal(compareClones([{ ...finding, id: 'replacement' }], baseline, 'x').length, 1);
});

test('missing analyzers and unknown merge bases cannot yield a passing skipped scan', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'jscpd.config.json'), '{ invalid');
  assert.equal(run(directory).status, 1);
  await rm(path.join(directory, 'node_modules'));
  assert.equal(run(directory).status, 1);
  const changed = spawnSync(process.execPath, ['scripts/static-analysis/changed.mjs', '--base', 'missing-audit-base'], { cwd: directory, encoding: 'utf8' });
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /Cannot verify merge base/);
});
