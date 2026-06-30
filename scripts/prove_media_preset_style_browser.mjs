#!/usr/bin/env node
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(ROOT, "data", "outputs");
const REPORT_DIR = path.join(ROOT, "docs", "development", "reports");
const API_URL = process.env.MEDIA_STUDIO_API_URL || "http://127.0.0.1:8000";
const DEFAULT_LOCAL_CONTROL_API_TOKEN = "media-studio-local-control-token";

const STYLE_PROMPTS = {
  t2i:
    "Create me a text-to-image media preset from this reference image. Suggest the best editable fields, then create a test workflow after I confirm.",
  i2i:
    "Create me an image-to-image media preset from this reference image with one input image. Suggest the best image input type and one or two editable fields, then create a test workflow after I confirm.",
};

function arg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const exactIndex = process.argv.indexOf(`--${name}`);
  if (exactIndex >= 0) return process.argv[exactIndex + 1] ?? fallback;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function requireArg(name) {
  const value = arg(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function loadDotEnv() {
  const text = await fs.readFile(path.join(ROOT, ".env"), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function controlApi(pathname) {
  const token = process.env.MEDIA_STUDIO_CONTROL_API_TOKEN || DEFAULT_LOCAL_CONTROL_API_TOKEN;
  const response = await fetch(`${API_URL}${pathname}`, {
    headers: {
      "x-media-studio-control-token": token,
      "x-media-studio-access-mode": "admin",
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed ${response.status}: ${String(text).slice(0, 500)}`);
  }
  return payload;
}

function timestampMs(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

async function resolveSavedPresetExact(label, startedAtMs) {
  const query = encodeURIComponent(label);
  const payload = await controlApi(`/media/presets/search?limit=100&status=active&q=${query}`);
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const normalizedLabel = label.trim().toLowerCase();
  const matches = items
    .filter((item) => String(item.label || "").trim().toLowerCase() === normalizedLabel)
    .sort((a, b) => Math.max(timestampMs(b.updated_at), timestampMs(b.created_at)) - Math.max(timestampMs(a.updated_at), timestampMs(a.created_at)));
  const fresh = matches.find((item) => Math.max(timestampMs(item.updated_at), timestampMs(item.created_at)) >= startedAtMs - 60_000);
  const record = fresh || matches[0];
  if (!record?.preset_id || !record?.key) {
    throw new Error(`Could not resolve exact preset id/key for saved label: ${label}`);
  }
  return {
    preset_id: String(record.preset_id),
    key: String(record.key),
    label: String(record.label || label),
    updated_at: record.updated_at,
    created_at: record.created_at,
  };
}

async function newestOutputSince(startTimeMs) {
  const dayDirs = await fs.readdir(OUTPUT_ROOT).catch(() => []);
  const candidates = [];
  for (const day of dayDirs) {
    const fullDay = path.join(OUTPUT_ROOT, day);
    const stat = await fs.stat(fullDay).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const jobs = await fs.readdir(fullDay).catch(() => []);
    for (const job of jobs) {
      const output = path.join(fullDay, job, "original", "output_01.png");
      const outputStat = await fs.stat(output).catch(() => null);
      if (outputStat && outputStat.mtimeMs >= startTimeMs) {
        candidates.push({ path: output, mtimeMs: outputStat.mtimeMs });
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

function assertCleanPrompt(prompt) {
  const forbidden = [
    "Graph Studio",
    "temporary sandbox",
    "sandbox",
    "runtime image input",
    "chat context",
    "Media Preset",
    "Runnable",
    "{{choice:",
  ];
  const hit = forbidden.find((term) => prompt.toLowerCase().includes(term.toLowerCase()));
  if (hit) {
    throw new Error(`Prompt contains forbidden product/meta text: ${hit}`);
  }
  if (prompt.length < 700) {
    throw new Error(`Prompt is too short for a high-quality style preset: ${prompt.length} chars`);
  }
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 15000 });
}

async function ensureAssistant(page) {
  if (await page.getByLabel("Show Media Assistant").count()) {
    await page.getByLabel("Show Media Assistant").click();
    await page.waitForTimeout(800);
  }
  const mediaPresetButton = page.locator("button.graph-assistant-mode-button", {
    hasText: /Media Presets/i,
  });
  if (await mediaPresetButton.count()) {
    await mediaPresetButton.first().click();
    await page.waitForTimeout(500);
  }
}

async function attachReference(page, filename) {
  await page.getByLabel("Choose existing reference image").first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Choose a reference image"), null, {
    timeout: 30000,
  });
  const button = page.locator(`button[aria-label="Use ${filename}"]`);
  await button.click({ timeout: 30000 });
  await page.getByText("1 / 8").waitFor({ timeout: 30000 });
}

async function sendAssistant(page, message) {
  const box = page.locator('textarea[aria-label="Assistant message"]');
  await box.fill(message);
  await page.getByLabel("Send chat message").click();
}

async function verifyPromptRecall(page, prompt) {
  await ensureAssistant(page);
  await sendAssistant(page, "Can you give me the prompt that you used?");
  const requiredSnippet = prompt.slice(0, 180);
  await page.waitForFunction(
    (snippet) =>
      document.body.innerText.includes("Here is the current test workflow prompt") &&
      document.body.innerText.includes(snippet),
    requiredSnippet,
    { timeout: 60000 },
  );
}

async function createTestWorkflow(page, mode) {
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("CREATE TEST WORKFLOW") ||
      document.body.innerText.includes("Create test workflow"),
    null,
    { timeout: 180000 },
  );
  await page.getByRole("button", { name: /Create test workflow/i }).last().click();
  await page.waitForFunction(() => document.body.innerText.includes("APPLY WORKFLOW"), null, {
    timeout: 180000,
  });
  const plan = await bodyText(page);
  if (mode === "t2i" && !/0 image inputs/i.test(plan)) {
    throw new Error("T2I plan did not show 0 image inputs.");
  }
  if (mode === "i2i" && !/[1-9][0-9]* image input/i.test(plan)) {
    throw new Error("I2I plan did not show at least 1 image input.");
  }
  const applyButtons = page.locator(
    'button[aria-label="Apply reviewed workflow"], button[aria-label="Apply reviewed graph plan"]',
  );
  const count = await applyButtons.count();
  if (!count) {
    throw new Error("Could not find the current apply workflow button.");
  }
  await applyButtons.nth(count - 1).click({ force: true });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("textarea")).some((el) => {
        const value = el.value || "";
        return value.length > 700 && !/Preset mode:/i.test(value);
      }),
    null,
    { timeout: 60000 },
  );
}

async function extractPrompt(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("textarea")).some((el) => {
        const value = el.value || "";
        return value.length > 700 && !/Preset mode:/i.test(value);
      }),
    null,
    { timeout: 60000 },
  );
  const values = await page.locator("textarea").evaluateAll((els) =>
    els.map((el, i) => ({
      i,
      aria: el.getAttribute("aria-label"),
      placeholder: el.getAttribute("placeholder"),
      value: el.value || "",
    })),
  );
  const prompt = values
    .map((entry) => entry.value)
    .filter((value) => value.length > 700)
    .sort((a, b) => b.length - a.length)[0];
  if (!prompt) {
    throw new Error("Could not find a generated prompt textarea.");
  }
  assertCleanPrompt(prompt);
  return prompt;
}

async function attachRuntimeImage(page, filename) {
  async function visiblePicker(selector) {
    let locator = page.locator(`.react-flow__node ${selector}:visible`);
    let count = await locator.count();
    if (!count) {
      const fit = page.getByRole("button", { name: "Fit View" });
      if (await fit.count()) {
        await fit.click({ force: true, timeout: 10000 });
        await page.waitForTimeout(1000);
      }
      locator = page.locator(`.react-flow__node ${selector}:visible`);
      count = await locator.count();
    }
    if (!count) {
      locator = page.locator(`${selector}:visible`);
      count = await locator.count();
    }
    return { locator, count };
  }

  const emptyPickers = await visiblePicker('button[aria-label="Choose media from library"]');
  const emptyCount = emptyPickers.count;
  if (emptyCount > 0) {
    await emptyPickers.locator.nth(emptyCount - 1).click({ force: true, timeout: 30000 });
  } else {
    const replacePickers = await visiblePicker('button[aria-label="Replace media from library"]');
    const replaceCount = replacePickers.count;
    if (!replaceCount) {
      throw new Error("Could not find a graph media library picker for runtime image attachment.");
    }
    await replacePickers.locator.nth(replaceCount - 1).click({ force: true, timeout: 30000 });
  }
  const dialog = page.getByRole("dialog", { name: "Media library" });
  await dialog.waitFor({ timeout: 30000 });
  const libraryButton = dialog.locator("button").filter({ hasText: filename });
  const matchCount = await libraryButton.count();
  if (!matchCount) {
    const available = await dialog.locator("button span").allTextContents({ timeout: 5000 }).catch(() => []);
    throw new Error(`Could not find runtime image ${filename} in media library. Available: ${available.slice(0, 30).join(", ")}`);
  }
  await libraryButton.nth(0).click({ force: true, timeout: 30000 });
  await page.waitForFunction(
    (name) => document.body.innerText.includes(name) || document.body.innerText.includes("Replace"),
    filename,
    { timeout: 30000 },
  );
}

async function runGraph(page) {
  const startedAt = Date.now();
  await page.getByRole("button", { name: /^Run$/ }).click();
  const deadline = Date.now() + 480000;
  let detectedOutput = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    const text = await bodyText(page).catch(() => "");
    detectedOutput = await newestOutputSince(startedAt);
    if (/Artifact publish failed|failed/i.test(text) && !/0 failed/i.test(text)) {
      throw new Error(text.match(/Artifact publish failed[^\n]*/)?.[0] ?? "Run failed");
    }
    if (/Completed/.test(text) && /Preview/.test(text) && !/Cancel/.test(text) && !/Queued|Running/i.test(text)) {
      break;
    }
    if (detectedOutput && Date.now() - startedAt > 15000) {
      break;
    }
  }
  return detectedOutput ?? newestOutputSince(startedAt);
}

async function savePreset(page, mode) {
  await ensureAssistant(page);
  await sendAssistant(
    page,
    `Save this approved ${mode === "i2i" ? "image-to-image" : "text-to-image"} test workflow as a media preset. Use the latest generated image as the thumbnail.`,
  );
  await page.waitForFunction(() => document.body.innerText.includes("MEDIA PRESET SAVED"), null, {
    timeout: 180000,
  });
  await page.waitForTimeout(3000);
  const text = await bodyText(page);
  const labels = [...text.matchAll(/Saved Media Preset: ([^\n.]+(?:\.[^\n]+)?)/g)];
  const label = labels.at(-1)?.[1]?.trim() ?? null;
  if (!label || /^Save this approved/i.test(label)) {
    throw new Error(`Bad saved preset label: ${label}`);
  }
  return label.replace(/\.$/, "");
}

async function testSavedPreset(page, presetLabel) {
  const testButton = page.locator(`button[aria-label^="Use ${presetLabel.replaceAll('"', '\\"')}"]`).last();
  await testButton.click({ timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes("APPLY WORKFLOW"), null, {
    timeout: 180000,
  });
  await page.locator('button[aria-label="Apply reviewed workflow"]').click({ force: true });
  await page.waitForTimeout(5000);
  return runGraph(page);
}

async function main() {
  await loadDotEnv();
  const verifyPresetId = arg("verify-preset-id", "");
  const verifyPresetKey = arg("verify-preset-key", "");
  const verifyPresetLabel = arg("preset-label", "Saved Media Preset");
  const style = arg("style", verifyPresetId ? "saved-preset" : undefined);
  if (!style) throw new Error("Missing required --style");
  const mode = requireArg("mode");
  const stopAfterWorkflow = Boolean(arg("stop-after-workflow", false));
  const checkPromptRecall = Boolean(arg("check-prompt-recall", false));
  const runtimeImage = arg("runtime-image", "IMG_0308.jpeg");
  if (!["t2i", "i2i"].includes(mode)) throw new Error(`Unsupported --mode=${mode}`);

  const browser = await chromium.launch({
    headless: false,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(30000);

  const record = {
    style,
    mode,
    started_at: new Date().toISOString(),
    prompt_chars: 0,
    prompt: null,
    test_output: null,
    preset_label: null,
    preset_id: null,
    preset_key: null,
    saved_preset_output: null,
    screenshots: [],
  };
  const startedAtMs = Date.now();

  try {
    await page.goto("http://127.0.0.1:3000/graph-studio", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1500);
    await page.getByLabel("New workflow tab").click();
    await page.waitForTimeout(1000);
    await ensureAssistant(page);
    if (verifyPresetId || verifyPresetKey) {
      if (!verifyPresetId || !verifyPresetKey) {
        throw new Error("Verify-only mode requires both --verify-preset-id and --verify-preset-key.");
      }
      record.preset_label = verifyPresetLabel;
      record.preset_id = verifyPresetId;
      record.preset_key = verifyPresetKey;
      await sendAssistant(
        page,
        `Create a saved-preset verification workflow using exact Media Preset id ${verifyPresetId} and key ${verifyPresetKey}. Use the saved_media_preset_test_v1 template. Do not match by label.`,
      );
      await page.waitForFunction(
        ({ presetId, presetKey }) =>
          document.body.innerText.includes("APPLY WORKFLOW") &&
          (document.body.innerText.includes(presetId) || document.body.innerText.includes(presetKey)),
        { presetId: verifyPresetId, presetKey: verifyPresetKey },
        { timeout: 180000 },
      );
      const exactPlanText = await bodyText(page);
      if (!exactPlanText.includes(verifyPresetId) && !exactPlanText.includes(verifyPresetKey)) {
        throw new Error(`Verify-only plan did not show exact id/key ${verifyPresetId} / ${verifyPresetKey}`);
      }
      const applyButtons = page.locator(
        'button[aria-label="Apply reviewed workflow"], button[aria-label="Apply reviewed graph plan"]',
      );
      const applyCount = await applyButtons.count();
      if (!applyCount) throw new Error("Could not find verify-only apply workflow button.");
      await applyButtons.nth(applyCount - 1).click({ force: true });
      await page.waitForTimeout(5000);
      if (mode === "i2i") {
        await attachRuntimeImage(page, runtimeImage);
        console.log(`[${style} ${mode}] verify-only runtime image attached: ${runtimeImage}`);
      }
      record.saved_preset_output = await runGraph(page);
      console.log(`[${style} ${mode}] verify-only saved preset output: ${record.saved_preset_output}`);
      record.completed_at = new Date().toISOString();
      await fs.mkdir(REPORT_DIR, { recursive: true });
      const reportPath = path.join(REPORT_DIR, `media-preset-proof-${style}-${mode}-verify-only-${Date.now()}.json`);
      await fs.writeFile(reportPath, JSON.stringify(record, null, 2));
      console.log(JSON.stringify({ ok: true, reportPath, record }, null, 2));
      return;
    }
    await attachReference(page, style);
    await ensureAssistant(page);
    console.log(`[${style} ${mode}] reference attached`);
    await sendAssistant(page, STYLE_PROMPTS[mode]);
    await createTestWorkflow(page, mode);
    console.log(`[${style} ${mode}] test workflow applied`);
    const prompt = await extractPrompt(page);
    record.prompt = prompt;
    record.prompt_chars = prompt.length;
    console.log(`[${style} ${mode}] prompt accepted (${prompt.length} chars)`);
    if (checkPromptRecall) {
      await verifyPromptRecall(page, prompt);
      record.prompt_recall_ok = true;
      console.log(`[${style} ${mode}] prompt recall verified`);
    }
    record.screenshots.push(`/tmp/media-studio-${style}-${mode}-workflow.png`);
    await page.screenshot({ path: record.screenshots.at(-1), fullPage: false });
    if (stopAfterWorkflow) {
      record.completed_at = new Date().toISOString();
      await fs.mkdir(REPORT_DIR, { recursive: true });
      const reportPath = path.join(REPORT_DIR, `media-preset-proof-${style}-${mode}-workflow-only-${Date.now()}.json`);
      await fs.writeFile(reportPath, JSON.stringify(record, null, 2));
      console.log(JSON.stringify({ ok: true, stoppedAfterWorkflow: true, reportPath, record }, null, 2));
      return;
    }
    if (mode === "i2i") {
      await attachRuntimeImage(page, runtimeImage);
      console.log(`[${style} ${mode}] runtime image attached: ${runtimeImage}`);
    }
    record.test_output = await runGraph(page);
    console.log(`[${style} ${mode}] test output: ${record.test_output}`);
    record.preset_label = await savePreset(page, mode);
    console.log(`[${style} ${mode}] saved preset: ${record.preset_label}`);
    const exactPreset = await resolveSavedPresetExact(record.preset_label, startedAtMs);
    record.preset_id = exactPreset.preset_id;
    record.preset_key = exactPreset.key;
    console.log(`[${style} ${mode}] exact saved preset: ${record.preset_id} / ${record.preset_key}`);
    await ensureAssistant(page);
    await sendAssistant(
      page,
      `Create a saved-preset verification workflow using exact Media Preset id ${exactPreset.preset_id} and key ${exactPreset.key}. Use the saved_media_preset_test_v1 template. Do not match by label.`,
    );
    await page.waitForFunction(
      ({ presetId, presetKey }) =>
        document.body.innerText.includes("APPLY WORKFLOW") &&
        (document.body.innerText.includes(presetId) || document.body.innerText.includes(presetKey)),
      { presetId: exactPreset.preset_id, presetKey: exactPreset.key },
      { timeout: 180000 },
    );
    const exactPlanText = await bodyText(page);
    if (!exactPlanText.includes(exactPreset.preset_id) && !exactPlanText.includes(exactPreset.key)) {
      throw new Error(`Saved-preset verification plan did not show exact id/key ${exactPreset.preset_id} / ${exactPreset.key}`);
    }
    const applyExactButtons = page.locator(
      'button[aria-label="Apply reviewed workflow"], button[aria-label="Apply reviewed graph plan"]',
    );
    const exactApplyCount = await applyExactButtons.count();
    if (!exactApplyCount) {
      throw new Error("Could not find exact saved-preset apply workflow button.");
    }
    await applyExactButtons.nth(exactApplyCount - 1).click({ force: true });
    await page.waitForTimeout(5000);
    if (mode === "i2i") {
      await attachRuntimeImage(page, runtimeImage);
      console.log(`[${style} ${mode}] saved preset runtime image attached: ${runtimeImage}`);
    }
    record.saved_preset_output = await runGraph(page);
    console.log(`[${style} ${mode}] saved preset output: ${record.saved_preset_output}`);
    record.completed_at = new Date().toISOString();
    await fs.mkdir(REPORT_DIR, { recursive: true });
    const reportPath = path.join(REPORT_DIR, `media-preset-proof-${style}-${mode}-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(record, null, 2));
    console.log(JSON.stringify({ ok: true, reportPath, record }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
