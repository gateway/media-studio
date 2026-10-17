import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, compareClones, uniqueClones } from './full-policy.mjs';
import { save, sourceFiles, graphFile, graphScan, cloneScan, corpora, exclusions } from './full-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const refresh = args[0] === '--update-baseline';
const reason = args.slice(1).join(' ').trim();
let output;

async function contract() {
  const files = ['package-lock.json', 'dependency-cruiser.config.cjs', 'jscpd.config.json', 'apps/web/tsconfig.json',
    'scripts/static-analysis/full.mjs', 'scripts/static-analysis/full-scan.mjs', 'scripts/static-analysis/full-policy.mjs'];
  const hashes = await Promise.all(files.map(async file => [file, digest((await readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n'))]));
  const versions = await Promise.all(['dependency-cruiser', 'jscpd'].map(async name => [name,
    JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version]));
  return { files: Object.fromEntries(hashes), versions: Object.fromEntries(versions),
    scope: ['apps', 'scripts', 'ops', 'tests', 'root source files'], exclusions, minTokens: 50, minLines: 5, mode: 'mild' };
}

async function main() {
  if (args.length && (!refresh || !reason)) throw new Error('Usage: full.mjs [--update-baseline <review reason>]');
  const parent = process.env.STATIC_ANALYSIS_OUTPUT || tmpdir();
  await mkdir(parent, { recursive: true });
  output = await mkdtemp(path.join(parent, 'media-studio-full-'));
  console.log(`Full graph/clone evidence: ${output}`);
  const metadata = await contract();
  await save(output, 'contract.json', metadata);
  const files = await sourceFiles(root);
  await save(output, 'files.json', corpora(files));
  const graph = await graphScan(root, output, files.filter(graphFile));
  const groups = corpora(files);
  const production = await cloneScan(root, output, groups.production, 'production');
  const tests = await cloneScan(root, output, groups.tests, 'tests');
  const findings = production.findings.sort((a, b) => a.id.localeCompare(b.id));
  uniqueClones(findings);
  const signature = digest(JSON.stringify(metadata));
  await save(output, 'findings.json', findings);
  if (refresh) {
    await save(path.join(root, 'scripts/static-analysis'), 'full-baseline.json', { schema: 1, contract: signature, metadata, reason, findings });
    console.log(`Explicit production clone baseline: ${findings.length}; review the diff.`);
    return;
  }
  const baseline = JSON.parse(await readFile(path.join(root, 'scripts/static-analysis/full-baseline.json'), 'utf8'));
  const regressions = compareClones(findings, baseline, signature);
  await save(output, 'summary.json', { passed: !regressions.length, graph, production: production.statistics, tests: tests.statistics, regressions });
  if (regressions.length) throw new Error(`${regressions.length} new or worsened production clone pairs`);
  console.log(`Full gate passed: ${graph.files} graph files; ${findings.length} production clone pairs, ${tests.findings.length} informational test pairs; zero regressions.`);
}

main().catch(async error => {
  console.error(error);
  if (output) await save(output, 'failure.json', { passed: false, error: error.stack });
  process.exitCode = 1;
});
