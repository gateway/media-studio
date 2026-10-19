import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let output;
const save = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const categories = ['binaries', 'catalog', 'catalogReferences', 'dependencies', 'devDependencies',
  'duplicates', 'enumMembers', 'exports', 'files', 'namespaceMembers', 'optionalPeerDependencies',
  'types', 'unlisted', 'unresolved'];

function counts(report) {
  if (!report || !Array.isArray(report.issues)) throw new Error('Invalid Knip JSON report');
  const totals = Object.fromEntries(categories.map(category => [category, 0]));
  for (const issue of report.issues) {
    if (typeof issue.file !== 'string' || !issue.file) throw new Error('Invalid Knip issue file');
    for (const category of categories) {
      if (!Array.isArray(issue[category])) throw new Error(`Invalid Knip category: ${category}`);
      totals[category] += issue[category].length;
    }
  }
  return totals;
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/static-analysis/knip.mjs');
  const parent = process.env.STATIC_ANALYSIS_OUTPUT || tmpdir();
  await mkdir(parent, { recursive: true });
  output = await mkdtemp(path.join(parent, 'media-studio-knip-'));
  console.log(`Knip evidence: ${output}`);
  const packageDirectory = path.join(root, 'node_modules/knip');
  const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  const files = ['knip.jsonc', 'package.json', 'apps/web/package.json', 'package-lock.json', 'scripts/static-analysis/knip.mjs'];
  const hashes = await Promise.all(files.map(async file => [file,
    createHash('sha256').update((await readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n')).digest('hex')]));
  const command = [path.join(packageDirectory, manifest.bin.knip), '--config', 'knip.jsonc',
    '--reporter', 'json', '--no-exit-code'];
  await save('metadata.json', { knip: manifest.version, node: process.version, platform: process.platform,
    mode: 'default', policy: 'informational findings; execution errors block', files: Object.fromEntries(hashes) });
  const result = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8',
    timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  await save('execution.json', { command: [process.execPath, ...command], status: result.status,
    signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  // --no-exit-code suppresses finding exits only. Config/plugin/internal failures still fail.
  if (result.error || result.status !== 0) throw new Error('Knip execution failed; see execution.json');
  const report = JSON.parse(result.stdout);
  const totals = counts(report);
  await save('knip.json', report);
  await save('summary.json', { passed: true, informational: true, counts: totals });
  console.log(`Knip completed (informational): ${JSON.stringify(totals)}. Review candidates before cleanup; no finding baseline or production-mode gate.`);
}

main().catch(async error => {
  console.error(error);
  if (output) await save('failure.json', { passed: false, error: error.stack });
  process.exitCode = 1;
});
