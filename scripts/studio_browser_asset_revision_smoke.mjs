import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-asset-revision-smoke.json");
const successShot = path.join(outputDir, "studio-browser-asset-revision-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-asset-revision-smoke-failure.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;
const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX3cAAAAASUVORK5CYII=";
const seedImagePath = "outputs/smokes/asset-revision-source.png";

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(path.resolve(process.cwd(), "data", "outputs", "smokes"), { recursive: true });
await fs.writeFile(
  path.resolve(process.cwd(), "data", seedImagePath),
  Buffer.from(tinyPngDataUrl.split(",")[1], "base64"),
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const summary = {
  ok: false,
  studio_url: studioUrl,
  kling: {
    prompt_restored: false,
    model_restored: false,
    source_slot_filled: false,
  },
  nano: {
    prompt_restored: false,
    model_restored: false,
    source_slot_filled: false,
    reference_slot_filled: false,
  },
  screenshot: successShot,
};

async function openRevisionCase(payload) {
  await page.waitForFunction(
    () => typeof window.__mediaStudioTest?.assetInspector?.seedAndOpen === "function",
    null,
    { timeout: 15000 },
  );
  await page.evaluate((seedPayload) => {
    window.__mediaStudioTest?.assetInspector?.seedAndOpen(seedPayload);
  }, payload);
  await page.waitForSelector('[data-testid="studio-inspector"]', { timeout: 15000 });
  await page.getByRole("button", { name: "Create Revision" }).first().click();
  await page.waitForSelector('[data-testid="studio-inspector"]', { state: "hidden", timeout: 15000 });
}

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });

  const createdAt = new Date().toISOString();
  const sourceImageUrl = `${baseUrl}/api/control/files/${seedImagePath}`;

  await openRevisionCase({
    asset: {
      asset_id: "asset-kling-smoke",
      job_id: "job-kling-smoke",
      generation_kind: "video",
      status: "completed",
      model_key: "kling-2.6-i2v",
      prompt_summary: "Kling smoke asset",
      hero_poster_url: tinyPngDataUrl,
      hero_thumb_url: tinyPngDataUrl,
      hero_web_url: tinyPngDataUrl,
      created_at: createdAt,
      updated_at: createdAt,
    },
    job: {
      job_id: "job-kling-smoke",
      status: "completed",
      model_key: "kling-2.6-i2v",
      task_mode: "image_to_video",
      created_at: createdAt,
      updated_at: createdAt,
      requested_outputs: 1,
      raw_prompt: "Kling revision smoke prompt",
      final_prompt_used: "Kling revision smoke prompt",
      selected_system_prompt_ids: [],
      resolved_options: { duration: 5 },
      normalized_request: {
        images: [{ url: sourceImageUrl, media_type: "image", role: null }],
      },
    },
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="studio-standard-slot-slot-source-image-filled"]').length > 0,
    null,
    { timeout: 15000 },
  );

  summary.kling.prompt_restored =
    (await page.locator('[data-testid="studio-prompt-input"]').inputValue()) === "Kling revision smoke prompt";
  summary.kling.model_restored = /kling 2\.6 image to video/i.test(
    ((await page.locator('[data-testid="studio-picker-model"]').textContent()) ?? "").trim(),
  );
  summary.kling.source_slot_filled =
    (await page.locator('[data-testid="studio-standard-slot-slot-source-image-filled"]').count()) > 0;
  if (!summary.kling.prompt_restored || !summary.kling.model_restored || !summary.kling.source_slot_filled) {
    throw new Error("Kling completed-asset revision did not restore the expected prompt, model, and source image.");
  }

  await page.getByRole("button", { name: "Clear" }).click();
  await page.waitForTimeout(300);

  await openRevisionCase({
    asset: {
      asset_id: "asset-nano-smoke",
      job_id: "job-nano-smoke",
      generation_kind: "image",
      status: "completed",
      model_key: "nano-banana-2",
      prompt_summary: "Nano smoke asset",
      hero_thumb_url: tinyPngDataUrl,
      hero_web_url: tinyPngDataUrl,
      created_at: createdAt,
      updated_at: createdAt,
    },
    job: {
      job_id: "job-nano-smoke",
      status: "completed",
      model_key: "nano-banana-2",
      task_mode: "image_edit",
      created_at: createdAt,
      updated_at: createdAt,
      requested_outputs: 1,
      raw_prompt: "Nano revision smoke prompt",
      final_prompt_used: "Nano revision smoke prompt",
      selected_system_prompt_ids: [],
      resolved_options: { output_format: "png" },
      normalized_request: {
        images: [
          { url: sourceImageUrl, media_type: "image", role: null },
          { url: sourceImageUrl, media_type: "image", role: "reference" },
        ],
      },
    },
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="studio-multi-image-slot-1"]').length > 0 &&
      document.querySelectorAll('[data-testid="studio-multi-image-slot-2"]').length > 0,
    null,
    { timeout: 15000 },
  );

  summary.nano.prompt_restored =
    (await page.locator('[data-testid="studio-prompt-input"]').inputValue()) === "Nano revision smoke prompt";
  summary.nano.model_restored = /nano banana 2/i.test(
    ((await page.locator('[data-testid="studio-picker-model"]').textContent()) ?? "").trim(),
  );
  summary.nano.source_slot_filled =
    (await page.locator('[data-testid="studio-multi-image-slot-1"]').count()) > 0;
  summary.nano.reference_slot_filled =
    (await page.locator('[data-testid="studio-multi-image-slot-2"]').count()) > 0;
  if (
    !summary.nano.prompt_restored ||
    !summary.nano.model_restored ||
    !summary.nano.source_slot_filled ||
    !summary.nano.reference_slot_filled
  ) {
    throw new Error("Nano completed-asset revision did not restore the expected prompt, model, and image references.");
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
