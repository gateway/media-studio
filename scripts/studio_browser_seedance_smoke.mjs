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
  reference_strip_visible: false,
  settings_visible: false,
  start_frame_file_drop_uploaded: false,
  end_frame_rejected_without_start: false,
  end_frame_file_drop_uploaded: false,
  gallery_image_drag_uploaded: false,
  gallery_video_drag_uploaded: false,
  local_video_file_drop_uploaded: false,
  reference_audio_uploaded: false,
  invalid_validation_state: null,
  invalid_validation_error: null,
  valid_validation_state: null,
  screenshot: successShot,
};

async function ensureSeedanceSelected() {
  await page.waitForFunction(() => Boolean(window.__mediaStudioTest?.composer), null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__mediaStudioTest?.composer?.setModel("seedance-2.0");
  });
  const picker = page.locator('[data-testid="studio-picker-model"]:visible').last();
  await page.waitForFunction(() => {
    const picker = document.querySelector('[data-testid="studio-picker-model"]');
    return (picker?.textContent ?? "").toLowerCase().includes("seedance");
  }, null, { timeout: 15000 });
  summary.selected_model = ((await picker.textContent()) ?? "").trim();
}

async function resetStudio() {
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await ensureSeedanceSelected();
  await page.waitForSelector('[data-testid="seedance-group-images"]:visible', { timeout: 10000 });
  await page.waitForSelector('[data-testid="seedance-slot-first_frame"]:visible', { timeout: 10000 });
  await page.waitForSelector('button[aria-label="Open studio settings"]:visible', { timeout: 10000 });
  summary.reference_strip_visible = true;
  summary.settings_visible = true;
}

async function dropFile(selector, { name, mimeType, buffer }) {
  await page.locator(`${selector}:visible`).last().evaluate(
    (node, fileData) => {
      const dt = new DataTransfer();
      const file = fileData.mimeType
        ? new File([fileData.buffer], fileData.name, { type: fileData.mimeType })
        : new File([fileData.buffer], fileData.name);
      dt.items.add(file);
      node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { name, mimeType: mimeType ?? null, buffer },
  );
}

async function dragGalleryAssetTo(selector, assetId) {
  await page.evaluate(
    ({ targetSelector, assetId: id }) => {
      const source = document.querySelector(
        `[data-testid="studio-gallery-card"][data-asset-id="${String(id)}"]`,
      );
      const target = document.querySelector(targetSelector);
      if (!source || !target) {
        throw new Error("Missing drag source or target.");
      }
      const dt = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
      dt.setData("application/x-bumblebee-media-asset-id", String(id));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { targetSelector: selector, assetId },
  );
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
    formData.append("attachments", new File([attachment.buffer], attachment.name, { type: attachment.type }));
  }
  const response = await fetch(`${baseUrl}/api/control/media`, { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? `Seedance validation route failed (${response.status}).`);
  }
  return payload.validation;
}

try {
  await resetStudio();

  await dropFile('[data-testid="seedance-slot-last_frame"] label', {
    name: "end-only.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await page.waitForTimeout(350);
  const lastFrameBeforeStart = page.locator('[data-testid="seedance-slot-last_frame"]:visible').last();
  const warningMessage = page.locator("text=Add a start frame before the end frame.").last();
  summary.end_frame_rejected_without_start =
    (await lastFrameBeforeStart.locator("img").count()) === 0 && (await warningMessage.count()) > 0;

  await dropFile('[data-testid="seedance-slot-first_frame"] label', {
    name: "first-frame.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await page.waitForTimeout(350);
  summary.start_frame_file_drop_uploaded =
    (await page.locator('[data-testid="seedance-slot-first_frame"]:visible').last().locator("img").count()) > 0;

  await dropFile('[data-testid="seedance-slot-last_frame"] label', {
    name: "last-frame.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await page.waitForTimeout(350);
  summary.end_frame_file_drop_uploaded =
    (await page.locator('[data-testid="seedance-slot-last_frame"]:visible').last().locator("img").count()) > 0;

  const assets = await page.evaluate(async () => {
    const res = await fetch("/api/control/media-assets?page=1&page_size=100", { credentials: "same-origin" });
    const data = await res.json();
    return data.items || data.assets || [];
  });
  const imageAsset = assets.find((asset) => asset.generation_kind === "image");
  const videoAsset = assets.find((asset) => asset.generation_kind === "video");
  if (!imageAsset || !videoAsset) {
    throw new Error("Seedance smoke requires at least one image asset and one video asset in the gallery.");
  }

  await dragGalleryAssetTo('[data-testid="seedance-group-images"]', imageAsset.asset_id);
  await page.waitForTimeout(600);
  summary.gallery_image_drag_uploaded = await page
    .locator('[data-testid="seedance-group-images"]')
    .first()
    .textContent()
    .then((text) => (text ?? "").includes("1 / 9"));

  await dragGalleryAssetTo('[data-testid="seedance-group-videos"]', videoAsset.asset_id);
  await page.waitForTimeout(700);
  summary.gallery_video_drag_uploaded = await page
    .locator('[data-testid="seedance-group-videos"]')
    .first()
    .textContent()
    .then((text) => (text ?? "").includes("1 / 3"));

  await dropFile('[data-testid="seedance-group-videos"]', {
    name: "finder-drop.mp4",
    mimeType: null,
    buffer: videoBuffer,
  });
  await page.waitForTimeout(700);
  summary.local_video_file_drop_uploaded = await page
    .locator('[data-testid="seedance-group-videos"]')
    .first()
    .textContent()
    .then((text) => (text ?? "").includes("2 / 3"));

  await page.locator('[data-testid="seedance-group-input-audios"]').first().setInputFiles({
    name: "ref-audio.wav",
    mimeType: "audio/wav",
    buffer: audioBuffer,
  });
  await page.waitForTimeout(350);
  summary.reference_audio_uploaded = await page
    .locator('[data-testid="seedance-group-audios"]')
    .first()
    .textContent()
    .then((text) => (text ?? "").includes("1 / 3"));

  const prompt = `Seedance smoke ${new Date().toISOString()} use @image1 for the subject and @audio1 for the rhythm.`;
  await page.locator('[data-testid="studio-prompt-input"]:visible').last().fill(prompt);

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

  summary.ok =
    Boolean(summary.selected_model?.toLowerCase().includes("seedance")) &&
    summary.reference_strip_visible &&
    summary.settings_visible &&
    summary.start_frame_file_drop_uploaded &&
    summary.end_frame_rejected_without_start &&
    summary.end_frame_file_drop_uploaded &&
    summary.gallery_image_drag_uploaded &&
    summary.gallery_video_drag_uploaded &&
    summary.local_video_file_drop_uploaded &&
    summary.reference_audio_uploaded &&
    summary.invalid_validation_state === "invalid" &&
    summary.valid_validation_state?.startsWith("ready");

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
