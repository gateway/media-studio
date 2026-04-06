import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-enhance-smoke.json");
const successShot = path.join(outputDir, "studio-browser-enhance-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-enhance-smoke-failure.png");
const referenceImagePath = path.resolve(process.cwd(), "docs", "images", "media-studio.jpg");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;
const controlApiBaseUrl = (process.env.STUDIO_CONTROL_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const controlApiToken = process.env.STUDIO_CONTROL_API_TOKEN ?? "media-studio-local-control-token";
const forceBuiltinEnhancement = process.env.STUDIO_ENHANCE_SMOKE_FORCE_BUILTIN === "1";

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

const summary = {
  ok: false,
  studio_url: studioUrl,
  original_prompt: null,
  enhanced_prompt: null,
  reference_image_path: referenceImagePath,
  screenshot: successShot,
};

async function ensureModelSelected(modelMatcher) {
  const picker = page.locator('[data-testid="studio-picker-model"]');
  await picker.waitFor({ state: "visible", timeout: 20000 });
  const currentLabel = ((await picker.textContent()) ?? "").trim();
  if (modelMatcher.test(currentLabel)) {
    return;
  }
  await picker.click();
  const options = page.locator('[data-testid^="studio-picker-option-model-"]');
  if ((await options.count()) === 0) {
    await picker.evaluate((node) => node.click());
  }
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="studio-picker-option-model-"]').length > 0,
    null,
    { timeout: 15000 },
  );
  const optionCount = await options.count();
  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    const label = ((await option.textContent()) ?? "").trim();
    if (modelMatcher.test(label)) {
      await option.click();
      return;
    }
  }
  throw new Error("No matching model option was found.");
}

async function forceBuiltinEnhancementConfig() {
  if (!forceBuiltinEnhancement) {
    return;
  }
  const payload = {
    model_key: "__studio_enhancement__",
    label: "Studio enhancement",
    helper_profile: "midctx-64k-no-thinking-q3-prefill",
    provider_kind: "builtin",
    provider_label: "builtin",
    provider_model_id: null,
    provider_api_key: null,
    provider_base_url: null,
    provider_supports_images: false,
    provider_status: "active",
    provider_last_tested_at: null,
    provider_capabilities_json: {},
    system_prompt: null,
    image_analysis_prompt: null,
    supports_text_enhancement: true,
    supports_image_analysis: false,
  };

  const response = await fetch(`${controlApiBaseUrl}/media/enhancement-configs/__studio_enhancement__`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-media-studio-control-token": controlApiToken,
      "x-media-studio-access-mode": "admin",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Unable to force builtin enhancement config for release smoke (${response.status}).`);
  }
}

async function waitForEnhancementBridge() {
  await page.waitForFunction(
    () =>
      typeof window.__mediaStudioTest?.enhancement?.openDialog === "function" &&
      typeof window.__mediaStudioTest?.enhancement?.requestPreview === "function" &&
      typeof window.__mediaStudioTest?.enhancement?.usePrompt === "function",
    null,
    { timeout: 20000 },
  );
}

try {
  await forceBuiltinEnhancementConfig();
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await waitForEnhancementBridge();

  await ensureModelSelected(/nano banana 2/i);
  await page.waitForTimeout(500);

  const originalPrompt = `Enhancement smoke ${new Date().toISOString()}  cinematic   photo-real portrait\nin neon rain`;
  summary.original_prompt = originalPrompt;

  const promptInput = page.locator('[data-testid="studio-prompt-input"]');
  await promptInput.fill(originalPrompt);
  await page.setInputFiles('[data-testid="studio-source-input"]', referenceImagePath);
  await page.waitForTimeout(800);

  await page.evaluate(() => window.__mediaStudioTest?.enhancement?.openDialog());
  await page.waitForSelector('[data-testid="studio-enhance-dialog"]', { timeout: 15000 });
  await page.evaluate(async () => {
    await window.__mediaStudioTest?.enhancement?.requestPreview();
  });

  await page.waitForFunction(() => {
    const preview = document.querySelector('[data-testid="studio-enhance-preview-text"]');
    const useButton = document.querySelector('[data-testid="studio-enhance-use-prompt-button"]');
    const previewText = preview?.textContent?.trim() ?? "";
    const disabled = useButton instanceof HTMLButtonElement ? useButton.disabled : true;
    return !disabled && previewText.length > 0 && previewText !== "Enhancing prompt..." && previewText !== "Run enhance to preview the rewritten prompt.";
  }, { timeout: 30000 });

  const enhancedPrompt = (await page.locator('[data-testid="studio-enhance-preview-text"]').textContent())?.trim() ?? "";
  summary.enhanced_prompt = enhancedPrompt;

  const usedPrompt = await page.evaluate(() => window.__mediaStudioTest?.enhancement?.usePrompt() ?? false);
  if (!usedPrompt) {
    throw new Error("Studio enhancement smoke could not load the enhanced prompt back into the composer.");
  }
  await page.waitForSelector('[data-testid="studio-enhance-dialog"]', { state: "hidden", timeout: 15000 });

  const updatedPrompt = await promptInput.inputValue();
  summary.ok = Boolean(enhancedPrompt) && updatedPrompt === enhancedPrompt && updatedPrompt !== originalPrompt;

  await page.screenshot({ path: successShot, fullPage: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    throw new Error("Studio enhancement smoke did not load the enhanced prompt back into the composer.");
  }
} catch (error) {
  try {
    await page.screenshot({ path: failureShot, fullPage: true });
  } catch {}
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
  summary.failure_screenshot = failureShot;
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}
