import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-composer-persistence-smoke.json");
const successShot = path.join(outputDir, "studio-browser-composer-persistence-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-composer-persistence-smoke-failure.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;
const settingsUrl = `${baseUrl}/settings`;

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const promptText = `persist composer draft ${new Date().toISOString()}`;
const summary = {
  ok: false,
  studio_url: studioUrl,
  settings_url: settingsUrl,
  prompt_persisted: false,
  model_persisted: false,
  output_count_persisted: false,
  screenshot: successShot,
};

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-prompt-input"]', { timeout: 60000 });
  await page.locator('[data-testid="studio-picker-model"]').click();
  await page.locator('[data-testid="studio-picker-option-model-nano-banana-2"]').click();
  await page.waitForFunction(() => {
    const model = document.querySelector('[data-testid="studio-picker-model"]');
    return (model?.textContent ?? "").toLowerCase().includes("nano banana 2");
  }, null, { timeout: 15000 });
  await page.locator('[data-testid="studio-prompt-input"]').last().fill(promptText);
  await page.locator('[data-testid="studio-picker-output-count"]').click();
  await page.locator('[data-testid="studio-picker-option-output-count-2"]').click();

  await page.goto(settingsUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Settings", { timeout: 60000 });
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-prompt-input"]', { timeout: 60000 });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const prompt = document.querySelector('[data-testid="studio-prompt-input"]');
    const output = document.querySelector('[data-testid="studio-picker-output-count"]');
    const model = document.querySelector('[data-testid="studio-picker-model"]');
    return {
      prompt: prompt instanceof HTMLTextAreaElement ? prompt.value : null,
      outputText: output?.textContent?.trim() ?? null,
      modelText: model?.textContent?.trim() ?? null,
    };
  });

  summary.prompt_persisted = result.prompt === promptText;
  summary.model_persisted = Boolean(result.modelText?.toLowerCase().includes("nano"));
  summary.output_count_persisted = Boolean(result.outputText?.includes("2"));
  summary.ok =
    summary.prompt_persisted &&
    summary.model_persisted &&
    summary.output_count_persisted;

  if (!summary.ok) {
    throw new Error(`Composer persistence smoke failed: ${JSON.stringify(result)}`);
  }

  await page.screenshot({ path: successShot, fullPage: true });
} catch (error) {
  summary.ok = false;
  summary.screenshot = failureShot;
  summary.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: failureShot, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await browser.close();
}
