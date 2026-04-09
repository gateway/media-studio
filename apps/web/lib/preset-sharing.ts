import type { MediaPreset } from "@/lib/types";
import { slugifyKey } from "@/lib/utils";

export const PORTABLE_PRESET_BUNDLE_KIND = "media_studio_preset_bundle";
export const PORTABLE_PRESET_BUNDLE_SCHEMA_VERSION = 1;

export type PortablePresetSourceKind = "builtin" | "built_in_override" | "custom" | "imported";

export type PortablePresetField = {
  key: string;
  label: string;
  placeholder: string;
  default_value: string;
  required: boolean;
};

export type PortablePresetSlot = {
  key: string;
  label: string;
  help_text: string;
  required: boolean;
  max_files: number;
};

export type PortablePresetThumbnail = {
  file_name: string;
};

export type PortablePresetPayload = {
  key: string;
  label: string;
  description: string | null;
  source_kind: PortablePresetSourceKind;
  base_builtin_key: string | null;
  applies_to_models: string[];
  applies_to_task_modes: string[];
  applies_to_input_patterns: string[];
  prompt_template: string;
  system_prompt_template: string | null;
  system_prompt_ids: string[];
  default_options_json: Record<string, unknown>;
  rules_json: Record<string, unknown>;
  requires_image: boolean;
  requires_video: boolean;
  requires_audio: boolean;
  input_schema_json: PortablePresetField[];
  input_slots_json: PortablePresetSlot[];
  choice_groups_json: Array<Record<string, unknown>>;
  notes: string | null;
  version: string;
  priority: number;
  thumbnail: PortablePresetThumbnail | null;
};

export type PortablePresetBundleManifest = {
  schema_version: number;
  kind: string;
  exported_at: string;
  preset: PortablePresetPayload;
};

export type ResolvedPresetImport = {
  status: "skipped" | "created" | "copied";
  payload: Record<string, unknown> | null;
  message: string;
  duplicatePresetId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableString(value: unknown) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeStringArray(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      items
        .map((item) => normalizeString(item))
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeBoolean(value: unknown) {
  return Boolean(value);
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeField(value: unknown): PortablePresetField | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const key = normalizeString(record.key);
  const label = normalizeString(record.label);
  if (!key || !label) {
    return null;
  }
  return {
    key,
    label,
    placeholder: normalizeString(record.placeholder),
    default_value: normalizeString(record.default_value),
    required: normalizeBoolean(record.required),
  };
}

function normalizeSlot(value: unknown): PortablePresetSlot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const key = normalizeString(record.key);
  const label = normalizeString(record.label);
  if (!key || !label) {
    return null;
  }
  return {
    key,
    label,
    help_text: normalizeString(record.help_text),
    required: normalizeBoolean(record.required),
    max_files: Math.max(1, normalizeNumber(record.max_files, 1)),
  };
}

function normalizeChoiceGroups(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => normalizeUnknown(item)).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function normalizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUnknown(entry));
  }
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, normalizeUnknown(record[key])]),
  );
}

function normalizeSourceKind(value: unknown): PortablePresetSourceKind {
  const normalized = normalizeString(value);
  if (
    normalized === "builtin" ||
    normalized === "built_in_override" ||
    normalized === "custom" ||
    normalized === "imported"
  ) {
    return normalized;
  }
  return "custom";
}

