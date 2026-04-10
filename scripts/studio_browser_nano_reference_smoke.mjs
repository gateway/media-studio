import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const outputDir = path.resolve(process.cwd(), "output", "browser-smoke");
const summaryPath = path.join(outputDir, "studio-browser-nano-reference-smoke.json");
const successShot = path.join(outputDir, "studio-browser-nano-reference-smoke-success.png");
const failureShot = path.join(outputDir, "studio-browser-nano-reference-smoke-failure.png");
const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const studioUrl = `${baseUrl}/studio`;
const fixturePaths = [
  process.env.STUDIO_REFERENCE_SMOKE_IMAGE_1 ?? path.resolve(process.cwd(), "docs", "images", "media-studio.jpg"),
  process.env.STUDIO_REFERENCE_SMOKE_IMAGE_2 ?? path.resolve(process.cwd(), ".playwright-cli", "nano-after-source-3000.png"),
  process.env.STUDIO_REFERENCE_SMOKE_IMAGE_3 ?? path.resolve(process.cwd(), ".playwright-cli", "nano-multi-3000.png"),
];

await fs.mkdir(outputDir, { recursive: true });
await Promise.all(fixturePaths.map((fixturePath) => fs.access(fixturePath)));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const summary = {
  ok: false,
  studio_url: studioUrl,
  fixtures: fixturePaths,
  slot_counts: {
    after_use_image: 0,
    after_second_click: 0,
    after_third_drop: 0,
    after_remove: 0,
    after_readd: 0,
  },
  prompt_tokens: {
    after_use_image: "",
    after_second_click: "",
    after_reference_insert: "",
  },
  payloads: [],
  payload_before_model_switch: null,
  mobile_widths: {},
  screenshot: successShot,
  used_gallery_source: false,
};

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
      await page.waitForTimeout(600);
      return;
    }
  }
  throw new Error("No matching model option was found.");
}

async function currentSlotCount() {
  return page.locator('[data-testid^="studio-multi-image-slot-"]:not([data-testid$="-remove"])').evaluateAll((nodes) =>
    new Set(
      nodes
        .map((node) => node.getAttribute("data-testid"))
        .filter((value) => typeof value === "string" && value.length > 0),
    ).size,
  );
}

async function clearNanoComposer() {
  const clearButton = page.getByRole("button", { name: "Clear" });
  if ((await clearButton.count()) > 0) {
    await clearButton.first().click();
    await page.waitForTimeout(400);
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const removeButtons = page.locator('[data-testid^="studio-multi-image-slot-"][data-testid$="-remove"], [data-testid="studio-source-asset-tile-remove"]');
    const removeCount = await removeButtons.evaluateAll((nodes) =>
      nodes.filter((node) => node instanceof HTMLElement && node.offsetParent !== null).length,
    );
    if (!removeCount) {
      break;
    }
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('[data-testid^="studio-multi-image-slot-"][data-testid$="-remove"], [data-testid="studio-source-asset-tile-remove"]'),
      );
      const target = buttons.find(
        (node) => node instanceof HTMLElement && node.offsetParent !== null && getComputedStyle(node).visibility !== "hidden",
      );
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      target.click();
      return true;
    });
    if (!clicked) {
      break;
    }
    await page.waitForTimeout(250);
  }
  await page.locator('[data-testid="studio-prompt-input"]').fill("");
  await page.waitForTimeout(250);
}

async function waitForPayloadCount(minimum) {
  await page.waitForFunction((count) => (window.__studioMediaRequests?.length ?? 0) >= count, minimum, {
    timeout: 20000,
  });
}

async function getPayloads() {
  return page.evaluate(() => window.__studioMediaRequests ?? []);
}

async function dropFileOnAddTile(filePath) {
  const data = await fs.readFile(filePath);
  const name = path.basename(filePath);
  const mimeType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataTransfer = await page.evaluateHandle(({ encoded, fileName, fileType }) => {
    const transfer = new DataTransfer();
    const buffer = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    transfer.items.add(new File([buffer], fileName, { type: fileType }));
    return transfer;
  }, { encoded: data.toString("base64"), fileName: name, fileType: mimeType });
  const addTile = page.locator('[data-testid="studio-multi-image-input"]').locator("xpath=..");
  await addTile.dispatchEvent("drop", { dataTransfer });
}

