import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { fingerprint, validateReport } from './policy.mjs';

export const scope = ['apps/web/**/*.{ts,tsx,js,mjs,cjs}', 'scripts/**/*.{ts,tsx,js,mjs,cjs}', 'ops/**/*.{ts,tsx,js,mjs,cjs}', '*.{js,mjs,cjs}'];
export const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
export const save = (directory, name, data) => writeFile(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');

function metric(message) {
  const patterns = {
    complexity: /complexity of (\d+)/i,
    'sonarjs/cognitive-complexity': /Cognitive Complexity from (\d+)/,
  };
  const pattern = patterns[message.ruleId];
  if (!pattern) return undefined;
  const match = message.message.match(pattern);
  if (!match) throw new Error(`Unrecognized complexity report: ${message.message}`);
  return Number(match[1]);
}

export async function eslintScan(root, output) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.config.mjs'), allowInlineConfig: false });
  const results = await eslint.lintFiles(scope);
  await save(output, 'eslint.json', results);
  const configurations = {};
  for (const extension of ['.ts', '.tsx', '.mjs', '.cjs', '.js']) {
    const sample = results.find((result) => result.filePath.endsWith(extension));
    if (sample) configurations[relative(root, sample.filePath)] = await eslint.calculateConfigForFile(sample.filePath);
  }
  await save(output, 'eslint-effective-configs.json', configurations);
  const findings = [];
  for (const result of results) {
    if (result.fatalErrorCount || result.messages.some((message) => !message.ruleId)) {
      throw new Error(`ESLint failed to analyze ${result.filePath}; see eslint.json`);
    }
    const file = relative(root, result.filePath);
    const text = await readFile(result.filePath, 'utf8');
    for (const message of result.messages) {
      findings.push(fingerprint(file, text, {
        rule: message.ruleId, message: message.message, severity: message.severity,
        line: message.line, column: message.column, metric: metric(message),
      }));
    }
  }
  return validateReport({ files: results.map((result) => relative(root, result.filePath)), findings });
}

function diagnostic(root, item) {
  const location = item.file?.getLineAndCharacterOfPosition(item.start ?? 0);
  return {
    file: item.file ? relative(root, item.file.fileName) : '<configuration>',
    rule: `TS${item.code}`, message: ts.flattenDiagnosticMessageText(item.messageText, '\n'),
    severity: 2, line: (location?.line ?? 0) + 1, column: (location?.character ?? 0) + 1,
  };
}

export async function typescriptScan(root, output) {
  const configPath = path.join(root, 'apps/web/tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), {
    incremental: false, noEmit: true, noUnusedLocals: true, noUnusedParameters: true,
  });
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const findings = diagnostics.map((item) => diagnostic(root, item));
  const files = program.getSourceFiles().map((file) => relative(root, file.fileName));
  await save(output, 'typescript.json', { version: ts.version, files, findings, options: parsed.options });
  // Only unused declarations are grandfathered; all actual type/config errors block refresh too.
  const unusedCodes = new Set([6133, 6192, 6196, 6198]);
  if (diagnostics.some((item) => !unusedCodes.has(item.code))) throw new Error('TypeScript type/configuration errors; see typescript.json');
  const identified = diagnostics.map((item, index) => fingerprint(findings[index].file, item.file.text, findings[index]));
  return validateReport({ files, findings: identified });
}
