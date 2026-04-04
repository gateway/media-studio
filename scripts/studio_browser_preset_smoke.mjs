import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-preset-smoke.json");
const successShot = path.join(outputDir, "studio-browser-preset-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-preset-smoke-failure.png");
const fixturePath = process.env.STUDIO_PRESET_SMOKE_IMAGE ?? path.resolve(process.cwd(), "docs", "images", "media-studio.jpg");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;

await fs.mkdir(outputDir, { recursive: true });
await fs.access(fixturePath);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

const summary = {
  ok: false,
  studio_url: studioUrl,
  fixture_path: fixturePath,
  selected_preset: null,
  selected_slot: null,
  queue_card_seen: false,
  screenshot: successShot,
};

async function clickPickerOption({ pickerId, matchers }) {
  await page.locator(`[data-testid="studio-picker-${pickerId}"]`).click();
  const options = page.locator(`[data-testid^="studio-picker-option-${pickerId}-"]`);
  const optionCount = await options.count();
  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    const label = (await option.textContent())?.trim() ?? "";
    if (matchers.some((matcher) => matcher.test(label))) {
      await option.click();
      return label;
    }
  }
  throw new Error(`No matching ${pickerId} option was found.`);
}

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });

  await clickPickerOption({
    pickerId: "model",
    matchers: [/nano banana pro/i],
  });

  summary.selected_preset = await clickPickerOption({
    pickerId: "preset",
    matchers: [/3d caricature/i, /caricature/i],
  });

  await page.waitForSelector('[data-testid^="studio-preset-slot-"]', { timeout: 20000 });
  const slotInput = page.locator('[data-testid^="studio-preset-slot-input-"]').first();
  const slotTestId = await slotInput.getAttribute("data-testid");
  summary.selected_slot = slotTestId ? slotTestId.replace("studio-preset-slot-input-", "") : null;

  await slotInput.setInputFiles(fixturePath);
  await page.waitForTimeout(800);

  const promptInput = page.locator('[data-testid="studio-prompt-input"]');
  if ((await promptInput.count()) > 0 && (await promptInput.first().isVisible())) {
    await promptInput.fill("Create a premium cinematic 3D caricature portrait.");
  }
  await page.locator('[data-testid="studio-generate-button"]').click();
  await page.waitForSelector('[data-testid="studio-gallery-batch-card"]', { timeout: 20000 });
  summary.queue_card_seen = true;

  await page.screenshot({ path: successShot, fullPage: true });
  summary.ok = true;
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
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