export function normalizePortablePresetPayload(
  preset: MediaPreset | Record<string, unknown> | PortablePresetPayload,
): PortablePresetPayload {
  const record = preset as Record<string, unknown>;
  const inputSchema = (Array.isArray(record.input_schema_json) ? record.input_schema_json : [])
    .map((field) => normalizeField(field))
    .filter((field): field is PortablePresetField => Boolean(field))
    .sort((left, right) => left.key.localeCompare(right.key));
  const inputSlots = (Array.isArray(record.input_slots_json) ? record.input_slots_json : [])
    .map((slot) => normalizeSlot(slot))
    .filter((slot): slot is PortablePresetSlot => Boolean(slot))
    .sort((left, right) => left.key.localeCompare(right.key));
  const thumbnailRecord = asRecord(record.thumbnail);
  const thumbnailFileName = thumbnailRecord ? normalizeString(thumbnailRecord.file_name) : "";

  return {
    key: normalizeString(record.key),
    label: normalizeString(record.label),
    description: normalizeNullableString(record.description),
    source_kind: normalizeSourceKind(record.source_kind),
    base_builtin_key: normalizeNullableString(record.base_builtin_key),
    applies_to_models: normalizeStringArray(record.applies_to_models ?? record.applies_to_models_json),
    applies_to_task_modes: normalizeStringArray(record.applies_to_task_modes ?? record.applies_to_task_modes_json),
    applies_to_input_patterns: normalizeStringArray(record.applies_to_input_patterns ?? record.applies_to_input_patterns_json),
    prompt_template: normalizeString(record.prompt_template),
    system_prompt_template: normalizeNullableString(record.system_prompt_template),
    system_prompt_ids: normalizeStringArray(record.system_prompt_ids ?? record.system_prompt_ids_json),
    default_options_json: (normalizeUnknown(asRecord(record.default_options_json) ?? {}) as Record<string, unknown>) ?? {},
    rules_json: (normalizeUnknown(asRecord(record.rules_json) ?? {}) as Record<string, unknown>) ?? {},
    requires_image: normalizeBoolean(record.requires_image),
    requires_video: normalizeBoolean(record.requires_video),
    requires_audio: normalizeBoolean(record.requires_audio),
    input_schema_json: inputSchema,
    input_slots_json: inputSlots,
    choice_groups_json: normalizeChoiceGroups(record.choice_groups_json),
    notes: normalizeNullableString(record.notes),
    version: normalizeString(record.version) || "v1",
    priority: normalizeNumber(record.priority, 100),
    thumbnail: thumbnailFileName ? { file_name: thumbnailFileName } : null,
  };
}

export function createPortablePresetBundleManifest(
  preset: MediaPreset | Record<string, unknown> | PortablePresetPayload,
): PortablePresetBundleManifest {
  return {
    schema_version: PORTABLE_PRESET_BUNDLE_SCHEMA_VERSION,
    kind: PORTABLE_PRESET_BUNDLE_KIND,
    exported_at: new Date().toISOString(),
    preset: normalizePortablePresetPayload(preset),
  };
}

export function parsePortablePresetBundleManifest(value: unknown): PortablePresetBundleManifest {
  const record = asRecord(value);
  if (!record) {
    throw new Error("The preset bundle manifest is missing.");
  }
  if (normalizeString(record.kind) !== PORTABLE_PRESET_BUNDLE_KIND) {
    throw new Error("This file is not a Media Studio preset bundle.");
  }
  const schemaVersion = normalizeNumber(record.schema_version, NaN);
  if (schemaVersion !== PORTABLE_PRESET_BUNDLE_SCHEMA_VERSION) {
    throw new Error("This preset bundle format is not supported.");
  }
  const presetRecord = asRecord(record.preset);
  if (!presetRecord) {
    throw new Error("The preset bundle is missing the preset payload.");
  }
  return {
    schema_version: schemaVersion,
    kind: PORTABLE_PRESET_BUNDLE_KIND,
    exported_at: normalizeString(record.exported_at) || new Date(0).toISOString(),
    preset: normalizePortablePresetPayload(presetRecord),
  };
}

function comparablePortablePresetPayload(preset: PortablePresetPayload) {
  const { key: _key, source_kind: _sourceKind, base_builtin_key: _baseBuiltinKey, thumbnail: _thumbnail, ...rest } = preset;
  return rest;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeUnknown(value));
}

export function portablePresetFingerprint(preset: PortablePresetPayload) {
  return stableSerialize(comparablePortablePresetPayload(normalizePortablePresetPayload(preset)));
}

function isSharedPreset(preset: MediaPreset | Record<string, unknown>) {
  const record = preset as Record<string, unknown>;
  const presetId = normalizeString(record.preset_id);
  const sourceKind = normalizeSourceKind(record.source_kind);
  return sourceKind === "builtin" || sourceKind === "built_in_override" || presetId.endsWith("-shared");
}

function nextCopyKey(baseKey: string, index: number) {
  const suffix = index === 1 ? "-copy" : `-copy-${index}`;
  return slugifyKey(`${baseKey}${suffix}`);
}

