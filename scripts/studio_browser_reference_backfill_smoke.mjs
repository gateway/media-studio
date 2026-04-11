import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-reference-backfill-smoke.json");
const successShot = path.join(outputDir, "studio-browser-reference-backfill-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-reference-backfill-smoke-failure.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const summary = {
  ok: false,
  studio_url: studioUrl,
  summary_text: "",
  item_count: 0,
  screenshot: successShot,
};

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await page.waitForFunction(() => typeof window.__mediaStudioTest?.library?.open === "function", null, { timeout: 15000 });

  await page.evaluate(() => window.__mediaStudioTest?.library?.open());
  await page.waitForSelector('[data-testid="studio-reference-library"]', { timeout: 15000 });

  const scanButton = page.locator(
    '[data-testid="studio-reference-library-scan"], [data-testid="studio-reference-library-scan-empty"]',
  ).first();
  await scanButton.click();
  await page.waitForSelector('[data-testid="studio-reference-library-backfill-summary"]', { timeout: 30000 });

  summary.summary_text = ((await page.locator('[data-testid="studio-reference-library-backfill-summary"]').textContent()) ?? "").trim();
  summary.item_count = await page.locator('[data-testid^="studio-reference-library-item-"]').count();

  if (!/Scanned/i.test(summary.summary_text) || !/imported/i.test(summary.summary_text)) {
    throw new Error(`Unexpected backfill summary: ${summary.summary_text}`);
  }

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
