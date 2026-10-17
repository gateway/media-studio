import { createHash } from 'node:crypto';
import postcss from 'postcss';

export const hash = (text) => createHash('sha256').update(text).digest('hex');

// Adoption debt reviewed in CSS_BASELINE_REVIEW.md. Correctness rules outside
// this list cannot be waived by the baseline command.
export const historicalRules = new Set([
  'alpha-value-notation', 'color-function-alias-notation', 'color-function-notation',
  'declaration-block-single-line-max-declarations', 'selector-class-pattern',
  'no-descending-specificity', 'media-feature-range-notation', 'at-rule-empty-line-before',
  'declaration-block-no-redundant-longhand-properties', 'declaration-empty-line-before',
  'property-no-vendor-prefix', 'rule-empty-line-before', 'selector-not-notation',
  'value-keyword-case', 'custom-property-empty-line-before', 'font-family-name-quotes',
  'property-no-deprecated', 'color-hex-length', 'declaration-property-value-keyword-no-deprecated',
]);

export function parseReport(stdout, stderr) {
  for (const stream of [stdout, stderr]) {
    try {
      const report = JSON.parse(stream);
      if (Array.isArray(report) && report.length && report.every((item) =>
        typeof item.source === 'string' && Array.isArray(item.warnings) &&
        Array.isArray(item.parseErrors) && Array.isArray(item.invalidOptionWarnings))) return report;
    } catch { /* Stylelint versions may send the JSON report to either stream. */ }
  }
  throw new Error('Missing or invalid Stylelint JSON report');
}

export function cssFindings(file, source, warnings) {
  const ast = postcss.parse(source, { from: file });
  const offsets = [0];
  for (const line of source.split('\n')) offsets.push(offsets.at(-1) + line.length + 1);
  return warnings.map((warning) => {
    const { rule, line, column, text, severity } = warning;
    if (!rule || !Number.isInteger(line) || !Number.isInteger(column) || !text || !severity) {
      throw new Error(`Invalid Stylelint warning in ${file}`);
    }
    let owner = ast;
    ast.walk((node) => {
      const { start, end } = node.source;
      if (line >= start.line && line <= end.line &&
        (line !== start.line || column >= start.column) && (line !== end.line || column <= end.column)) owner = node;
    });
    const context = [];
    for (let node = owner; node && node.type !== 'root'; node = node.parent) context.push(nodeIdentity(node));
    const container = owner.type === 'decl' ? owner.parent : owner;
    const block = semanticNode(container);
    const neighbors = [container.prev(), container.next()].map((node) => node ? semanticNode(node) : null);
    const prefix = source.slice(owner.source.start.offset, offsets[line - 1] + column - 1).replace(/\/\*[\s\S]*?\*\/|\s+/g, '');
    const identityText = rule === 'no-descending-specificity' ? text.replace(/, at line \d+(?= \(no-descending-specificity\))/, '') : text;
    const id = hash(JSON.stringify([file, rule, identityText, context, block, neighbors, prefix]));
    return { id, file, line, column, rule, severity, message: text };
  });
}

function semanticNode(node) {
  return [nodeIdentity(node), node.nodes?.filter((child) => child.type !== 'comment').map(semanticNode)];
}

function nodeIdentity(node) {
  if (node.type === 'decl') return ['decl', node.prop, node.value, Boolean(node.important)];
  if (node.type === 'rule') return ['rule', node.selector];
  if (node.type === 'atrule') return ['atrule', node.name, node.params];
  return [node.type, node.toString().trim()];
}

export function regressions(findings, baseline, contract) {
  if (baseline.schema !== 1 || baseline.contract !== contract || !Array.isArray(baseline.findings)) {
    throw new Error('CSS baseline contract changed; review and explicitly refresh the baseline');
  }
  uniqueFindings(findings);
  uniqueFindings(baseline.findings);
  const accepted = new Set(baseline.findings.map((item) => item.id));
  return findings.filter((item) => !accepted.has(item.id));
}

export function uniqueFindings(findings) {
  const ids = new Set();
  for (const item of findings) {
    if (ids.has(item.id)) throw new Error(`Ambiguous CSS finding requires review: ${item.file}:${item.line} ${item.rule}`);
    ids.add(item.id);
  }
}
