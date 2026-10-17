import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, parseReport, cssFindings, regressions, historicalRules, uniqueFindings } from './css-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const refresh = args[0] === '--update-baseline';
const reason = args.slice(1).join(' ').trim();
const baselinePath = path.join(root, 'scripts/static-analysis/css-baseline.json');
let output;
const save = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(entries.filter((item) => !['node_modules', '.next', 'test-results'].includes(item.name)).map(async (item) => {
    const full = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`CSS scope contains a symlink: ${full}`);
    if (item.isDirectory()) return cssFiles(full);
    return item.name.endsWith('.css') ? [full] : [];
  }));
  return found.flat().sort();
}

async function contract() {
  const files = ['stylelint.config.mjs', 'package-lock.json', 'scripts/static-analysis/css.mjs',
    'scripts/static-analysis/css-policy.mjs', 'scripts/check_style_drift.py'];
  const digests = await Promise.all(files.map(async (file) => [file, hash((await readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n'))]));
  const versions = Object.fromEntries(await Promise.all(['stylelint', 'stylelint-config-standard', 'postcss'].map(async (name) => {
    const packageFile = path.join(root, 'node_modules', name, 'package.json');
    return [name, JSON.parse(await readFile(packageFile, 'utf8')).version];
  })));
  return { versions, scope: 'apps/web/**/*.css', excludes: ['node_modules', '.next', 'test-results'], files: Object.fromEntries(digests) };
}

async function scan(files) {
  const cli = path.join(path.dirname(require.resolve('stylelint/package.json')), 'bin/stylelint.mjs');
  const command = [cli, ...files, '--config', 'stylelint.config.mjs', '--formatter', 'json', '--ignore-disables'];
  const result = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  await save('stylelint-execution.json', { command: [process.execPath, ...command], status: result.status,
    error: result.error?.message, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  if (result.error || ![0, 2].includes(result.status)) throw new Error('Stylelint execution failed');
  const report = parseReport(result.stdout, result.stderr);
  await save('stylelint.json', report);
  const actual = report.map((item) => path.resolve(item.source)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(files)) throw new Error('Incomplete CSS coverage');
  const findings = await Promise.all(report.map(async (item) => {
    if (item.parseErrors.length || item.invalidOptionWarnings.length || item.ignored) throw new Error(`Invalid CSS analysis: ${item.source}`);
    return cssFindings(path.relative(root, item.source).split(path.sep).join('/'), await readFile(item.source, 'utf8'), item.warnings);
  }));
  return findings.flat().sort((a, b) => a.id.localeCompare(b.id));
}

async function themeCheck() {
  const python = process.env.STATIC_ANALYSIS_PYTHON || path.join(root, '.venv/static-analysis', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const command = ['-B', 'scripts/check_style_drift.py'];
  const result = spawnSync(python, command, { cwd: root, encoding: 'utf8', timeout: 120000 });
  await save('theme-drift.json', { command: [python, ...command], status: result.status,
    error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  if (result.error || result.status !== 0) throw new Error('Existing theme-drift guard failed');
}

async function main() {
  if (args.length && (!refresh || !reason)) throw new Error('Usage: css.mjs [--update-baseline <review reason>]');
  const parent = process.env.STATIC_ANALYSIS_OUTPUT || tmpdir();
  await mkdir(parent, { recursive: true });
  output = await mkdtemp(path.join(parent, 'media-studio-css-'));
  console.log(`CSS evidence: ${output}`);
  const metadata = await contract();
  await save('contract.json', metadata);
  const files = await cssFiles(path.join(root, 'apps/web'));
  if (!files.length) throw new Error('No CSS files found');
  const findings = await scan(files);
  await save('findings.json', findings);
  uniqueFindings(findings);
  const stylelint = (await import('stylelint')).default;
  await save('effective-config.json', await stylelint.resolveConfig(files[0], { configFile: path.join(root, 'stylelint.config.mjs') }));
  await themeCheck();
  const signature = hash(JSON.stringify(metadata));
  if (refresh) {
    if (findings.some((item) => !historicalRules.has(item.rule))) throw new Error('Cannot baseline unreviewed CSS correctness rules');
    await writeFile(baselinePath, JSON.stringify({ schema: 1, contract: signature, metadata, reason, findings }, null, 2) + '\n');
    console.log(`CSS baseline explicitly updated: ${findings.length} findings; review its diff.`);
    return;
  }
  const added = regressions(findings, JSON.parse(await readFile(baselinePath, 'utf8')), signature);
  await save('summary.json', { passed: added.length === 0, files: files.length, findings: findings.length, regressions: added });
  for (const item of added) console.error(`${item.file}:${item.line}:${item.column} ${item.rule}: ${item.message}`);
  if (added.length) throw new Error(`${added.length} new CSS findings`);
  console.log(`CSS gate passed: ${files.length} files, ${findings.length} historical findings, zero regressions; theme guard passed.`);
}

main().catch(async (error) => {
  console.error(error);
  if (output) await save('failure.json', { passed: false, error: error.stack });
  process.exitCode = 1;
});