function nextCopyLabel(baseLabel: string, index: number) {
  return index === 1 ? `${baseLabel} Copy` : `${baseLabel} Copy ${index}`;
}

function resolveCopyIdentity(importedPreset: PortablePresetPayload, presets: Array<MediaPreset | Record<string, unknown>>) {
  const existingKeys = new Set(presets.map((preset) => normalizeString((preset as Record<string, unknown>).key)));
  const existingLabels = new Set(presets.map((preset) => normalizeString((preset as Record<string, unknown>).label)));
  const baseKey = importedPreset.key;
  const baseLabel = importedPreset.label;

  let index = 1;
  while (index < 5000) {
    const candidateKey = nextCopyKey(baseKey, index);
    const candidateLabel = nextCopyLabel(baseLabel, index);
    if (!existingKeys.has(candidateKey) && !existingLabels.has(candidateLabel)) {
      return { key: candidateKey, label: candidateLabel };
    }
    index += 1;
  }
  throw new Error("Unable to generate a unique preset copy name.");
}

export function buildImportedPresetPayload(
  preset: PortablePresetPayload,
  {
    key = preset.key,
    label = preset.label,
    thumbnailPath = null,
    thumbnailUrl = null,
  }: {
    key?: string;
    label?: string;
    thumbnailPath?: string | null;
    thumbnailUrl?: string | null;
  } = {},
) {
  const normalized = normalizePortablePresetPayload(preset);
  const appliesToModels = normalized.applies_to_models.length
    ? normalized.applies_to_models
    : ["nano-banana-2"];
  return {
    key,
    label,
    description: normalized.description,
    status: "active",
    model_key: appliesToModels[0],
    source_kind: "imported",
    base_builtin_key: normalized.base_builtin_key,
    applies_to_models: appliesToModels,
    applies_to_task_modes: normalized.applies_to_task_modes,
    applies_to_input_patterns: normalized.applies_to_input_patterns,
    prompt_template: normalized.prompt_template,
    system_prompt_template: normalized.system_prompt_template,
    system_prompt_ids: normalized.system_prompt_ids,
    default_options_json: normalized.default_options_json,
    rules_json: normalized.rules_json,
    requires_image: normalized.requires_image,
    requires_video: normalized.requires_video,
    requires_audio: normalized.requires_audio,
    input_schema_json: normalized.input_schema_json,
    input_slots_json: normalized.input_slots_json,
    choice_groups_json: normalized.choice_groups_json,
    thumbnail_path: thumbnailPath,
    thumbnail_url: thumbnailUrl,
    notes: normalized.notes,
    version: normalized.version,
    priority: normalized.priority,
  };
}

export function resolvePresetImport(
  existingPresets: MediaPreset[],
  incomingPreset: PortablePresetPayload,
): ResolvedPresetImport {
  const normalizedIncoming = normalizePortablePresetPayload(incomingPreset);
  const incomingFingerprint = portablePresetFingerprint(normalizedIncoming);
  const sameKeyPreset =
    existingPresets.find((preset) => normalizeString(preset.key) === normalizedIncoming.key) ?? null;
  const sameContentPreset =
    existingPresets.find((preset) => portablePresetFingerprint(normalizePortablePresetPayload(preset)) === incomingFingerprint) ?? null;

  if (sameContentPreset && !isSharedPreset(sameContentPreset)) {
    return {
      status: "skipped",
      payload: null,
      message: "Preset already installed.",
      duplicatePresetId: sameContentPreset.preset_id,
    };
  }

  if (sameKeyPreset || sameContentPreset) {
    const copyIdentity = resolveCopyIdentity(normalizedIncoming, existingPresets);
    return {
      status: "copied",
      payload: buildImportedPresetPayload(normalizedIncoming, copyIdentity),
      message: `Preset imported as ${copyIdentity.label}.`,
      duplicatePresetId: sameKeyPreset?.preset_id ?? sameContentPreset?.preset_id ?? null,
    };
  }

  return {
    status: "created",
    payload: buildImportedPresetPayload(normalizedIncoming),
    message: "Preset imported.",
    duplicatePresetId: null,
  };
}
