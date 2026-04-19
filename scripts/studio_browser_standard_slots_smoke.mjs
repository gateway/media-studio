import fs from "node:fs/promises";
import path from "node:path";

import { chromium, devices } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-standard-slots-smoke.json");
const successShot = path.join(outputDir, "studio-browser-standard-slots-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-standard-slots-smoke-failure.png");
const mobileShot = path.join(outputDir, "studio-browser-standard-slots-smoke-mobile.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;

await fs.mkdir(outputDir, { recursive: true });

const summary = {
  ok: false,
  studio_url: studioUrl,
  desktop: {
    kling_i2v_slots_visible: false,
    kling_i2v_start_filled: false,
    kling_i2v_end_filled: false,
    kling_motion_slots_visible: false,
    kling_motion_source_filled: false,
    kling_motion_wrong_type_rejected: false,
    kling_motion_video_filled: false,
    library_replace_preserved_source: false,
    library_replace_preserved_video: false,
  },
  mobile: {
    kling_i2v_slots_visible: false,
    kling_motion_slots_visible: false,
  },
  screenshot: successShot,
  mobile_screenshot: mobileShot,
};

function expectState(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function slotInput(page, id) {
  return page.locator(`[data-testid="${id}"]`).first();
}

function slotDropTarget(page, id) {
  return page.locator("label").filter({ has: slotInput(page, id) }).first();
}

async function ensureModelSelected(page, modelMatcher, modelKey) {
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
    await page.waitForTimeout(600);
    return;
  }
  const pickers = page.locator('[data-testid="studio-picker-model"]');
  const pickerCount = await pickers.count();
  let picker = pickers.first();
  for (let index = 0; index < pickerCount; index += 1) {
    const candidate = pickers.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      picker = candidate;
      break;
    }
  }
  await picker.waitFor({ state: "visible", timeout: 20000 });
  const currentLabel = ((await picker.textContent()) ?? "").trim();
  if (modelMatcher.test(currentLabel)) {
    return;
  }
  await picker.click({ force: true });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="studio-picker-option-model-"]').length > 0,
    null,
    { timeout: 15000 },
  );
  const options = page.locator('[data-testid^="studio-picker-option-model-"]');
  const optionCount = await options.count();
  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    const label = ((await option.textContent()) ?? "").trim();
    if (modelMatcher.test(label)) {
      await option.click();
      await page.waitForTimeout(400);
      return;
    }
  }
  throw new Error(`No matching model option was found for ${modelKey}.`);
}

