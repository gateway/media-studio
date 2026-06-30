#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const dbPath = resolve(repoRoot, "data/media-studio.db");
const reportsDir = resolve(repoRoot, "docs/development/reports");
const keepListPath = resolve(repoRoot, "docs/development/media-preset-cleanup-keep-list.json");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = args.has("--confirm-archive-smoke-presets");
const strategyArg = process.argv.find((arg) => arg.startsWith("--strategy="));
const strategy = strategyArg ? strategyArg.split("=").slice(1).join("=").trim() : "smoke";
const allowedStrategies = new Set(["smoke", "unattached"]);
const familyArg = process.argv.find((arg) => arg.startsWith("--family="));
const family = familyArg ? familyArg.split("=").slice(1).join("=").trim() : null;
const allowedFamilies = new Set(["storyboard-character-sheet-generator"]);

const defaultInstallPresetKeys = new Set([
  "2x2-pose-grid",
  "3d-caricature-style-nano-banana",
  "exploding-food",
  "food-recipe-infographic",
  "giant-animal-anywhere",
  "photo-restoration",
  "selfie-with-movie-character-nano-banana",
]);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runSqlJson(sql, params = []) {
  const result = execFileSync("sqlite3", ["-json", dbPath, sql, ...params], { encoding: "utf8" });
  return result.trim() ? JSON.parse(result) : [];
}

function runSql(sql) {
  const result = spawnSync("sqlite3", [dbPath, sql], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`sqlite3 failed with exit code ${result.status}`);
  }
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function loadKeepList() {
  if (!existsSync(keepListPath)) return new Set();
  const parsed = JSON.parse(readFileSync(keepListPath, "utf8"));
  const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed.keep) ? parsed.keep : [];
  return new Set(values.map((item) => normalize(item)).filter(Boolean));
}

function loadProtectedPresetContext() {
  const studioImageKeys = new Set(
    runSqlJson(`
      SELECT DISTINCT preset_key AS key
      FROM media_assets
      WHERE generation_kind = 'image'
        AND COALESCE(preset_key, '') != ''
    `)
      .map((row) => normalize(row.key))
      .filter(Boolean),
  );
  return { studioImageKeys };
}

function protectionReason(preset, keep, context) {
  const presetId = normalize(preset.preset_id);
  const key = normalize(preset.key);
  const label = normalize(preset.label);
  const thumbnailPath = String(preset.thumbnail_path ?? "").trim();
  const thumbnailUrl = String(preset.thumbnail_url ?? "").trim();
  if ([presetId, key, label].some((value) => keep.has(value))) return "keep-list protected";
  if (context.studioImageKeys.has(key)) return "referenced by Studio image asset";
  if (thumbnailPath || thumbnailUrl) return "has preset thumbnail / Studio image";
  if (defaultInstallPresetKeys.has(key)) return "default install preset key";
  if (presetId.startsWith("media-preset-")) return "default install preset id";
  if (thumbnailPath.startsWith("preset-thumbnails/")) return "default install packaged thumbnail";
  return null;
}

function classifyPreset(preset) {
  const key = normalize(preset.key);
  const label = normalize(preset.label);
  const sourceKind = normalize(preset.source_kind);
  if (key.startsWith("storyboard_character_sheet_generator_attachment_test_")) return "storyboard attachment smoke test";
  if (key.startsWith("assistant_prefix_style_")) return "assistant prefix style smoke preset";
  if (key.startsWith("shared_style_")) return "shared style matrix smoke preset";
  if (key.startsWith("text_only_style_preset_")) return "text-only style proof preset";
  if (key.startsWith("travel_poster_preset_")) return "travel poster proof preset";
  if (key.includes("smoke") || label.includes("smoke")) return "explicit smoke/test preset";
  if (key.includes("workflow-only") || label.includes("workflow-only")) return "workflow-only proof preset";
  if (sourceKind === "smoke_test" || sourceKind === "test") return "test source kind";
  return null;
}

function candidateReasonForStrategy(preset, strategyName) {
  return strategyName === "unattached"
    ? "unattached preset: no Studio image asset, no thumbnail, not default install, not keep-listed"
    : classifyPreset(preset);
}

