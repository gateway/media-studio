import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-seedance-smoke.json");
const successShot = path.join(outputDir, "studio-browser-seedance-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-seedance-smoke-failure.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const pngBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9oN8YQAAAABJRU5ErkJggg==",
  "base64",
);
const videoBuffer = Buffer.from("seedance-video-reference");
const audioBuffer = Buffer.from("seedance-audio-reference");

const summary = {
  ok: false,
  studio_url: studioUrl,
  selected_model: null,
  mode_buttons_visible: false,
  first_frame_uploaded: false,
  last_frame_uploaded: false,
  reference_image_uploaded: false,
  reference_video_uploaded: false,
  reference_audio_uploaded: false,
  token_panel_visible: false,
  invalid_validation_state: null,
  invalid_validation_error: null,
  valid_validation_state: null,
  queue_card_seen: false,
  screenshot: successShot,
};

async function ensureModelSelected(modelMatcher) {
  await page.waitForFunction(() => Boolean(window.__mediaStudioTest?.composer), null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__mediaStudioTest?.composer?.setModel("seedance-2.0");
  });
  const picker = page.locator('[data-testid="studio-picker-model"]:visible').last();
  await page.waitForFunction(() => {
    const picker = document.querySelector('[data-testid="studio-picker-model"]');
    return (picker?.textContent ?? "").toLowerCase().includes("seedance");
  }, null, { timeout: 15000 });
  const currentLabel = ((await picker.textContent()) ?? "").trim();
  if (!modelMatcher.test(currentLabel)) {
    throw new Error(`Seedance model was not selected. Current picker label: ${currentLabel}`);
  }
  summary.selected_model = currentLabel;
}

async function validateViaControlRoute({ prompt, manifest, attachments }) {
  const formData = new FormData();
  formData.set("intent", "validate");
  formData.set("model_key", "seedance-2.0");
  formData.set("task_mode", "reference_to_video");
  formData.set("prompt", prompt);
  formData.set("options", JSON.stringify({ duration: 4, resolution: "480p", aspect_ratio: "16:9" }));
  formData.set("system_prompt_ids", JSON.stringify([]));
  formData.set("attachment_manifest", JSON.stringify(manifest));
  for (const attachment of attachments) {
    formData.append(
      "attachments",
      new File([attachment.buffer], attachment.name, { type: attachment.type }),
    );
  }
  const response = await fetch(`${baseUrl}/api/control/media`, { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? `Seedance validation route failed (${response.status}).`);
  }
  return payload.validation;
}

