import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const apiBaseUrl = (process.env.MEDIA_STUDIO_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const envPath = path.resolve(process.cwd(), ".env");
const fixturePath = process.env.STUDIO_PRESET_SMOKE_IMAGE ?? path.resolve(process.cwd(), "docs", "images", "media-studio.jpg");
const defaultLocalControlToken = "media-studio-local-control-token";
const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").replace("Z", "");
const outputDir = path.resolve(process.cwd(), "output", "live-smoke", timestamp);
const reportPath = path.join(outputDir, "studio-live-smoke.json");

await fs.mkdir(outputDir, { recursive: true });
await fs.access(fixturePath);

async function loadLocalEnvValue(name) {
  if (process.env[name]?.trim()) {
    return process.env[name].trim();
  }
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      if (key !== name) continue;
      return trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {}
  return "";
}

const controlToken = (await loadLocalEnvValue("MEDIA_STUDIO_CONTROL_API_TOKEN")) || defaultLocalControlToken;

const summary = {
  ok: false,
  base_url: baseUrl,
  api_base_url: apiBaseUrl,
  fixture_path: fixturePath,
  control_token_configured: Boolean(controlToken),
  runs: [],
  duplicate_job_keys: [],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload && typeof payload === "object" && "error" in payload && payload.error) || `Request failed: ${url}`);
  }
  return payload;
}

function controlHeaders(accessMode = "read") {
  if (!controlToken) {
    throw new Error("MEDIA_STUDIO_CONTROL_API_TOKEN is required for direct API live smoke reads.");
  }
  return {
    "x-media-studio-control-token": controlToken,
    "x-media-studio-access-mode": accessMode,
  };
}

async function submitForm(formData) {
  const payload = await readJson(`${baseUrl}/api/control/media`, {
    method: "POST",
    body: formData,
  });
  if (!payload?.ok || !payload.batchId || !payload.jobId) {
    throw new Error(payload?.error ?? "Studio live smoke submit failed.");
  }
  return payload;
}

async function pollBatch(batchId, { timeoutMs = 12 * 60 * 1000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await readJson(`${baseUrl}/api/control/media-batches/${batchId}`);
    if (!payload?.ok || !payload.batch) {
      throw new Error(payload?.error ?? `Unable to read batch ${batchId}.`);
    }
    const batch = payload.batch;
    if (["completed", "failed", "partial_failure", "cancelled"].includes(String(batch.status))) {
      return batch;
    }
    await sleep(2200);
  }
  throw new Error(`Timed out waiting for batch ${batchId}.`);
}

async function fetchAssetsPage() {
  const payload = await readJson(`${baseUrl}/api/control/media-assets?limit=48&offset=0`);
  if (!payload?.ok) {
    throw new Error(payload?.error ?? "Unable to read gallery assets.");
  }
  return payload.assets ?? [];
}

async function waitForAssetForJob(jobId, { attempts = 10 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const assets = await fetchAssetsPage();
    const matched = assets.find((asset) => String(asset.job_id ?? "") === String(jobId));
    if (matched) {
      return matched;
    }
    if (attempt < attempts - 1) {
      await sleep(1200);
    }
  }
  throw new Error(`No published asset was found for job ${jobId}.`);
}

async function loadPresetDescriptor() {
  const presets = await readJson(`${apiBaseUrl}/media/presets`, {
    headers: controlHeaders("read"),
  });
  const preset = presets.find((entry) => /3d caricature/i.test(String(entry?.label ?? "")) || /caricature/i.test(String(entry?.label ?? "")));
  if (!preset) {
    throw new Error("Unable to find the 3D caricature preset.");
  }
  const firstSlot = Array.isArray(preset.input_slots_json) ? preset.input_slots_json[0] : null;
  if (!firstSlot?.key) {
    throw new Error("The selected preset does not expose an image slot.");
  }
  return { preset, slotKey: String(firstSlot.key) };
}

