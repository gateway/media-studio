#!/usr/bin/env node
/** Static admin theme contracts. No application imports, runtime or database access. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = "apps/web/";
const SHELL = `${WEB}components/studio-admin-shell.tsx`;
const TOKENS = `${WEB}app/admin.css`;
const ROUTES = /^apps\/web\/app\/(settings|setup|models|presets|jobs|pricing)\//;
const CONTROL_OWNERS = new Set([
  "admin-controls.tsx", "ui/button.tsx", "ui/icon-button.tsx", "ui/pill-select.tsx", "media/thumbnail-field.tsx",
].map((name) => `${WEB}components/${name}`));
const RAW_UTIL = /(?:^|[\s:!])((?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|outline|decoration|fill|stroke|from|via|to|shadow)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950))(?:\/[^\s"'`]+)?!?)(?=$|[\s"'`])/g;
const ARBITRARY_COLOR = /(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|outline|decoration|fill|stroke|from|via|to|shadow)-\[([^\]]+)\]/g;
const COLOR_VALUE = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const CONTROL_STYLE = /^(?:bg-|border(?:-|$)|rounded(?:-|$)|shadow(?:-|$)|ring(?:-|$)|font-|tracking-|leading-|p[xytrblse]?-|text-(?:\[|xs$|sm$|base$|lg$|xl$|\d+x[l]$))/;
const COLOR_PROPERTY = /^(?:color|background(?:Color|Image)?|border(?:Top|Right|Bottom|Left)?(?:Color)?|outline(?:Color)?|boxShadow|textShadow|fill|stroke)$/;
const CONTROL_PROPERTY = /^(?:color|background\w*|border\w*|outline\w*|boxShadow|font\w*|letterSpacing|lineHeight|padding\w*)$/;
const CONTROL_TAG = /^(?:button|input|textarea|select|Button|AdminButton|AdminIconButton|AdminNavButton|AdminInput|AdminTextarea|AdminSelect|PillSelect)$/;
const CSS_COLOR_PROPERTY = /(?:^|;)\s*(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke)\s*:\s*([^;]+)/g;
const SEMANTIC = new Set(["transparent", "currentcolor", "inherit", "initial", "unset", "none", "revert"]);
const literal = (node) => ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
const rawColor = (value) => {
  const color = value.trim().replace(/^color:/, "");
  return COLOR_VALUE.test(color) || (/^[a-z]+$/i.test(color) && !SEMANTIC.has(color.toLowerCase()));
};
const key = ({ file, rule, detail }) => JSON.stringify([file, rule, detail]);

export function inspectSource(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings = [];
  const add = (rule, detail) => findings.push({ file, rule, detail });
  const controls = new Set();
  const values = new Map();
  function declarations(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      values.set(node.name.text, values.has(node.name.text) ? null : node.initializer);
    }
    ts.forEachChild(node, declarations);
  }
  declarations(tree);
  function follow(node, visitValue, includeCalls = false, seen = new Set()) {
    visitValue(node);
    if (ts.isIdentifier(node) && values.get(node.text) && !seen.has(node.text)) {
      follow(values.get(node.text), visitValue, includeCalls, new Set([...seen, node.text]));
    } else if (includeCalls || !ts.isCallExpression(node)) ts.forEachChild(node, (child) => follow(child, visitValue, includeCalls, seen));
  }
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const item of statement.importClause.namedBindings.elements) {
        if (CONTROL_TAG.test(item.propertyName?.text ?? item.name.text)) controls.add(item.name.text);
      }
    }
  }
  const isControl = (tag) => CONTROL_TAG.test(tag) || controls.has(tag);
  function visit(node) {
    if (literal(node)) {
      for (const match of node.text.matchAll(RAW_UTIL)) add("literal-color", match[1]);
      for (const match of node.text.matchAll(ARBITRARY_COLOR)) {
        if (rawColor(match[1])) add("literal-color", match[0]);
      }
    }
    if (ts.isJsxAttribute(node) && /^(?:color|fill|stroke|stopColor|floodColor)$/.test(node.name.getText(tree)) && node.initializer) {
      const tag = node.parent.parent.tagName.getText(tree);
      if (/^[a-z]/.test(tag)) follow(node.initializer, (value) => {
        if (literal(value) && rawColor(value.text)) add("inline-color", `<${tag}> ${node.name.getText(tree)}: ${value.text}`);
      });
    }
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "style" && node.initializer) {
      const tag = node.parent.parent.tagName.getText(tree);
      function styleValue(child) {
        if (ts.isPropertyAssignment(child)) {
          const property = child.name.getText(tree).replace(/["']/g, "");
          if (isControl(tag) && !CONTROL_OWNERS.has(file) && CONTROL_PROPERTY.test(property)) add("control-override", `<${tag}> style.${property}`);
          if (COLOR_PROPERTY.test(property) || property.startsWith("--")) {
            follow(child.initializer, (value) => {
              if (literal(value) && rawColor(value.text)) add("inline-color", `${property}: ${value.text}`);
            });
          }
        }
      }
      follow(node.initializer, styleValue);
    }
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "className" && node.initializer && !CONTROL_OWNERS.has(file)) {
      const tag = node.parent.parent.tagName.getText(tree);
      if (isControl(tag)) {
        follow(node.initializer, (child) => {
          if (literal(child)) {
            for (const token of child.text.split(/\s+/)) {
              if (CONTROL_STYLE.test(token.replace(/^(?:[\w-]+:|!)+/, "").replace(/!$/, ""))) add("control-override", `<${tag}> ${token}`);
            }
          }
        }, true);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { tree, findings };
}

export function inspectCss(file, source, adminOwned = false) {
  const findings = [];
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const isAdmin = /\.admin-[\w-]+/.test(selector);
    if (!isAdmin && file !== TOKENS && !adminOwned) continue;
    if (file !== TOKENS && /\.admin-(?:button|input|textarea|form-control|toggle|select|tab)(?:[\w-]*)(?=[\s.:#[>,+~]|$)/.test(selector)) {
      findings.push({ file, rule: "control-owner", detail: selector.trim().replace(/\s+/g, " ") });
    }
    const body = file === TOKENS && selector.trim() === ".admin-theme-root"
      ? declarations.replace(/--[\w-]+\s*:[^;]+;/g, "") : declarations;
    for (const match of body.matchAll(/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([^;{}]*/gi)) {
      findings.push({ file, rule: "literal-color", detail: match[0].trim() });
    }
    for (const match of body.matchAll(CSS_COLOR_PROPERTY)) {
      const value = match[1].trim();
      if (/^[a-z]+$/i.test(value) && rawColor(value)) findings.push({ file, rule: "literal-color", detail: value });
    }
  }
  return findings;
}