try {
  await page.addInitScript(() => {
    window.__studioMediaRequests = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input ?? "");
      const body = init?.body;
      if (url.includes("/api/control/media") && body instanceof FormData) {
        let attachmentManifest = [];
        try {
          attachmentManifest = JSON.parse(String(body.get("attachment_manifest") ?? "[]"));
        } catch {
          attachmentManifest = [];
        }
        window.__studioMediaRequests.push({
          intent: String(body.get("intent") ?? ""),
          model_key: String(body.get("model_key") ?? ""),
          prompt: String(body.get("prompt") ?? ""),
          source_asset_id: String(body.get("source_asset_id") ?? ""),
          attachment_count: body.getAll("attachments").length,
          attachment_manifest: attachmentManifest,
        });
      }
      return originalFetch(input, init);
    };
  });

  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-gallery"]', { timeout: 60000 });
  await ensureModelSelected(/nano banana 2/i, "nano-banana-2");
  await clearNanoComposer();

  const promptInput = page.locator('[data-testid="studio-prompt-input"]');
  const addInput = page.locator('[data-testid="studio-multi-image-input"]');
  await addInput.setInputFiles(fixturePaths[0]);
  await page.waitForSelector('[data-testid="studio-multi-image-slot-1"]', { timeout: 15000 });
  summary.slot_counts.after_use_image = await currentSlotCount();
  summary.prompt_tokens.after_use_image = await promptInput.inputValue();

  await addInput.setInputFiles(fixturePaths[1]);
  await page.waitForSelector('[data-testid="studio-multi-image-slot-2"]', { timeout: 15000 });
  summary.slot_counts.after_second_click = await currentSlotCount();
  summary.prompt_tokens.after_second_click = await promptInput.inputValue();

  await dropFileOnAddTile(fixturePaths[2]);
  await page.waitForSelector('[data-testid="studio-multi-image-slot-3"]', { timeout: 15000 });
  summary.slot_counts.after_third_drop = await currentSlotCount();

  await promptInput.fill("Nano reference smoke @image ref");
  await page.waitForSelector('[data-testid="studio-prompt-reference-option-1"]', { timeout: 15000 });
  await page.locator('[data-testid="studio-prompt-reference-option-2"]').click();
  summary.prompt_tokens.after_reference_insert = await promptInput.inputValue();

  await page.locator('[data-testid="studio-multi-image-slot-2-remove"]').click();
  await page.waitForTimeout(600);
  summary.slot_counts.after_remove = await currentSlotCount();

  await addInput.setInputFiles(fixturePaths[0]);
  await page.waitForTimeout(800);
  summary.slot_counts.after_readd = await currentSlotCount();

  await waitForPayloadCount(1);
  summary.payloads = await getPayloads();
  summary.payload_before_model_switch =
    [...summary.payloads].reverse().find((payload) => payload.intent === "validate") ?? summary.payloads.at(-1);

  await ensureModelSelected(/nano banana pro/i, "nano-banana-pro");
  await page.waitForTimeout(600);
  await ensureModelSelected(/nano banana 2/i, "nano-banana-2");
  await page.waitForSelector('[data-testid="studio-multi-image-slot-1"]', { timeout: 15000 });

  for (const width of [390, 430, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const toggle = page.locator('button[aria-label="Expand prompt composer"]');
    if ((await toggle.count()) > 0 && await toggle.first().isVisible()) {
      await toggle.first().click();
      await page.waitForTimeout(250);
    }
    const promptBox = await promptInput.boundingBox();
    const visibleAddTile = await page.locator('[data-testid="studio-multi-image-input"]').evaluateAll((nodes) =>
      nodes.some((node) => node instanceof HTMLElement && node.offsetParent !== null),
    );
    const railBox = visibleAddTile
      ? await addInput.boundingBox()
      : await page.locator('[data-testid="studio-multi-image-slot-1"]').boundingBox();
    const generateBox = await page.locator('[data-testid="studio-generate-button"]').boundingBox();
    summary.mobile_widths[String(width)] = {
      prompt_visible: Boolean(promptBox),
      add_tile_visible: Boolean(railBox),
      generate_visible: Boolean(generateBox),
      prompt_width: promptBox?.width ?? null,
    };
  }

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: successShot, fullPage: true });

  summary.ok =
    summary.slot_counts.after_use_image === 1 &&
    summary.slot_counts.after_second_click === 2 &&
    summary.slot_counts.after_third_drop === 3 &&
    summary.slot_counts.after_remove === 2 &&
    summary.slot_counts.after_readd === 3 &&
    summary.prompt_tokens.after_use_image === "" &&
    summary.prompt_tokens.after_second_click === "" &&
    summary.prompt_tokens.after_reference_insert.includes("[image reference 2]") &&
    !summary.payload_before_model_switch?.source_asset_id &&
    summary.payload_before_model_switch?.attachment_count === 3 &&
    summary.payload_before_model_switch?.attachment_manifest?.length === 3 &&
    Object.values(summary.mobile_widths).every((value) => value.prompt_visible && value.add_tile_visible && value.generate_visible);

  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    throw new Error("Nano reference smoke found an ordering, payload, or mobile layout regression.");
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