function matchesFamily(preset) {
  if (!family) return true;
  const key = normalize(preset.key);
  const label = normalize(preset.label);
  if (family === "storyboard-character-sheet-generator") {
    return key.includes("storyboard_character_sheet_generator") || label.startsWith("storyboard character sheet generator");
  }
  return false;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  if (apply && !confirmed) {
    throw new Error("--apply requires --confirm-archive-smoke-presets. This script never hard-deletes; it only archives reviewed candidates.");
  }
  if (!allowedStrategies.has(strategy)) {
    throw new Error(`Unsupported --strategy=${strategy}. Use one of: ${Array.from(allowedStrategies).join(", ")}.`);
  }
  if (family && !allowedFamilies.has(family)) {
    throw new Error(`Unsupported --family=${family}. Use one of: ${Array.from(allowedFamilies).join(", ")}.`);
  }
  mkdirSync(reportsDir, { recursive: true });
  const keep = loadKeepList();
  const protectedContext = loadProtectedPresetContext();
  const allPresets = runSqlJson(`
    SELECT preset_id, key, label, status, source_kind, thumbnail_path, thumbnail_url, created_at, updated_at
    FROM media_presets
    WHERE status != 'archived'
    ORDER BY updated_at DESC, key ASC
  `);
  const presets = allPresets.filter(matchesFamily);
  const candidates = [];
  const protectedRows = [];
  const ambiguous = [];
  for (const preset of presets) {
    const protectedReason = protectionReason(preset, keep, protectedContext);
    if (protectedReason) {
      protectedRows.push({ ...preset, reason: protectedReason });
      continue;
    }
    const reason = candidateReasonForStrategy(preset, strategy);
    if (reason) {
      candidates.push({ ...preset, reason });
    } else {
      ambiguous.push(preset);
    }
  }

  const now = timestamp();
  const report = {
    generated_at: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    strategy,
    family,
    database: dbPath,
    keep_list: keepListPath,
    totals: {
      active_before_all: allPresets.length,
      active_before: presets.length,
      candidates: candidates.length,
      protected: protectedRows.length,
      ambiguous: ambiguous.length,
      studio_image_preset_keys: protectedContext.studioImageKeys.size,
    },
    candidates,
    protected: protectedRows,
    ambiguous_sample: ambiguous.slice(0, 100),
  };
  const familyPart = family ? `-${family}` : "";
  const reportPrefix = `media-preset-cleanup-${strategy}${familyPart}-${apply ? "apply" : "dry-run"}-${now}`;
  const jsonPath = join(reportsDir, `${reportPrefix}.json`);
  const csvPath = join(reportsDir, `${reportPrefix}.csv`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(
    csvPath,
    [
      ["preset_id", "key", "label", "status", "source_kind", "created_at", "updated_at", "reason"].join(","),
      ...candidates.map((preset) =>
        [preset.preset_id, preset.key, preset.label, preset.status, preset.source_kind, preset.created_at, preset.updated_at, preset.reason]
          .map(csvEscape)
          .join(","),
      ),
    ].join("\n"),
  );

  let backupPath = null;
  if (apply && candidates.length) {
    backupPath = resolve(repoRoot, `data/backups/media-studio-before-preset-cleanup-${now}.db`);
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(dbPath, backupPath);
    const ids = candidates.map((preset) => String(preset.preset_id).replace(/'/g, "''"));
    const idList = ids.map((id) => `'${id}'`).join(",");
    runSql(`UPDATE media_presets SET status = 'archived', updated_at = datetime('now') WHERE preset_id IN (${idList});`);
  }
  const afterCounts = runSqlJson(`
    SELECT status, COUNT(*) AS count
    FROM media_presets
    GROUP BY status
    ORDER BY status
  `);

  console.log(JSON.stringify({
    mode: report.mode,
    strategy,
    family,
    active_before_all: allPresets.length,
    active_before: presets.length,
    candidates: candidates.length,
    protected: protectedRows.length,
    ambiguous: ambiguous.length,
    json_report: jsonPath,
    csv_report: csvPath,
    backup: backupPath,
    counts_after: afterCounts,
    applied: Boolean(apply),
  }, null, 2));
}

export {
  candidateReasonForStrategy,
  classifyPreset,
  defaultInstallPresetKeys,
  normalize,
  protectionReason,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