export function compareAllowances(findings, allowances) {
  const actual = new Map();
  for (const finding of findings) actual.set(key(finding), (actual.get(key(finding)) ?? 0) + 1);
  const allowed = new Map();
  const failures = [];
  for (const item of allowances) {
    if (!Number.isInteger(item.count) || item.count < 1 || !item.reason?.trim() || allowed.has(key(item))) {
      failures.push(`Invalid or duplicate exception: ${key(item)}`);
    }
    allowed.set(key(item), item.count);
  }
  for (const [signature, count] of actual) {
    if (count > (allowed.get(signature) ?? 0)) failures.push(`New theme violation (${count}): ${signature}`);
  }
  for (const [signature, count] of allowed) {
    if ((actual.get(signature) ?? 0) < count) failures.push(`Remove or reduce resolved legacy exception: ${signature}`);
  }
  return failures;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(name));
    else if (/\.(?:tsx?|jsx?|mjs|css)$/.test(name) && !/\.(?:(?:test|spec)\.(?:tsx?|jsx?|mjs)|d\.ts)$/.test(name)) files.push(name);
  }
  return files;
}

function isStudioBrowserOwner(file) {
  return /^apps\/web\/components\/(?:studio\/studio-(?:browser-|preset-browser|reference-library|project-browser|project-row)|media\/media-browser-)/.test(file) || file === `${WEB}app/studio-browsers.css`;
}