try {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await ensureModelSelected(/seedance/i);
  await page.waitForTimeout(500);

  await page.waitForSelector('[data-testid="seedance-mode-text_only"]:visible', { timeout: 10000 });
  await page.waitForSelector('[data-testid="seedance-mode-first_frame"]:visible', { timeout: 10000 });
  await page.waitForSelector('[data-testid="seedance-mode-first_last_frames"]:visible', { timeout: 10000 });
  await page.waitForSelector('[data-testid="seedance-mode-multimodal_reference"]:visible', { timeout: 10000 });
  summary.mode_buttons_visible = true;

  await page.evaluate(() => {
    window.__mediaStudioTest?.composer?.setSeedanceMode("first_frame");
  });
  const firstFrameSlot = page.locator('[data-testid="seedance-slot-first_frame"]:visible').last();
  await firstFrameSlot.waitFor({ state: "visible", timeout: 10000 });
  await firstFrameSlot.locator('[data-testid="seedance-slot-input-first_frame"]').setInputFiles({
    name: "first-frame.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await page.waitForTimeout(400);
  summary.first_frame_uploaded = (await firstFrameSlot.locator("img").count()) > 0;

  await page.evaluate(() => {
    window.__mediaStudioTest?.composer?.setSeedanceMode("first_last_frames");
  });
  const lastFrameSlot = page.locator('[data-testid="seedance-slot-last_frame"]:visible').last();
  await lastFrameSlot.waitFor({ state: "visible", timeout: 10000 });
  await lastFrameSlot.locator('[data-testid="seedance-slot-input-last_frame"]').setInputFiles({
    name: "last-frame.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await page.waitForTimeout(400);
  summary.last_frame_uploaded = (await lastFrameSlot.locator("img").count()) > 0;

  await page.evaluate(() => {
    window.__mediaStudioTest?.composer?.setSeedanceMode("multimodal_reference");
  });
  await page.waitForSelector('[data-testid="seedance-group-input-images"]', { state: "attached", timeout: 10000 });
  await page.locator('[data-testid="seedance-group-input-images"]').first().setInputFiles({
    name: "ref-image.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await page.locator('[data-testid="seedance-group-input-videos"]').first().setInputFiles({
    name: "ref-video.mp4",
    mimeType: "video/mp4",
    buffer: videoBuffer,
  });
  await page.locator('[data-testid="seedance-group-input-audios"]').first().setInputFiles({
    name: "ref-audio.wav",
    mimeType: "audio/wav",
    buffer: audioBuffer,
  });
  await page.waitForTimeout(600);

  const referenceImageGroup = page.locator('[data-testid="seedance-group-images"]').first();
  const referenceVideoGroup = page.locator('[data-testid="seedance-group-videos"]').first();
  const referenceAudioGroup = page.locator('[data-testid="seedance-group-audios"]').first();
  summary.reference_image_uploaded = (await referenceImageGroup.locator("img").count()) > 0;
  summary.reference_video_uploaded = (await referenceVideoGroup.locator("video").count()) > 0;
  summary.reference_audio_uploaded = await referenceAudioGroup.textContent().then((text) => (text ?? "").includes("1 / 3"));
  summary.token_panel_visible = (await page.locator('[data-testid="seedance-reference-token-panel"]:visible').count()) > 0;

  const prompt = `Seedance smoke ${new Date().toISOString()} use @image1 for the subject and @audio1 for the rhythm.`;
  await page.locator('[data-testid="studio-prompt-input"]:visible').last().fill(prompt);
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="seedance-reference-token-panel"]');
    return (panel?.textContent ?? "").includes("@image1") && (panel?.textContent ?? "").includes("@audio1");
  }, null, { timeout: 15000 });

  const invalidValidation = await validateViaControlRoute({
    prompt: "Invalid mix",
    manifest: [
      { id: "first", kind: "images", role: "first_frame" },
      { id: "ref", kind: "images", role: "reference" },
    ],
    attachments: [
      { buffer: pngBuffer, name: "first.png", type: "image/png" },
      { buffer: pngBuffer, name: "ref.png", type: "image/png" },
    ],
  });
  summary.invalid_validation_state = invalidValidation?.state ?? null;
  summary.invalid_validation_error = invalidValidation?.errors?.[0] ?? null;

  const validValidation = await validateViaControlRoute({
    prompt,
    manifest: [
      { id: "img", kind: "images", role: "reference" },
      { id: "vid", kind: "videos", role: "reference", duration_seconds: 5 },
      { id: "aud", kind: "audios", role: "reference" },
    ],
    attachments: [
      { buffer: pngBuffer, name: "ref-image.png", type: "image/png" },
      { buffer: videoBuffer, name: "ref-video.mp4", type: "video/mp4" },
      { buffer: audioBuffer, name: "ref-audio.wav", type: "audio/wav" },
    ],
  });
  summary.valid_validation_state = validValidation?.state ?? null;

  await page.locator('[data-testid="studio-generate-button"]:visible').last().click();
  await page.waitForSelector('[data-testid="studio-gallery-batch-card"]', { timeout: 20000 });
  summary.queue_card_seen = true;

  summary.ok =
    summary.mode_buttons_visible &&
    summary.first_frame_uploaded &&
    summary.last_frame_uploaded &&
    summary.reference_image_uploaded &&
    summary.reference_video_uploaded &&
    summary.reference_audio_uploaded &&
    summary.token_panel_visible &&
    summary.invalid_validation_state === "invalid" &&
    summary.valid_validation_state?.startsWith("ready") &&
    summary.queue_card_seen;

  await page.screenshot({ path: successShot, fullPage: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    throw new Error("Seedance browser smoke did not satisfy all expected checkpoints.");
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
