import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { validateGraph, validateClones, cloneEndpoint, cloneFinding, isTest } from './full-policy.mjs';

export const exclusions = ['node_modules', '.next', '.git', '.venv', '__pycache__', 'data', 'build', 'dist', 'test-results'];
const extensions = /\.(?:[cm]?js|jsx|ts|tsx|py|css)$/;
export const graphFile = file => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file);
export const save = (directory, name, data) => writeFile(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');

async function walk(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    if (exclusions.includes(entry.name)) return [];
    const file = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unsupported source symlink: ${file}`);
    if (entry.isDirectory()) return walk(root, file);
    return extensions.test(file) && !file.endsWith('.d.ts') ? [file] : [];
  }));
  return groups.flat();
}

export async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter(item => item.isDirectory() && ['apps', 'scripts', 'ops', 'tests'].includes(item.name));
  const groups = await Promise.all(dirs.map(item => walk(root, item.name)));
  const top = entries.filter(item => item.isFile() && extensions.test(item.name) && !item.name.endsWith('.d.ts')).map(item => item.name);
  return [...groups.flat(), ...top].sort();
}

export async function execute(root, output, name, command, accepted = [0]) {
  const result = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 40 * 1024 * 1024 });
  await save(output, `${name}-execution.json`, { command: [process.execPath, ...command], status: result.status,
    signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  if (result.error || !accepted.includes(result.status)) throw new Error(`${name} execution failed`);
  return result.stdout;
}

export async function graphScan(root, output, files) {
  const inputs = [...new Set(files.map(file => file.split('/')[0]))];
  const command = ['node_modules/dependency-cruiser/bin/dependency-cruise.mjs', ...inputs,
    '--config', 'dependency-cruiser.config.cjs', '--metrics', '--output-type', 'json'];
  const report = JSON.parse(await execute(root, output, 'dependency-cruiser', command, [0, 1]));
  await save(output, 'dependency-cruiser.json', report);
  const violations = validateGraph(report, files);
  if (violations.length) throw new Error(`Dependency rules failed: ${JSON.stringify(violations)}`);
  return { files: files.length, modules: report.modules.length, dependencies: report.summary.totalDependenciesCruised, violations };
}

export async function cloneScan(root, output, files, name) {
  const directory = path.join(output, name);
  await mkdir(directory);
  if (!files.length) throw new Error(`Empty ${name} corpus`);
  const config = JSON.parse(await readFile(path.join(root, 'jscpd.config.json'), 'utf8'));
  await save(directory, 'input-config.json', { ...config, path: files.map(file => path.join(root, file)) });
  const command = ['node_modules/jscpd/run-jscpd.js', '--min-lines', '5', '--min-tokens', '50', '--mode', 'mild',
    '--config', path.join(directory, 'input-config.json'), '--no-gitignore', '--max-size', '50mb', '--absolute', '--reporters', 'json', '--output', directory, '--no-colors'];
  await execute(root, output, name, command);
  const report = JSON.parse(await readFile(path.join(directory, 'jscpd-report.json'), 'utf8'));
  const coverage = await cloneCoverage(root, output, files, name, command);
  const duplicates = validateClones(report, coverage.filter(item => item.sources === 1).length);
  const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file), 'utf8')])));
  const findings = duplicates.map(duplicate => {
    const endpoints = [duplicate.firstFile, duplicate.secondFile].map(endpoint => {
      const file = path.relative(root, endpoint.name).split(path.sep).join('/');
      return cloneEndpoint(root, endpoint, files, sources.get(file) ?? '');
    });
    return cloneFinding(duplicate, endpoints);
  });
  return { findings, statistics: report.statistics.total };
}

async function cloneCoverage(root, output, files, name, command) {
  const directory = path.join(output, `${name}-coverage`);
  await mkdir(directory);
  const options = command.slice(command.indexOf('--min-lines'));
  options[options.indexOf('--output') + 1] = directory;
  const coverage = [];
  for (const [index, file] of files.entries()) {
    if ((await stat(path.join(root, file))).size > 50 * 1024 * 1024) throw new Error(`Source exceeds explicit jscpd size limit: ${file}`);
    await execute(root, directory, String(index), [command[0], file, ...options, '--report-name', String(index)]);
    const report = JSON.parse(await readFile(path.join(directory, `${index}.json`), 'utf8'));
    const sources = report.statistics?.total?.sources;
    if (![0, 1].includes(sources)) throw new Error(`Invalid individual coverage: ${file}`);
    validateClones(report, sources);
    coverage.push({ file, sources, reason: sources ? 'analyzed' : 'tool excluded below threshold or unsupported format', report: `${index}.json` });
  }
  await save(output, `${name}-coverage.json`, coverage);
  return coverage;
}

export const corpora = files => ({ production: files.filter(file => !isTest(file)), tests: files.filter(isTest) });
