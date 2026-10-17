import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--base' || args[1].startsWith('-'))) {
  console.error('Usage: npm run lint:changed -- [--base <git-ref>]');
  process.exit(1);
}
const result = spawnSync('git', ['merge-base', 'HEAD', args[1] || 'origin/main'], { cwd: root, encoding: 'utf8', timeout: 10000 });
if (result.status !== 0 || !/^[a-f0-9]{40,64}$/.test(result.stdout.trim())) {
  console.error('Cannot verify merge base; no partial scan was treated as success. Fetch the base or run npm run lint:full.');
  process.exit(1);
}
console.log(`Verified merge base ${result.stdout.trim()}. Changed-only analysis is not implemented; running the authoritative FULL gate, including untracked sources.`);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run lint:changed');
const check = spawnSync(process.execPath, [npm, 'run', 'lint:full'], { cwd: root, stdio: 'inherit' });
process.exitCode = check.status ?? 1;
