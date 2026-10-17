import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = args => spawnSync(process.execPath, ['scripts/test-focused-web.mjs', ...args],
  { cwd: root, encoding: 'utf8', timeout: 150000 });

test('focused runner rejects empty scope, flags, globs and non-web paths before starting Vitest', () => {
  for (const args of [[], ['--watch'], ['apps/web/lib/*.test.ts'], ['apps/api/tests/test_store.py'],
    ['apps/web/lib/../../../scripts/example.test.ts']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /Disposable test cache/);
  }
});

test('focused runner executes only an inspected pure test and removes its cache', () => {
  const result = run(['apps/web/lib/studio-shortcuts.test.ts']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /3 passed/);
  assert.match(result.stdout, /1 passed/);
  const scratch = result.stdout.match(/Disposable test cache: (.+)/)?.[1];
  assert.ok(scratch);
  assert.equal(existsSync(scratch), false);
});
