import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-retry-restore-smoke.json");
const successShot = path.join(outputDir, "studio-browser-retry-restore-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-retry-restore-smoke-failure.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;
const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX3cAAAAASUVORK5CYII=";

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const summary = {
  ok: false,
  studio_url: studioUrl,
  prompt_after_retry: "",
  model_label_after_retry: "",
  slot_count_after_retry: 0,
  failed_job_opened: false,
  screenshot: successShot,
};

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await page.waitForFunction(
    () =>
      typeof window.__mediaStudioTest?.failedJob?.seedAndOpen === "function" &&
      typeof window.__mediaStudioTest?.composer?.setModel === "function",
    null,
    { timeout: 15000 },
  );

  await page.evaluate(({ dataUrl }) => {
    const createdAt = new Date().toISOString();
    window.__mediaStudioTest?.failedJob?.seedAndOpen({
      job_id: "job-browser-retry-smoke",
      status: "failed",
      model_key: "nano-banana-2",
      task_mode: "image_edit",
      created_at: createdAt,
      updated_at: createdAt,
      requested_outputs: 2,
      raw_prompt: "Retry smoke prompt",
      final_prompt_used: "Retry smoke prompt",
      error: "Synthetic browser smoke error",
      selected_system_prompt_ids: [],
      resolved_options: { output_format: "png" },
      normalized_request: {
        images: [
          { url: dataUrl, media_type: "image", role: null },
          { url: dataUrl, media_type: "image", role: "reference" },
        ],
      },
    });
  }, { dataUrl: tinyPngDataUrl });

  await page.waitForSelector('[data-testid="studio-failed-job-inspector"]', { timeout: 15000 });
  summary.failed_job_opened = true;

  await page.locator('[data-testid="studio-failed-job-retry"]').click();
  await page.waitForFunction(
    () => !(document.querySelector('[data-testid="studio-failed-job-inspector"]')),
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => {
      const prompt = document.querySelector('[data-testid="studio-prompt-input"]');
      return prompt instanceof HTMLTextAreaElement && prompt.value === "Retry smoke prompt";
    },
    null,
    { timeout: 15000 },
  );

  summary.prompt_after_retry = await page.locator('[data-testid="studio-prompt-input"]').inputValue();
  summary.model_label_after_retry = ((await page.locator('[data-testid="studio-picker-model"]').textContent()) ?? "").trim();
  summary.slot_count_after_retry = await page
    .locator('[data-testid^="studio-multi-image-slot-"]:not([data-testid$="-remove"])')
    .evaluateAll((nodes) =>
      new Set(
        nodes
          .map((node) => node.getAttribute("data-testid"))
          .filter((value) => typeof value === "string" && value.length > 0),
      ).size,
    );

  if (summary.prompt_after_retry !== "Retry smoke prompt") {
    throw new Error(`Unexpected retry prompt: ${summary.prompt_after_retry}`);
  }
  if (!/nano banana 2/i.test(summary.model_label_after_retry)) {
    throw new Error(`Unexpected retry model label: ${summary.model_label_after_retry}`);
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
