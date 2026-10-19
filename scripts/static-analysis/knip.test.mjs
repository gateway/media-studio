import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'media-studio-knip-fixture-'));
  const sources = {
    'package.json': JSON.stringify({ private: true, workspaces: ['apps/web'], scripts: { 'lint:unused': 'node scripts/static-analysis/knip.mjs' }, devDependencies: { knip: '6.42.0', vitest: '^3.2.7' } }),
    'package-lock.json': '{}',
    'apps/web/package.json': JSON.stringify({ private: true, scripts: { build: 'next build' }, dependencies: { next: '^16.3.3' } }),
    'apps/web/app/page.tsx': 'import { used } from "../lib/used"; export default function Page() { return used(); }',
    'apps/web/lib/used.ts': 'export function used() { return null; }',
    'apps/web/lib/test-only.ts': 'export const testOnly = 42;',
    'apps/web/lib/test-only.test.ts': 'import { testOnly } from "./test-only"; import { test } from "vitest"; test("only", () => testOnly);',
    'apps/web/next.config.ts': 'import { config } from "./lib/config"; export default config;',
    'apps/web/lib/config.ts': 'export const config = {};',
    'scripts/assistant_conversation_probe.mjs': 'import { probe } from "./lib/probe.mjs"; probe();',
    'scripts/lib/probe.mjs': 'export function probe() { return 42; }',
    'scripts/node-only.test.mjs': 'import { value } from "./lib/node-only.mjs"; import assert from "node:assert/strict"; assert.equal(value, 42);',
    'scripts/lib/node-only.mjs': 'export const value = 42;',
  };
  for (const [file, source] of Object.entries(sources)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), source);
  }
  await mkdir(path.join(directory, 'scripts/static-analysis'), { recursive: true });
  for (const file of ['knip.jsonc', 'scripts/static-analysis/knip.mjs']) {
    await copyFile(path.join(root, file), path.join(directory, file));
  }
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  return directory;
}

function run(directory) {
  return spawnSync(process.execPath, ['scripts/static-analysis/knip.mjs'], { cwd: directory,
    env: { ...process.env, STATIC_ANALYSIS_OUTPUT: path.join(directory, 'evidence') },
    encoding: 'utf8', timeout: 120000 });
}

async function latest(directory, name) {
  const runs = await readdir(path.join(directory, 'evidence'));
  const files = await Promise.all(runs.map(async entry => {
    try { return JSON.parse(await readFile(path.join(directory, 'evidence', entry, name), 'utf8')); }
    catch { return null; }
  }));
  return files.filter(Boolean);
}

test('real default scan covers Next routes/configs, operator entries and web/Node tests; candidates remain informational', async () => {
  const directory = await fixture();
  try {
    const clean = run(directory);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const [summary] = await latest(directory, 'summary.json');
    assert.equal(Object.values(summary.counts).reduce((a, b) => a + b, 0), 0, JSON.stringify(await latest(directory, 'knip.json')));
    await writeFile(path.join(directory, 'apps/web/lib/orphan.ts'), 'export const orphan = 1;');
    const findings = run(directory);
    assert.equal(findings.status, 0, findings.stdout + findings.stderr);
    const reports = await latest(directory, 'knip.json');
    assert.ok(reports.some(report => report.issues.some(issue => issue.file === 'apps/web/lib/orphan.ts' && issue.files.length === 1)));
    assert.equal((await latest(directory, 'execution.json')).every(item => item.status === 0), true);
    await writeFile(path.join(directory, 'knip.jsonc'), '{broken');
    const broken = run(directory);
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /Knip execution failed/);
    assert.ok((await latest(directory, 'execution.json')).some(item => item.status === 2));
    assert.equal((await latest(directory, 'summary.json')).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing Knip and malformed successful tool output fail with evidence', async () => {
  const directory = await fixture();
  try {
    await rm(path.join(directory, 'node_modules'));
    assert.equal(run(directory).status, 1);
    assert.equal((await latest(directory, 'failure.json')).length, 1);
    const packageDirectory = path.join(directory, 'node_modules/knip');
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ version: 'fixture', bin: { knip: 'cli.cjs' } }));
    for (const invalid of ['broken', '{}', '{"issues":[{"file":"a.ts"}]}']) {
      await writeFile(path.join(packageDirectory, 'cli.cjs'), `process.stdout.write(${JSON.stringify(invalid)});`);
      assert.equal(run(directory).status, 1);
    }
    assert.equal((await latest(directory, 'failure.json')).length, 4);
    assert.equal((await latest(directory, 'summary.json')).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
