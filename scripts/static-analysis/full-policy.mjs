import { createHash } from 'node:crypto';
import path from 'node:path';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const normalized = text => text.replaceAll('\r\n', '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
export const isTest = file => /(?:^|\/)(?:tests|__tests__)\/|\.(?:test|spec)\.[^.]+$|(?:^|\/)test_[^/]+$/.test(file);

export function relativeFile(root, file, files) {
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  if (!files.includes(relative)) throw new Error(`Unexpected analyzer endpoint: ${file}`);
  return relative;
}

export function validateGraph(report, files) {
  if (!Array.isArray(report.modules) || !Array.isArray(report.summary?.violations)) throw new Error('Invalid dependency report');
  const scanned = new Set(report.modules.map(item => item.source));
  if (files.some(file => !scanned.has(file))) throw new Error('Incomplete dependency coverage');
  return report.summary.violations.map(item => ({
    rule: item.rule.name, from: item.from, to: item.to, cycle: item.cycle,
  }));
}

export function validateClones(report, count) {
  if (!Array.isArray(report.duplicates) || report.statistics?.total?.sources !== count) {
    throw new Error('Invalid or incomplete jscpd report');
  }
  if (report.statistics.total.clones !== report.duplicates.length) throw new Error('Inconsistent jscpd clone count');
  return report.duplicates;
}

export function cloneEndpoint(root, endpoint, files, source) {
  const file = relativeFile(root, endpoint.name, files);
  if (!Number.isInteger(endpoint.start) || !Number.isInteger(endpoint.end) || endpoint.start < 1 || endpoint.end < endpoint.start) {
    throw new Error('Invalid clone location');
  }
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  if (endpoint.end > lines.length) throw new Error('Clone location outside source');
  // Full nonblank prefix/suffix disambiguate repeated functions without line-based
  // exemptions. Editing a flagged file's context requires an explicit review.
  return { file, start: endpoint.start, end: endpoint.end,
    context: digest(JSON.stringify([normalized(lines.slice(0, endpoint.start - 1).join('\n')),
      normalized(lines.slice(endpoint.end).join('\n'))])) };
}

export function cloneFinding(duplicate, endpoints) {
  if (!duplicate.fragment || !Number.isFinite(duplicate.tokens) || !Number.isFinite(duplicate.lines)) throw new Error('Invalid clone metric');
  const ordered = endpoints.toSorted((a, b) => JSON.stringify([a.file, a.context]).localeCompare(JSON.stringify([b.file, b.context])));
  return { id: digest(JSON.stringify([duplicate.format, normalized(duplicate.fragment), ordered.map(item => [item.file, item.context])])),
    endpoints: ordered, tokens: duplicate.tokens, lines: duplicate.lines, format: duplicate.format };
}

export function uniqueClones(findings) {
  const ids = new Set();
  for (const finding of findings) {
    if (ids.has(finding.id)) throw new Error('Ambiguous clone identity requires review');
    ids.add(finding.id);
  }
}

export function compareClones(findings, baseline, contract) {
  if (baseline.schema !== 1 || baseline.contract !== contract || !Array.isArray(baseline.findings)) throw new Error('Full gate contract changed; explicitly review baseline');
  uniqueClones(findings);
  uniqueClones(baseline.findings);
  const accepted = new Map(baseline.findings.map(item => [item.id, item]));
  return findings.filter(item => !accepted.has(item.id) || item.tokens > accepted.get(item.id).tokens);
}
