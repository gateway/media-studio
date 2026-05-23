import type { GraphNodeDefinition, GraphNodeField } from "../types";

type MediaPresetSpecField = {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  default_value?: unknown;
  placeholder?: string | null;
  help_text?: string | null;
  display_help_text?: string | null;
  options?: unknown[];
};

type MediaPresetModelOption = {
  value: string;
  label: string;
};

type MediaPresetSelectionSummary = {
  title: string;
  subtitle: string;
  description: string;
  details: string[];
};

export type MediaPresetCatalogItem = {
  preset_id: string;
  key: string;
  label: string;
  description?: string;
  status?: string;
  compatible_models?: MediaPresetModelOption[];
  default_model_key?: string;
  text_fields?: MediaPresetSpecField[];
  choice_groups?: MediaPresetSpecField[];
  image_slots?: Array<{ key?: string; label?: string; required?: boolean; max_files?: number }>;
  selection_summary?: MediaPresetSelectionSummary;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function graphMediaPresetCatalog(definition: GraphNodeDefinition): MediaPresetCatalogItem[] {
  const source = asRecord(definition.source);
  const raw = Array.isArray(source.preset_catalog) ? source.preset_catalog : [];
  return raw
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as MediaPresetCatalogItem) : null))
    .filter(Boolean) as MediaPresetCatalogItem[];
}

export function graphMediaPresetById(definition: GraphNodeDefinition, presetId: string | null | undefined) {
  if (!presetId) return null;
  return graphMediaPresetCatalog(definition).find((item) => item.preset_id === presetId) ?? null;
}

function specFieldForPreset(preset: MediaPresetCatalogItem | null, fieldId: string): MediaPresetSpecField | null {
  if (!preset) return null;
  const fieldKey = fieldId.replace(/^(text|choice)__/, "");
  return [...(preset.text_fields ?? []), ...(preset.choice_groups ?? [])].find((item) => {
    const key = String(item.key ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return key === fieldKey;
  }) ?? null;
}

export function graphMediaPresetFieldOverride(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
  field: GraphNodeField,
) {
  if (definition.type !== "preset.render") return null;
  const preset = graphMediaPresetById(definition, String(nodeFields.preset_id ?? ""));
  if (field.id === "preset_model_key") {
    return {
      preset,
      label: "Model",
      placeholder: null,
      helpText: "Only models supported by the selected Media Preset are shown.",
      options: preset?.compatible_models?.length ? preset.compatible_models : field.options,
    };
  }
  const spec = specFieldForPreset(preset, field.id);
  if (!spec) return null;
  return {
    preset,
    label: String(spec.label ?? field.label ?? ""),
    placeholder: String(spec.placeholder ?? field.placeholder ?? "").trim() || null,
    helpText: String(spec.display_help_text ?? spec.help_text ?? field.help_text ?? "").trim() || (spec.required ? "Required." : "Optional."),
    options: Array.isArray(spec.options) && spec.options.length ? spec.options : field.options,
  };
}

export function graphMediaPresetSelectionSummary(definition: GraphNodeDefinition, nodeFields: Record<string, unknown>) {
  if (definition.type !== "preset.render") return null;
  const preset = graphMediaPresetById(definition, String(nodeFields.preset_id ?? ""));
  return preset?.selection_summary ?? null;
}

export function graphMediaPresetSelectionDefaults(definition: GraphNodeDefinition, presetId: string) {
  const preset = graphMediaPresetById(definition, presetId);
  if (!preset) return null;
  const defaults: Record<string, unknown> = {};
  if (preset.default_model_key) defaults.preset_model_key = preset.default_model_key;
  for (const field of preset.text_fields ?? []) {
    if (field.key && field.default_value !== undefined && field.default_value !== null && field.default_value !== "") {
      const key = String(field.key)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      defaults[`text__${key}`] = field.default_value;
    }
  }
  for (const field of preset.choice_groups ?? []) {
    if (field.key && field.default_value !== undefined && field.default_value !== null && field.default_value !== "") {
      const key = String(field.key)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      defaults[`choice__${key}`] = field.default_value;
    }
  }
  return defaults;
}
