#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const webRoot = path.join(root, "apps", "web");
const allowedExtensions = new Set([".ts", ".tsx", ".mjs"]);
const ignoredDirectories = new Set(["node_modules", ".next"]);
const bannedPatterns = [
  { regex: /\bconsole\.(log|debug|info)\s*\(/g, label: "console log/debug/info" },
  { regex: /\bdebugger\s*;/g, label: "debugger statement" },
];
const singletonHelpers = new Map([
  ["toControlApiProxyPath", path.join("apps", "web", "lib", "media-paths.ts")],
  ["toControlApiDataProxyPath", path.join("apps", "web", "lib", "media-paths.ts")],
  ["toControlApiDataPreviewPath", path.join("apps", "web", "lib", "media-paths.ts")],
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      files.push(...(await walk(path.join(directory, entry.name))));
      continue;
    }
    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function collectDefinitionMatches(source, helperName) {
  const matcher = new RegExp(`\\b(?:export\\s+)?function\\s+${helperName}\\b|\\bconst\\s+${helperName}\\s*=`, "g");
  return [...source.matchAll(matcher)];
}

const failures = [];
const helperDefinitions = new Map([...singletonHelpers.keys()].map((name) => [name, []]));
const files = await walk(webRoot);

for (const file of files) {
  const source = await readFile(file, "utf8");
  const rel = relative(file);

  for (const rule of bannedPatterns) {
    if (rule.regex.test(source)) {
      failures.push(`${rel}: found ${rule.label}`);
    }
  }

  for (const helperName of singletonHelpers.keys()) {
    const matches = collectDefinitionMatches(source, helperName);
    if (matches.length) {
      helperDefinitions.get(helperName)?.push(rel);
    }
  }
}

for (const [helperName, expectedFile] of singletonHelpers.entries()) {
  const matches = helperDefinitions.get(helperName) ?? [];
  if (matches.length !== 1 || matches[0] !== expectedFile) {
    failures.push(
      `${helperName}: expected a single definition in ${expectedFile}, found ${matches.length ? matches.join(", ") : "none"}`,
    );
  }
}

if (failures.length) {
  console.error("Web lint failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Web lint passed for ${files.length} files.`);
