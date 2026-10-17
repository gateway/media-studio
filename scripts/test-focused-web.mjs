import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'apps/web');

async function selectedFiles(args) {
  if (!args.length) throw new Error('Supply explicit apps/web/...test.ts or .test.tsx paths after --; inspect their imports before running.');
  return Promise.all(args.map(async file => {
    if (!/^apps\/web\/(lib|hooks|components)\/[\w./-]+\.test\.tsx?$/.test(file)) {
      throw new Error(`Not a supported explicit web test path: ${file}`);
    }
    const resolved = await realpath(path.resolve(root, file));
    const relative = path.relative(web, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) {
      throw new Error(`Test must resolve inside apps/web: ${file}`);
    }
    return relative.split(path.sep).join('/');
  }));
}

async function main() {
  const files = await selectedFiles(process.argv.slice(2));
  const scratch = await mkdtemp(path.join(tmpdir(), 'media-studio-focused-web-'));
  console.log(`Disposable test cache: ${scratch}`);
  try {
    // Deliberately do not inherit provider credentials, app paths or NODE_OPTIONS.
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR'].filter(key => process.env[key])
      .map(key => [key, process.env[key]]));
    Object.assign(env, {
      TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      MEDIA_STUDIO_TEST_CACHE: scratch, MEDIA_STUDIO_TEST_FILES: JSON.stringify(files),
      MEDIA_ENABLE_LIVE_SUBMIT: '0', MEDIA_BACKGROUND_POLL_ENABLED: '0',
      MEDIA_PRICING_REFRESH_ON_STARTUP: '0', KIE_API_KEY: '', OPENROUTER_API_KEY: '',
      NODE_ENV: 'test',
    });
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'),
      'run', '--configLoader', 'runner', '--no-cache', '--coverage.enabled=false'],
    { cwd: web, env, stdio: 'inherit', timeout: 120000 });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    // Only remove the fresh directory this invocation owns.
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
