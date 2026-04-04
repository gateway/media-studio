import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { controlApiDataRoot } from "@/lib/paths";

export type MediaIntent = "validate" | "submit" | "enhance";

export function triggerDashboardIndexRefresh() {
  try {
    const child = spawn(process.execPath, ["./scripts/dashboard-index-refresh.mjs"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // Helpful, not required.
  }
}

function parseBoolean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function parseJson(value: FormDataEntryValue | null, fallback: Record<string, unknown> | string[] = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as typeof fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray(value: FormDataEntryValue | null): Array<Record<string, unknown>> {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    ) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

function parseJsonRecord(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return {} as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {} as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function normalizeOptionValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  if (key === "sound") {
    if (lowered === "off" || lowered === "false") return false;
    if (lowered === "on" || lowered === "true") return true;
  }
  if (lowered === "true") return true;
  if (lowered === "false") return false;
  if (key === "duration") {
    const match = lowered.match(/^(\d+)\s*s$/);
    if (match) return Number(match[1]);
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return value;
}

function normalizeOptionsRecord(record: Record<string, unknown> | string[]) {
  if (Array.isArray(record)) {
    return {} as Record<string, unknown>;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, normalizeOptionValue(key, value)]),
  );
}

function classifyAttachment(file: File) {
  if (file.type.startsWith("video/")) {
    return "videos" as const;
  }
  if (file.type.startsWith("audio/")) {
    return "audios" as const;
  }
  return "images" as const;
}

async function stageAttachment(runDir: string, file: File) {
  const fileName = file.name || `upload-${randomUUID()}`;
  const destination = path.join(runDir, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(destination, buffer);
  return destination;
}

export async function buildMediaPayloadFromFormData(formData: FormData) {
  const intent = (String(formData.get("intent") ?? "validate").trim().toLowerCase() || "validate") as MediaIntent;
  const modelKey = String(formData.get("model_key") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const taskMode = String(formData.get("task_mode") ?? "").trim() || null;
  const presetId = String(formData.get("preset_id") ?? "").trim();
  const presetKey = String(formData.get("preset_key") ?? "").trim();
  const sourceAssetId = String(formData.get("source_asset_id") ?? "").trim();
  const outputCount = String(formData.get("output_count") ?? "").trim();
  const enhance = parseBoolean(formData.get("enhance"));
  const options = normalizeOptionsRecord(parseJson(formData.get("options"), {}));
  const multiPrompt = parseJsonArray(formData.get("multi_prompt"));
  const systemPromptIds = parseJson(formData.get("system_prompt_ids"), []) as string[];
  const metadata = parseJson(formData.get("metadata"), {});
  const presetInputs = parseJsonRecord(formData.get("preset_inputs_json"));
  const presetSlotValues = parseJsonRecord(formData.get("preset_slot_values_json"));
  const stagedRoot = path.join(controlApiDataRoot, "uploads", "media-studio", randomUUID());

  await fs.mkdir(stagedRoot, { recursive: true });

  const payload: Record<string, unknown> = {
    model_key: modelKey,
    prompt,
    enhance,
    options,
    metadata,
    selected_system_prompt_ids: systemPromptIds,
  };

  if (multiPrompt.length) {
    payload.multi_prompt = multiPrompt;
  }
  if (taskMode) {
    payload.task_mode = taskMode;
  }
  if (sourceAssetId) {
    payload.source_asset_id = sourceAssetId;
  }
  if (outputCount) {
    const parsedOutputCount = Number(outputCount);
    if (Number.isFinite(parsedOutputCount) && parsedOutputCount > 0) {
      payload.output_count = Math.max(1, Math.trunc(parsedOutputCount));
    }
  }
  if (presetId && !presetId.startsWith("builtin:")) {
    payload.preset_id = presetId;
  } else if (presetKey) {
    payload.prompt_preset_key = presetKey;
  }
  if (Object.keys(presetInputs).length) {
    payload.preset_text_values = presetInputs;
  }

  const normalizedSlotValues: Record<string, Array<Record<string, unknown>>> = {};
  for (const [slotKey, rawValue] of Object.entries(presetSlotValues)) {
    if (!slotKey) continue;
    const items = Array.isArray(rawValue) ? rawValue : [rawValue];
    normalizedSlotValues[slotKey] = items.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  }

  const images: Array<{ path: string }> = [];
  const videos: Array<{ path: string }> = [];
  const audios: Array<{ path: string }> = [];
  const attachments = formData.getAll("attachments");

  for (const entry of attachments) {
    if (!(entry instanceof File) || !entry.size) continue;
    const stagedPath = await stageAttachment(stagedRoot, entry);
    const target = classifyAttachment(entry);
    if (target === "videos") videos.push({ path: stagedPath });
    else if (target === "audios") audios.push({ path: stagedPath });
    else images.push({ path: stagedPath });
  }

  for (const [fieldName, entry] of formData.entries()) {
    if (!fieldName.startsWith("preset_slot_file:")) continue;
    if (!(entry instanceof File) || !entry.size) continue;
    const slotKey = fieldName.slice("preset_slot_file:".length).trim();
    if (!slotKey) continue;
    const stagedPath = await stageAttachment(stagedRoot, entry);
    if (!normalizedSlotValues[slotKey]) {
      normalizedSlotValues[slotKey] = [];
    }
    normalizedSlotValues[slotKey].push({ path: stagedPath });
  }

  for (const [fieldName, entry] of formData.entries()) {
    if (!fieldName.startsWith("preset_slot_asset:")) continue;
    const slotKey = fieldName.slice("preset_slot_asset:".length).trim();
    const rawAssetId = String(entry ?? "").trim();
    if (!slotKey || !rawAssetId) continue;
    const assetId = Number(rawAssetId);
    if (!Number.isFinite(assetId) || assetId <= 0) continue;
    if (!normalizedSlotValues[slotKey]) {
      normalizedSlotValues[slotKey] = [];
    }
    if (
      normalizedSlotValues[slotKey].some((item) => {
        const existingAssetId = Number(item.asset_id);
        return Number.isFinite(existingAssetId) && existingAssetId === assetId;
      })
    ) {
      continue;
    }
    normalizedSlotValues[slotKey].push({ asset_id: assetId });
  }

  if (Object.keys(normalizedSlotValues).length) {
    payload.preset_image_slots = normalizedSlotValues;
  }
  if (images.length) payload.images = images;
  if (videos.length) payload.videos = videos;
  if (audios.length) payload.audios = audios;

  return { intent, payload, modelKey };
}