async function runDesktopSmoke(page) {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await page.getByTestId("studio-filter-images").click();
  await page.waitForTimeout(300);
  const imageCards = page.locator('[data-testid="studio-gallery-card"][data-generation-kind="image"]');
  expectState((await imageCards.count()) >= 2, "Standard slots smoke requires at least two image cards in the visible gallery.");

  await ensureModelSelected(page, /kling 3\.0 image to video/i, "kling-3.0-i2v");
  await page.waitForTimeout(300);
  summary.desktop.kling_i2v_slots_visible =
    (await slotInput(page, "studio-standard-slot-slot-start-frame").count()) > 0 &&
    (await slotInput(page, "studio-standard-slot-slot-end-frame").count()) > 0;
  expectState(summary.desktop.kling_i2v_slots_visible, "Kling 3.0 i2v did not expose both start and end frame slots.");

  await imageCards.nth(0).dragTo(slotDropTarget(page, "studio-standard-slot-slot-start-frame"));
  await page.waitForTimeout(400);
  summary.desktop.kling_i2v_start_filled =
    (await page.locator('[data-testid="studio-standard-slot-slot-start-frame-filled"]').count()) > 0;
  expectState(summary.desktop.kling_i2v_start_filled, "Kling 3.0 i2v did not accept the start-frame image.");

  await imageCards.nth(1).dragTo(slotDropTarget(page, "studio-standard-slot-slot-end-frame"));
  await page.waitForTimeout(400);
  summary.desktop.kling_i2v_end_filled =
    (await page.locator('[data-testid="studio-standard-slot-slot-end-frame-filled"]').count()) > 0;
  expectState(summary.desktop.kling_i2v_end_filled, "Kling 3.0 i2v did not accept the end-frame image.");

  await page.getByRole("button", { name: "Clear" }).click();
  await page.waitForTimeout(300);

  await ensureModelSelected(page, /kling 3\.0 motion control/i, "kling-3.0-motion");
  await page.waitForTimeout(300);
  summary.desktop.kling_motion_slots_visible =
    (await slotInput(page, "studio-standard-slot-slot-source-image").count()) > 0 &&
    (await slotInput(page, "studio-standard-slot-slot-driving-video").count()) > 0;
  expectState(summary.desktop.kling_motion_slots_visible, "Kling Motion did not expose source-image and driving-video slots.");

  await imageCards.nth(0).dragTo(slotDropTarget(page, "studio-standard-slot-slot-source-image"));
  await page.waitForTimeout(400);
  summary.desktop.kling_motion_source_filled =
    (await page.locator('[data-testid="studio-standard-slot-slot-source-image-filled"]').count()) > 0;
  expectState(summary.desktop.kling_motion_source_filled, "Kling Motion did not accept the source image.");

  await imageCards.nth(1).dragTo(slotDropTarget(page, "studio-standard-slot-slot-driving-video"));
  await page.waitForTimeout(400);
  summary.desktop.kling_motion_wrong_type_rejected =
    (await page.locator('[data-testid="studio-standard-slot-slot-driving-video-filled"]').count()) === 0;
  expectState(summary.desktop.kling_motion_wrong_type_rejected, "Driving-video slot incorrectly accepted an image.");

  await page.getByTestId("studio-filter-videos").click();
  await page.waitForTimeout(300);
  const videoCards = page.locator('[data-testid="studio-gallery-card"][data-generation-kind="video"]');
  expectState((await videoCards.count()) >= 1, "Standard slots smoke requires at least one video card in the visible gallery.");
  await videoCards.first().dragTo(slotDropTarget(page, "studio-standard-slot-slot-driving-video"));
  await page.waitForTimeout(500);
  summary.desktop.kling_motion_video_filled =
    (await page.locator('[data-testid="studio-standard-slot-slot-driving-video-filled"]').count()) > 0;
  expectState(summary.desktop.kling_motion_video_filled, "Kling Motion did not accept the driving video.");

  await page.getByTestId("studio-filter-library").click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Use image" }).first().click();
  await page.waitForTimeout(500);
  summary.desktop.library_replace_preserved_source =
    (await page.locator('[data-testid="studio-standard-slot-slot-source-image-filled"]').count()) > 0;
  summary.desktop.library_replace_preserved_video =
    (await page.locator('[data-testid="studio-standard-slot-slot-driving-video-filled"]').count()) > 0;
  expectState(summary.desktop.library_replace_preserved_source, "Reference-library replacement left the source-image slot empty.");
  expectState(summary.desktop.library_replace_preserved_video, "Reference-library replacement disturbed the driving-video slot.");

  await page.screenshot({ path: successShot, fullPage: true });
}

async function runMobileSmoke(browser) {
  const context = await browser.newContext({
    ...devices["iPhone 14"],
  });
  const page = await context.newPage();
  try {
    await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });

    await ensureModelSelected(page, /kling 3\.0 image to video/i, "kling-3.0-i2v");
    await page.waitForTimeout(350);
    summary.mobile.kling_i2v_slots_visible =
      (await page.locator('[data-testid="studio-mobile-standard-slot-slot-start-frame"]').count()) > 0 &&
      (await page.locator('[data-testid="studio-mobile-standard-slot-slot-end-frame"]').count()) > 0;
    expectState(summary.mobile.kling_i2v_slots_visible, "Mobile Kling 3.0 i2v did not render both explicit slots.");

    await ensureModelSelected(page, /kling 3\.0 motion control/i, "kling-3.0-motion");
    await page.waitForTimeout(350);
    summary.mobile.kling_motion_slots_visible =
      (await page.locator('[data-testid="studio-mobile-standard-slot-slot-source-image"]').count()) > 0 &&
      (await page.locator('[data-testid="studio-mobile-standard-slot-slot-driving-video"]').count()) > 0;
    expectState(summary.mobile.kling_motion_slots_visible, "Mobile Kling Motion did not render both explicit slots.");

    await page.screenshot({ path: mobileShot, fullPage: true });
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  const desktopPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await runDesktopSmoke(desktopPage);
  await desktopPage.close();
  await runMobileSmoke(browser);

  summary.ok =
    summary.desktop.kling_i2v_slots_visible &&
    summary.desktop.kling_i2v_start_filled &&
    summary.desktop.kling_i2v_end_filled &&
    summary.desktop.kling_motion_slots_visible &&
    summary.desktop.kling_motion_source_filled &&
    summary.desktop.kling_motion_wrong_type_rejected &&
    summary.desktop.kling_motion_video_filled &&
    summary.desktop.library_replace_preserved_source &&
    summary.desktop.library_replace_preserved_video &&
    summary.mobile.kling_i2v_slots_visible &&
    summary.mobile.kling_motion_slots_visible;
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    throw new Error("Standard slot smoke did not satisfy all expected checkpoints.");
  }
} catch (error) {
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
  summary.failure_screenshot = failureShot;
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.screenshot({ path: failureShot, fullPage: true });
    await page.close();
  } catch {}
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}
