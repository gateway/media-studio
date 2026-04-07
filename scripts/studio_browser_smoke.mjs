import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-smoke.json");
const successShot = path.join(outputDir, "studio-browser-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-smoke-failure.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

const summary = {
  ok: false,
  studio_url: studioUrl,
  generated_prompt: null,
  selected_asset_id: null,
  queue_card_seen: false,
  lightbox_seen: false,
  favorite_toggled: false,
  favorite_reverted: false,
  video_filter_used: false,
  duplicate_card_keys: [],
  screenshot: successShot,
};

function collectDuplicateKeys(cards) {
  const counts = new Map();
  for (const card of cards) {
    const key = card.jobId ? `job:${card.jobId}` : card.assetId ? `asset:${card.assetId}` : null;
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

async function ensureModelSelected(modelMatcher, modelKey) {
  const picker = page.locator('[data-testid="studio-picker-model"]');
  await picker.waitFor({ state: "visible", timeout: 20000 });
  const currentLabel = ((await picker.textContent()) ?? "").trim();
  if (modelMatcher.test(currentLabel)) {
    return;
  }
  await page
    .waitForFunction(() => typeof window.__mediaStudioTest?.composer?.setModel === "function", null, { timeout: 5000 })
    .catch(() => {});
  const hookApplied = await page.evaluate((targetModelKey) => {
    if (window.__mediaStudioTest?.composer?.setModel) {
      window.__mediaStudioTest.composer.setModel(targetModelKey);
      return true;
    }
    return false;
  }, modelKey);
  if (hookApplied) {
    await page.waitForTimeout(1000);
    return;
  }
  const options = page.locator('[data-testid^="studio-picker-option-model-"]');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await picker.click({ force: true });
    await page.waitForTimeout(250);
    if ((await options.count()) > 0) {
      break;
    }
    await picker.evaluate((node) => node.click());
    await page.waitForTimeout(250);
    if ((await options.count()) > 0) {
      break;
    }
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

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await ensureModelSelected(/nano banana 2/i, "nano-banana-2");
  await page.waitForTimeout(500);

  const prompt = `Browser smoke ${new Date().toISOString()} cinematic sci-fi portrait, photo-real lighting`;
  summary.generated_prompt = prompt;

  await page.locator('[data-testid="studio-prompt-input"]').fill(prompt);
  await page.locator('[data-testid="studio-generate-button"]').click();
  await page.waitForSelector('[data-testid="studio-gallery-batch-card"]', { timeout: 20000 });
  summary.queue_card_seen = true;

  const imageAssetCard = page.locator(
    '[data-testid="studio-gallery-card"][data-asset-id][data-generation-kind="image"]',
  ).first();
  const firstAssetCard =
    (await imageAssetCard.count()) > 0 ? imageAssetCard : page.locator('[data-testid="studio-gallery-card"][data-asset-id]').first();
  await firstAssetCard.waitFor({ state: "visible", timeout: 20000 });
  summary.selected_asset_id = await firstAssetCard.getAttribute("data-asset-id");

  const favoriteButton = firstAssetCard.locator('[data-testid="studio-favorite-toggle"]').first();
  if ((await favoriteButton.count()) > 0) {
    await favoriteButton.click();
    summary.favorite_toggled = true;
    await page.waitForTimeout(1200);
  }

  await firstAssetCard.click();
  await page.waitForSelector('[data-testid="studio-inspector"]', { timeout: 15000 });

  const lightboxTrigger = page.locator('[data-testid="studio-open-lightbox"]').first();
  if ((await lightboxTrigger.count()) > 0) {
    await lightboxTrigger.click();
    await page.waitForSelector('[data-testid="studio-lightbox"]', { timeout: 15000 });
    summary.lightbox_seen = true;
    try {
      await page.getByLabel("Close media lightbox").click({ timeout: 4000 });
    } catch {
      try {
        await page.keyboard.press("Escape");
      } catch {
        await page.locator('[data-testid="studio-lightbox"]').click({ position: { x: 12, y: 12 } });
      }
    }
    await page.waitForFunction(() => !document.querySelector('[data-testid="studio-lightbox"]'), null, { timeout: 15000 });
  }

  if (summary.selected_asset_id) {
    const closeInspector = page.locator('[data-testid="studio-inspector"] button').first();
    await closeInspector.click();
    await page.waitForSelector('[data-testid="studio-inspector"]', { state: "hidden", timeout: 15000 });
  }

  await page.locator('[data-testid="studio-filter-videos"]').click();
  summary.video_filter_used = true;
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="studio-filter-all"]').click();
  await page.waitForTimeout(1200);

  const visibleCards = await page.locator('[data-testid="studio-gallery-card"], [data-testid="studio-gallery-batch-card"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      assetId: node.getAttribute("data-asset-id"),
      jobId: node.getAttribute("data-job-id"),
    })),
  );
  summary.duplicate_card_keys = collectDuplicateKeys(visibleCards);

  if (summary.selected_asset_id && summary.favorite_toggled) {
    const assetCard = page.locator(`[data-testid="studio-gallery-card"][data-asset-id="${summary.selected_asset_id}"]`).first();
    const favoriteToggle = assetCard.locator('[data-testid="studio-favorite-toggle"]').first();
    if ((await favoriteToggle.count()) > 0) {
      await favoriteToggle.click();
      await page.waitForTimeout(1200);
      summary.favorite_reverted = true;
    }
  }

  await page.screenshot({ path: successShot, fullPage: true });
  summary.ok = summary.queue_card_seen && summary.duplicate_card_keys.length === 0;
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    throw new Error("Studio browser smoke found duplicate cards or missed the queue card.");
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
