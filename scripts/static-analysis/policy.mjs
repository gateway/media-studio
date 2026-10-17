import { createHash } from 'node:crypto';
import ts from 'typescript';

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function groupSummary(files, findings) {
  const isTest = (file) => /(?:^|\/)(?:tests|__tests__)\/|\.(?:test|spec)\.[^.]+$|(?:^|\/)test_[^/]+$/.test(file);
  const metricRules = new Set(['complexity', 'sonarjs/cognitive-complexity']);
  return Object.fromEntries([['production', false], ['tests', true]].map(([name, flag]) => {
    const selected = findings.filter((item) => isTest(item.file) === flag);
    return [name, { eslintFiles: files.filter((file) => isTest(file) === flag).length,
      findings: selected.length, complexityFindings: selected.filter((item) => metricRules.has(item.rule)).length }];
  }));
}

// Token identity ignores comments and whitespace, but preserves literals and names.
export function tokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  const result = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) result.push(scanner.getTokenText());
  return JSON.stringify(result);
}

function declaration(node, source) {
  if (node.name) return `${ts.SyntaxKind[node.kind]}:${tokens(node.name.getText(source))}`;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) return 'function';
    // Anonymous callbacks have no stable name: edits require review, never a guessed match.
    return `anonymous:${digest(tokens(node.getText(source)))}`;
  }
  return null;
}

function branchContext(node, source, position) {
  if (ts.isIfStatement(node)) {
    return ['if', tokens(node.expression.getText(source)), position < node.thenStatement.end ? 'then' : 'else'];
  }
  if (ts.isCaseClause(node)) return ['case', tokens(node.expression.getText(source))];
  if (ts.isDefaultClause(node)) return ['default'];
  return null;
}

function adjacentStatements(statement, source) {
  const siblings = statement.parent?.statements ?? [];
  const index = siblings.indexOf(statement);
  return [siblings[index - 1], siblings[index + 1]].map((node) => node ? digest(tokens(node.getText(source))) : null);
}

export function fingerprint(file, text, finding) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const position = source.getPositionOfLineAndCharacter(finding.line - 1, finding.column - 1);
  const ancestors = [];
  function visit(node) {
    if (position < node.getStart(source) || position >= node.end) return;
    ancestors.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const owner = ancestors.map((node) => declaration(node, source)).filter(Boolean).join('/');
  const isMetric = finding.metric !== undefined;
  const leaf = ancestors.at(-1) ?? source;
  const statement = ancestors.findLast((node) => ts.isStatement(node)) ?? leaf;
  const anchor = isMetric ? '' : [tokens(statement.getText(source)), adjacentStatements(statement, source),
    tokens(text.slice(statement.getStart(source), leaf.getStart(source))), position - leaf.getStart(source)];
  const branches = isMetric ? [] : ancestors.map((node) => branchContext(node, source, position)).filter(Boolean);
  const identity = [file, finding.rule, owner, branches, anchor, isMetric ? '' : finding.message];
  return { ...finding, file, owner, id: digest(JSON.stringify(identity)) };
}

function validateFinding(finding, files) {
  if (!files.includes(finding.file) || !finding.rule || !finding.message ||
      !Number.isInteger(finding.line) || finding.line < 1 ||
      !Number.isInteger(finding.column) || finding.column < 1 ||
      ![1, 2].includes(finding.severity)) throw new Error('Invalid analyzer finding');
  if (finding.metric !== undefined && !Number.isFinite(finding.metric)) throw new Error('Invalid metric');
}

export function validateReport(report) {
  if (!report || !Array.isArray(report.files) || !report.files.length || !Array.isArray(report.findings)) {
    throw new Error('Invalid or empty analyzer report');
  }
  if (new Set(report.files).size !== report.files.length) throw new Error('Duplicate analyzed files');
  for (const finding of report.findings) validateFinding(finding, report.files);
  return report;
}

export function uniqueFindings(findings) {
  const map = new Map();
  for (const finding of findings) {
    if (!finding.id || map.has(finding.id)) {
      throw new Error(`Ambiguous finding identity: ${finding.file}:${finding.line} ${finding.rule}; review matching before baselining`);
    }
    map.set(finding.id, finding);
  }
  return map;
}

export function compare(current, baseline, contract) {
  if (baseline.schema !== 1 || baseline.contract !== contract || !Array.isArray(baseline.findings)) {
    throw new Error('Baseline configuration/version/scope mismatch; explicit reviewed baseline update required');
  }
  const known = uniqueFindings(baseline.findings);
  uniqueFindings(current);
  return current.filter((finding) => {
    const previous = known.get(finding.id);
    return !previous || finding.severity > previous.severity ||
      (finding.metric !== undefined && (!Number.isFinite(previous.metric) || finding.metric > previous.metric));
  });
}
