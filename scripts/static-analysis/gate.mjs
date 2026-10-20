#!/usr/bin/env node
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const baselinePath = path.join(root, 'scripts/static-analysis/baseline.json');
const argumentsList = process.argv.slice(2);
const refresh = argumentsList[0] === '--update-baseline';
const reason = argumentsList.slice(1).join(' ').trim();
let output;

async function contract(scope, digest) {
  const packages = ['eslint', '@eslint/js', 'typescript-eslint', 'eslint-plugin-sonarjs', 'eslint-plugin-react-hooks', 'typescript'];
  const versions = Object.fromEntries(packages.map((name) => [name, require(`${name}/package.json`).version]));
  const paths = ['eslint.config.mjs', 'apps/web/tsconfig.json', 'apps/web/tsconfig.lint.json', 'package-lock.json',
    'scripts/static-analysis/policy.mjs', 'scripts/static-analysis/scan.mjs', 'scripts/static-analysis/gate.mjs', 'scripts/lint_web.mjs'];
  const contents = await Promise.all(paths.map(async (file) => [file, digest((await readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n'))]));
  return { versions, scope, files: Object.fromEntries(contents) };
}

async function main() {
  if (argumentsList.length && (!refresh || !reason)) throw new Error('Usage: gate.mjs [--update-baseline <review reason>]');
  const outputRoot = process.env.STATIC_ANALYSIS_OUTPUT || tmpdir();
  await mkdir(outputRoot, { recursive: true });
  output = await mkdtemp(path.join(outputRoot, 'media-studio-static-'));
  console.log(`Static-analysis evidence: ${output}`);
  // Dynamic imports keep dependency/config failures within the fail-closed error path.
  const { digest, compare, uniqueFindings, groupSummary } = await import('./policy.mjs');
  const { eslintScan, typescriptScan, save, scope } = await import('./scan.mjs');
  const metadata = await contract(scope, digest);
  const hash = digest(JSON.stringify(metadata));
  await save(output, 'contract.json', metadata);
  await save(output, 'execution.json', { node: process.version, platform: process.platform,
    command: ['node', 'scripts/static-analysis/gate.mjs', ...argumentsList],
    analyzers: ['ESLint.lintFiles', 'TypeScript.getPreEmitDiagnostics', 'node scripts/lint_web.mjs'] });
  const results = await Promise.allSettled([eslintScan(root, output), typescriptScan(root, output)]);
  const custom = spawnSync(process.execPath, ['scripts/lint_web.mjs'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  await save(output, 'custom-web.json', { command: 'node scripts/lint_web.mjs', status: custom.status,
    signal: custom.signal, error: custom.error?.message, stdout: custom.stdout, stderr: custom.stderr });
  for (const result of results) if (result.status === 'rejected') console.error(result.reason);
  if (results.some((result) => result.status === 'rejected') || custom.status !== 0 || custom.error) {
    throw new Error('Required analyzer failed; baseline was not changed');
  }
  const findings = results.flatMap((result) => result.value.findings).sort((a, b) => a.id.localeCompare(b.id));
  uniqueFindings(findings);
  await save(output, 'findings.json', findings);
  if (refresh) {
    if (findings.some((finding) => finding.file.startsWith('scripts/static-analysis/') &&
        !['complexity', 'sonarjs/cognitive-complexity'].includes(finding.rule))) {
      throw new Error('Gate correctness findings cannot be baselined');
    }
    await save(path.dirname(baselinePath), path.basename(baselinePath), { schema: 1, contract: hash, metadata, reason, findings });
    console.log(`Baseline explicitly updated: ${findings.length} findings. Review the diff before committing.`);
    return;
  }
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const regressions = compare(findings, baseline, hash);
  const summary = { passed: regressions.length === 0, findings: findings.length,
    groups: groupSummary(results[0].value.files, findings),
    eslintFiles: results[0].value.files.length, typescriptFiles: results[1].value.files.length, regressions };
  await save(output, 'summary.json', summary);
  for (const finding of regressions) console.error(`${finding.file}:${finding.line}:${finding.column} ${finding.rule}: ${finding.message}`);
  if (regressions.length) throw new Error(`${regressions.length} new or worsened findings`);
  console.log(`Static gate passed: ${summary.eslintFiles} ESLint files, ${summary.typescriptFiles} TypeScript files; ${findings.length} baseline findings, zero regressions. Custom web checks passed.`);
}

main().catch(async (error) => {
  console.error(error);
  if (output) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2));
  }
  process.exitCode = 1;
});
