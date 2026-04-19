import { spawn } from "node:child_process";

import { registerReferenceMediaFile, resolveReferenceMedia } from "@/lib/reference-media-storage";

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

async function readFormText(value: FormDataEntryValue | null) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "text" in value && typeof value.text === "function") {
    return await value.text();
  }
  return String(value ?? "");
}

async function parseBoolean(value: FormDataEntryValue | null) {
  return (await readFormText(value)).trim().toLowerCase() === "true";
}

async function parseJson(value: FormDataEntryValue | null, fallback: Record<string, unknown> | string[] = {}) {
  const raw = (await readFormText(value)).trim();
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as typeof fallback;
  } catch {
    return fallback;
  }
}

async function parseJsonArray(value: FormDataEntryValue | null): Promise<Array<Record<string, unknown>>> {
  const raw = (await readFormText(value)).trim();
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

async function parseAttachmentManifest(value: FormDataEntryValue | null) {
  return (await parseJsonArray(value))
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      kind: String(item.kind ?? "").trim(),
      role: String(item.role ?? "").trim() || null,
      reference_id: String(item.reference_id ?? "").trim() || null,
      has_file: Boolean(item.has_file),
      duration_seconds:
        typeof item.duration_seconds === "number"
          ? item.duration_seconds
          : Number.isFinite(Number(item.duration_seconds))
            ? Number(item.duration_seconds)
            : null,
    }))
    .filter((item) => item.id && item.kind);
}

async function parseJsonRecord(value: FormDataEntryValue | null) {
  const raw = (await readFormText(value)).trim();
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

export async function buildMediaPayloadFromFormData(formData: FormData) {
  const intent = (String(formData.get("intent") ?? "validate").trim().toLowerCase() || "validate") as MediaIntent;
  const modelKey = String(formData.get("model_key") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const taskMode = String(formData.get("task_mode") ?? "").trim() || null;
  const presetId = String(formData.get("preset_id") ?? "").trim();
  const presetKey = String(formData.get("preset_key") ?? "").trim();
  const sourceAssetId = String(formData.get("source_asset_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const outputCount = String(formData.get("output_count") ?? "").trim();
  const enhance = await parseBoolean(formData.get("enhance"));
  const options = normalizeOptionsRecord(await parseJson(formData.get("options"), {}));
  const multiPrompt = await parseJsonArray(formData.get("multi_prompt"));
  const systemPromptIds = (await parseJson(formData.get("system_prompt_ids"), [])) as string[];
  const metadata = await parseJson(formData.get("metadata"), {});
  const presetInputs = await parseJsonRecord(formData.get("preset_inputs_json"));
  const presetSlotValues = await parseJsonRecord(formData.get("preset_slot_values_json"));
  const attachmentManifest = await parseAttachmentManifest(formData.get("attachment_manifest"));

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
  if (projectId) {
    payload.project_id = projectId;
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

  const images: Array<{ path: string; role?: string; duration_seconds?: number }> = [];
  const videos: Array<{ path: string; role?: string; duration_seconds?: number }> = [];
  const audios: Array<{ path: string; role?: string; duration_seconds?: number }> = [];
  const attachmentFiles = formData
    .getAll("attachments")
    .filter((entry): entry is File => entry instanceof File && Boolean(entry.size));
  let fileIndex = 0;

  for (const manifestEntry of attachmentManifest) {
    let ref:
      | {
          path: string;
          role?: string;
          duration_seconds?: number;
          reference_id?: string;
        }
      | null = null;
    if (manifestEntry.reference_id) {
      const reference = await resolveReferenceMedia(manifestEntry.reference_id);
      if (!reference?.stored_path) {
        throw new Error("Unable to resolve the selected reference media item.");
      }
      ref = {
        reference_id: reference.reference_id,
        path: reference.stored_path,
        ...(manifestEntry.role ? { role: manifestEntry.role } : {}),
        ...(typeof manifestEntry.duration_seconds === "number" ? { duration_seconds: manifestEntry.duration_seconds } : {}),
      };
    } else if (manifestEntry.has_file) {
      const file = attachmentFiles[fileIndex] ?? null;
      fileIndex += 1;
      if (!file) {
        continue;
      }
      const registered = await registerReferenceMediaFile(file);
      ref = {
        reference_id: registered.reference_id,
        path: registered.stored_path,
        ...(manifestEntry.role ? { role: manifestEntry.role } : {}),
        ...(typeof manifestEntry.duration_seconds === "number" ? { duration_seconds: manifestEntry.duration_seconds } : {}),
      };
    }
    if (!ref) continue;
    const target = manifestEntry.kind || "images";
    if (target === "videos") videos.push(ref);
    else if (target === "audios") audios.push(ref);
    else images.push(ref);
  }

  for (; fileIndex < attachmentFiles.length; fileIndex += 1) {
    const file = attachmentFiles[fileIndex];
    const registered = await registerReferenceMediaFile(file);
    const ref = { reference_id: registered.reference_id, path: registered.stored_path };
    const target = classifyAttachment(file);
    if (target === "videos") videos.push(ref);
    else if (target === "audios") audios.push(ref);
    else images.push(ref);
  }

  for (const [fieldName, entry] of formData.entries()) {
    if (!fieldName.startsWith("preset_slot_file:")) continue;
    if (!(entry instanceof File) || !entry.size) continue;
    const slotKey = fieldName.slice("preset_slot_file:".length).trim();
    if (!slotKey) continue;
    const registered = await registerReferenceMediaFile(entry);
    if (!normalizedSlotValues[slotKey]) {
      normalizedSlotValues[slotKey] = [];
    }
    normalizedSlotValues[slotKey].push({ reference_id: registered.reference_id, path: registered.stored_path });
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

  for (const [slotKey, rawValue] of Object.entries(normalizedSlotValues)) {
    normalizedSlotValues[slotKey] = await Promise.all(
      rawValue.map(async (item) => {
        const referenceId = String(item.reference_id ?? "").trim();
        if (!referenceId || item.path) {
          return item;
        }
        const reference = await resolveReferenceMedia(referenceId);
        if (!reference?.stored_path) {
          throw new Error("Unable to resolve the selected preset reference media item.");
        }
        return {
          ...item,
          reference_id: reference.reference_id,
          path: reference.stored_path,
        };
      }),
    );
  }

  if (Object.keys(normalizedSlotValues).length) {
    payload.preset_image_slots = normalizedSlotValues;
  }
  if (images.length) payload.images = images;
  if (videos.length) payload.videos = videos;
  if (audios.length) payload.audios = audios;

  return { intent, payload, modelKey };
}
