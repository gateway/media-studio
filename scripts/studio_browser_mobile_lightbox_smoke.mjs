import fs from "node:fs/promises";
import path from "node:path";

import { chromium, devices } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-mobile-lightbox-smoke.json");
const successShot = path.join(outputDir, "studio-browser-mobile-lightbox-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-mobile-lightbox-smoke-failure.png");
const fixtureSource = path.resolve(process.cwd(), "docs", "images", "media-studio.jpg");
const fixtureDir = path.resolve(process.cwd(), "data", "browser-smoke");
const fixtureOne = path.join(fixtureDir, "mobile-lightbox-1.jpg");
const fixtureTwo = path.join(fixtureDir, "mobile-lightbox-2.jpg");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(fixtureDir, { recursive: true });
await fs.copyFile(fixtureSource, fixtureOne);
await fs.copyFile(fixtureSource, fixtureTwo);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices["iPhone 14"],
});
const page = await context.newPage();

const summary = {
  ok: false,
  studio_url: studioUrl,
  before_src: null,
  after_src: null,
  overlay_width: null,
  viewport_width: null,
  screenshot: successShot,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchSwipeLeft() {
  await page.locator('[data-testid="studio-lightbox-swipe-surface"]').evaluate((node) => {
    if (typeof Touch !== "function" || typeof TouchEvent !== "function") {
      throw new Error("Touch APIs unavailable in page context.");
    }
    const target = node;
    const start = new Touch({
      identifier: 1,
      target,
      clientX: 320,
      clientY: 420,
      pageX: 320,
      pageY: 420,
      screenX: 320,
      screenY: 420,
    });
    const end = new Touch({
      identifier: 1,
      target,
      clientX: 60,
      clientY: 418,
      pageX: 60,
      pageY: 418,
      screenX: 60,
      screenY: 418,
    });
    target.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
        touches: [start],
        targetTouches: [start],
        changedTouches: [start],
      }),
    );
    target.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        touches: [],
        targetTouches: [],
        changedTouches: [end],
      }),
    );
  });
}

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await page.waitForFunction(() => typeof window.__mediaStudioTest?.gallery?.seedAssets === "function", null, { timeout: 10000 });
  await sleep(1500);

  await page.evaluate(() => {
    window.__mediaStudioTest?.gallery?.seedAssets([
      {
        asset_id: "mobile-lightbox-1",
        generation_kind: "image",
        created_at: "2026-04-11T09:00:00Z",
        hero_web_url: "/files/browser-smoke/mobile-lightbox-1.jpg",
        hero_thumb_url: "/files/browser-smoke/mobile-lightbox-1.jpg",
        hero_original_url: "/files/browser-smoke/mobile-lightbox-1.jpg",
        favorited: false,
      },
      {
        asset_id: "mobile-lightbox-2",
        generation_kind: "image",
        created_at: "2026-04-11T09:00:01Z",
        hero_web_url: "/files/browser-smoke/mobile-lightbox-2.jpg",
        hero_thumb_url: "/files/browser-smoke/mobile-lightbox-2.jpg",
        hero_original_url: "/files/browser-smoke/mobile-lightbox-2.jpg",
        favorited: false,
      },
    ]);
    window.__mediaStudioTest?.gallery?.openLightbox("mobile-lightbox-1");
  });
  await page.waitForSelector('[data-testid="studio-lightbox"]', { timeout: 15000 });

  const lightboxMedia = page.locator('[data-testid="studio-lightbox"] img').first();
  await lightboxMedia.waitFor({ state: "visible", timeout: 15000 });
  summary.before_src = await lightboxMedia.getAttribute("src");

  const metrics = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="studio-lightbox"]');
    const rect = overlay?.getBoundingClientRect();
    return {
      overlayWidth: rect?.width ?? null,
      viewportWidth: window.innerWidth,
    };
  });
  summary.overlay_width = metrics.overlayWidth;
  summary.viewport_width = metrics.viewportWidth;

  await dispatchSwipeLeft();
  await sleep(1200);

  summary.after_src = await lightboxMedia.getAttribute("src");
  await page.screenshot({ path: successShot, fullPage: true });

  summary.ok = Boolean(
    summary.before_src &&
      summary.after_src &&
      summary.before_src !== summary.after_src &&
      summary.overlay_width === summary.viewport_width,
  );
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (!summary.ok) {
    throw new Error(
      `Verification failed: before=${summary.before_src} after=${summary.after_src} overlay=${summary.overlay_width} viewport=${summary.viewport_width}`,
    );
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
  await context.close();
  await browser.close();
}
