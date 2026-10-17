import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const helpers = ['toControlApiProxyPath', 'toControlApiDataProxyPath', 'toControlApiDataPreviewPath'];
const helperSource = helpers.map(name => `export function ${name}() {}`).join('\n');

async function fixture(t, files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'custom-web-lint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'));
  await copyFile(new URL('../lint_web.mjs', import.meta.url), path.join(root, 'scripts/lint_web.mjs'));
  for (const [file, source] of Object.entries({ 'lib/media-paths.ts': helperSource, ...files })) {
    const target = path.join(root, 'apps/web', file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  return () => spawnSync(process.execPath, ['scripts/lint_web.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
  });
}

test('reports every consecutive match and every match after a clean file', async t => {
  const files = {
    '01-first.ts': 'console.log("first"); debugger;',
    '02-second.tsx': 'console.log("next"); debugger;',
    '03-clean.ts': 'export const clean = true;',
    '04-third.mjs': 'console.debug("third"); debugger;',
    '05-fourth.ts': 'console.info("last"); debugger;',
  };
  const run = await fixture(t, files);
  const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const failures = result.stderr.split('\n').filter(line => line.startsWith('- ')).sort();
  const expected = Object.keys(files).filter(file => file !== '03-clean.ts').flatMap(file => [
    `- apps/web/${file}: found console log/debug/info`,
    `- apps/web/${file}: found debugger statement`,
  ]).sort();
  assert.deepEqual(failures, expected);
});

test('clean sources pass and excluded extensions and directories stay excluded', async t => {
  const run = await fixture(t, {
    'view.tsx': 'console.warn("allowed"); console.error("allowed");',
    'ignored.js': 'console.log("ignored"); debugger;',
    'node_modules/dependency/index.ts': 'console.log("ignored"); debugger;',
    '.next/generated.ts': 'console.log("ignored"); debugger;',
  });
  const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'Web lint passed for 2 files.');
});

test('missing and duplicate singleton helpers still fail', async t => {
  for (const files of [{ 'lib/media-paths.ts': '' }, { 'duplicate.ts': helperSource }]) {
    const run = await fixture(t, files);
    const result = run();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    const failures = result.stderr.split('\n').filter(line => line.startsWith('- '));
    assert.equal(failures.length, helpers.length);
    for (const name of helpers) {
      assert.ok(failures.some(line => line.startsWith(`- ${name}: expected a single definition`)));
    }
  }
});