function createSubmitForm({ modelKey, prompt, sourceAssetId = null, presetId = null, optionValues = null }) {
  const formData = new FormData();
  formData.set("intent", "submit");
  formData.set("model_key", modelKey);
  formData.set("prompt", prompt);
  formData.set("output_count", "1");
  if (sourceAssetId != null) {
    formData.set("source_asset_id", String(sourceAssetId));
  }
  if (presetId != null) {
    formData.set("preset_id", String(presetId));
  }
  if (optionValues && Object.keys(optionValues).length > 0) {
    formData.set("options", JSON.stringify(optionValues));
  }
  return formData;
}

async function runFlow({ key, formData }) {
  const submitPayload = await submitForm(formData);
  const batch = await pollBatch(submitPayload.batchId);
  const firstJob = Array.isArray(batch.jobs) ? batch.jobs[0] : null;
  const asset = firstJob && String(firstJob.status) === "completed" ? await waitForAssetForJob(firstJob.job_id) : null;
  const record = {
    key,
    batch_id: submitPayload.batchId,
    job_id: submitPayload.jobId,
    batch_status: batch.status,
    job_status: firstJob?.status ?? null,
    error: firstJob?.error ?? null,
    asset_id: asset?.asset_id ?? null,
    asset_generation_kind: asset?.generation_kind ?? null,
    model_key: firstJob?.model_key ?? null,
  };
  summary.runs.push(record);
  if (!firstJob || firstJob.status !== "completed" || !asset) {
    throw new Error(`Live smoke flow ${key} did not complete cleanly.`);
  }
  return { batch, job: firstJob, asset };
}

try {
  const nanoPrompt = "A rain-soaked sci-fi alley market at blue hour, one lone courier under neon signs, cinematic photo realism, no illustration, no cartoon.";
  const videoPrompt = "Animate the scene with subtle camera drift, realistic motion, cinematic photo realism, no illustration, no cartoon.";
  const { preset, slotKey } = await loadPresetDescriptor();

  const nanoText = await runFlow({
    key: "nano_text",
    formData: createSubmitForm({
      modelKey: "nano-banana-2",
      prompt: nanoPrompt,
    }),
  });

  const presetForm = createSubmitForm({
    modelKey: "nano-banana-pro",
    prompt: "Create a premium cinematic 3D caricature portrait.",
    presetId: preset.preset_id,
  });
  presetForm.set("preset_slot_values_json", "{}");
  const fixtureBuffer = await fs.readFile(fixturePath);
  presetForm.append(
    `preset_slot_file:${slotKey}`,
    new Blob([fixtureBuffer], { type: "image/jpeg" }),
    path.basename(fixturePath),
  );
  await runFlow({
    key: "nano_preset",
    formData: presetForm,
  });

  await runFlow({
    key: "kling_2_6_i2v",
    formData: createSubmitForm({
      modelKey: "kling-2.6-i2v",
      prompt: videoPrompt,
      sourceAssetId: nanoText.asset.asset_id,
      optionValues: { duration: 5, sound: false },
    }),
  });

  await runFlow({
    key: "kling_3_0_i2v",
    formData: createSubmitForm({
      modelKey: "kling-3.0-i2v",
      prompt: videoPrompt,
      sourceAssetId: nanoText.asset.asset_id,
      optionValues: { duration: 5, sound: false },
    }),
  });

  const latestAssets = await fetchAssetsPage();
  const counts = new Map();
  for (const asset of latestAssets) {
    const jobId = String(asset.job_id ?? "").trim();
    if (!jobId) continue;
    counts.set(jobId, (counts.get(jobId) ?? 0) + 1);
  }
  summary.duplicate_job_keys = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([jobId]) => jobId);
  summary.ok = summary.runs.every((entry) => entry.asset_id != null && entry.job_status === "completed") && summary.duplicate_job_keys.length === 0;
  await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    throw new Error("Studio live smoke found duplicate assets or incomplete flows.");
  }
} catch (error) {
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
  await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  throw error;
}
