import type { MediaPreset } from "@/lib/types";
import { normalizeMediaPresetCategory } from "@/lib/media-preset-categories";
import type { PresetFieldInput, PresetFormState, PresetImageSlotInput } from "./media-preset-editor-types";

function createLocalId(prefix: string) {
  const randomValue =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomValue}`;
}

export function createPresetFieldInput(): PresetFieldInput {
  return {
    id: createLocalId("preset-field"),
    key: "",
    label: "",
    placeholder: "",
    defaultValue: "",
    required: true,
  };
}

export function createPresetImageSlot(): PresetImageSlotInput {
  return {
    id: createLocalId("preset-slot"),
    key: "",
    label: "",
    helpText: "",
    maxFiles: 1,
    required: true,
  };
}

export function normalizePresetFieldKey(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function presetFieldKeyToken(key: string) {
  return `{{${key}}}`;
}

export function presetSlotKeyToken(key: string) {
  return `[[${key}]]`;
}

export function emptyPresetForm(defaultModelKey: string | null | undefined): PresetFormState {
  return {
    presetId: null,
    sourceKind: "custom",
    baseBuiltinKey: null,
    key: "",
    label: "",
    description: "",
    category: "general",
    status: "active",
    appliesToModels:
      defaultModelKey === "nano-banana-pro" ? ["nano-banana-pro"] : ["nano-banana-2"],
    promptTemplate: "",
    notes: "",
    inputFields: [],
    imageSlots: [],
    thumbnailPath: "",
    thumbnailUrl: "",
  };
}

export function buildPresetForm(preset: Partial<MediaPreset> | null | undefined, defaultModelKey: string | null | undefined): PresetFormState {
  if (!preset) {
    return emptyPresetForm(defaultModelKey);
  }
  return {
    presetId: preset.preset_id ?? null,
    sourceKind: preset.source_kind ?? "custom",
    baseBuiltinKey: preset.base_builtin_key ?? null,
    key: preset.key ?? "",
    label: preset.label ?? "",
    description: preset.description ?? "",
    category: normalizeMediaPresetCategory(preset.category),
    status: preset.status === "archived" ? "inactive" : ((preset.status ?? "active") as "active" | "inactive"),
    appliesToModels: preset.applies_to_models?.length
      ? preset.applies_to_models
      : preset.model_key
        ? [preset.model_key]
        : ["nano-banana-2"],
    promptTemplate: preset.prompt_template ?? "",
    notes: preset.notes ?? "",
    inputFields: ((preset.input_schema_json as Array<Record<string, unknown>> | undefined) ?? []).map((field) => ({
      id: createLocalId("preset-field"),
      key: String(field.key ?? ""),
      label: String(field.label ?? ""),
      placeholder: String(field.placeholder ?? ""),
      defaultValue: String(field.default_value ?? ""),
      required: Boolean(field.required ?? true),
    })),
    imageSlots: ((preset.input_slots_json as Array<Record<string, unknown>> | undefined) ?? []).map((slot) => ({
      id: createLocalId("preset-slot"),
      key: String(slot.key ?? slot.slot ?? ""),
      label: String(slot.label ?? ""),
      helpText: String(slot.help_text ?? ""),
      maxFiles: Number(slot.max_files ?? 1) || 1,
      required: Boolean(slot.required ?? true),
    })),
    thumbnailPath: preset.thumbnail_path ?? "",
    thumbnailUrl: preset.thumbnail_url ?? "",
  };
}

export function normalizePresetEditorError(form: PresetFormState) {
  if (!form.label.trim()) {
    return "Preset name is required.";
  }
  if (!form.promptTemplate.trim()) {
    return "Prompt text is required.";
  }
  const fieldKeys = form.inputFields.map((field) => normalizePresetFieldKey(field.key)).filter(Boolean);
  const slotKeys = form.imageSlots.map((slot) => normalizePresetFieldKey(slot.key)).filter(Boolean);
  if (new Set(fieldKeys).size !== fieldKeys.length) {
    return "Text field keys must be unique.";
  }
  if (new Set(slotKeys).size !== slotKeys.length) {
    return "Image slot keys must be unique.";
  }
  if (form.inputFields.some((field) => !normalizePresetFieldKey(field.key) || !field.label.trim())) {
    return "Each text field needs a key and a label.";
  }
  if (form.imageSlots.some((slot) => !normalizePresetFieldKey(slot.key) || !slot.label.trim())) {
    return "Each image slot needs a key and a label.";
  }

  const promptFieldRefs = new Set(
    Array.from(form.promptTemplate.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map((match) => match[1]),
  );
  const promptSlotRefs = new Set(
    Array.from(form.promptTemplate.matchAll(/\[\[([a-zA-Z0-9_]+)\]\]/g)).map((match) => match[1]),
  );
  const normalizedFieldKeys = new Set(fieldKeys);
  const normalizedSlotKeys = new Set(slotKeys);
  const missingFieldRefs = Array.from(promptFieldRefs).filter((key) => !normalizedFieldKeys.has(key));
  const missingSlotRefs = Array.from(promptSlotRefs).filter((key) => !normalizedSlotKeys.has(key));
  const unusedFields = fieldKeys.filter((key) => !promptFieldRefs.has(key));
  const unusedSlots = slotKeys.filter((key) => !promptSlotRefs.has(key));

  if (missingFieldRefs.length) {
    return `Prompt is missing configured text field definitions for: ${missingFieldRefs
      .map((key) => presetFieldKeyToken(key))
      .join(", ")}`;
  }
  if (missingSlotRefs.length) {
    return `Prompt is missing configured image slot definitions for: ${missingSlotRefs
      .map((key) => presetSlotKeyToken(key))
      .join(", ")}`;
  }
  if (unusedFields.length) {
    return `Configured text fields are not referenced in the prompt: ${unusedFields
      .map((key) => presetFieldKeyToken(key))
      .join(", ")}`;
  }
  if (unusedSlots.length) {
    return `Configured image slots are not referenced in the prompt: ${unusedSlots
      .map((key) => presetSlotKeyToken(key))
      .join(", ")}`;
  }
  return null;
}