export async function inspectRepo(root) {
  const files = (await sourceFiles(path.join(root, WEB))).map((name) => path.relative(root, name).split(path.sep).join("/")).sort();
  const sources = new Map();
  const parsed = new Map();
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    sources.set(file, source);
    if (!file.endsWith(".css")) parsed.set(file, inspectSource(file, source));
  }
  const dependencies = new Map();
  const redirects = new Set();
  for (const [file, { tree }] of parsed) {
    const imports = [];
    const redirectNames = new Set();
    function collect(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (!node.importClause?.isTypeOnly && !node.isTypeOnly) imports.push(node.moduleSpecifier.text);
        if (node.moduleSpecifier.text === "next/navigation" && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const item of node.importClause.namedBindings.elements) {
            if (["redirect", "permanentRedirect"].includes(item.propertyName?.text ?? item.name.text)) redirectNames.add(item.name.text);
          }
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, collect);
    }
    collect(tree);
    function redirectCall(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && redirectNames.has(node.expression.text)) redirects.add(file);
      ts.forEachChild(node, redirectCall);
    }
    redirectCall(tree);
    dependencies.set(file, imports.flatMap((name) => {
      const base = name.startsWith("@/") ? `${WEB}${name.slice(2)}` : name.startsWith(".") ? path.posix.join(path.posix.dirname(file), name) : null;
      if (!base) return [];
      const resolved = [base, ...["tsx", "ts", "jsx", "js", "mjs"].flatMap((ext) => [`${base}.${ext}`, `${base}/index.${ext}`])].find((candidate) => sources.has(candidate));
      return resolved ? [resolved] : [];
    }));
  }
  function reachable(start) {
    const seen = new Set();
    function add(file) { if (!seen.has(file)) { seen.add(file); for (const child of dependencies.get(file) ?? []) add(child); } }
    add(start);
    return seen;
  }
  const seeds = files.filter((file) => ROUTES.test(file) || /^apps\/web\/components\/(?:admin-|settings\/|studio-admin-shell)/.test(file));
  const pages = seeds.filter((file) => /\/page\.(?:tsx?|jsx?)$/.test(file));
  function pageRoots(file) {
    const roots = [file];
    for (let dir = path.posix.dirname(file); dir.startsWith(`${WEB}app`); dir = path.posix.dirname(dir)) {
      for (const name of ["layout", "template"]) {
        const companion = ["tsx", "ts", "jsx", "js"].map((ext) => `${dir}/${name}.${ext}`).find((candidate) => sources.has(candidate));
        if (companion) roots.push(companion);
      }
    }
    return roots;
  }
  const scoped = new Set([...seeds, ...pages.flatMap(pageRoots)].flatMap((file) => [...reachable(file)]));
  // Modal compositions share the token/control contract without being admin pages.
  files.filter(isStudioBrowserOwner).forEach((file) => scoped.add(file));
  const findings = [];
  for (const file of scoped) findings.push(...(parsed.get(file)?.findings ?? []));
  for (const file of files.filter((name) => name.endsWith(".css"))) findings.push(...inspectCss(file, sources.get(file), scoped.has(file) && file !== `${WEB}app/globals.css`));
  for (const file of pages) {
    if (!redirects.has(file) && !pageRoots(file).some((root) => reachable(root).has(SHELL))) findings.push({ file, rule: "admin-shell", detail: "Page or its layout must reach StudioAdminShell through imports, or redirect." });
  }
  return { findings, sourceCount: scoped.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { findings, sourceCount } = await inspectRepo(ROOT);
  const exceptions = JSON.parse(await readFile(path.join(ROOT, "scripts/admin-theme-exceptions.json"), "utf8"));
  const failures = compareAllowances(findings, exceptions);
  if (failures.length) {
    console.error(`Admin theme check failed:\n${failures.map((item) => `- ${item}`).join("\n")}\nUse semantic tokens in apps/web/app/admin.css and existing shared control owners; resolve violations rather than widening exceptions.`);
    process.exitCode = 1;
  } else console.log(`Admin theme contracts passed (${sourceCount} reachable files; ${exceptions.length} explicit legacy exceptions).`);
}
