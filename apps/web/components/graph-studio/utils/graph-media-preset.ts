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
  default_options?: Record<string, unknown>;
  text_fields?: MediaPresetSpecField[];
  image_slots?: Array<{
    key?: string;
    label?: string;
    required?: boolean;
    max_files?: number;
  }>;
  selection_summary?: MediaPresetSelectionSummary;
};

const MODEL_OPTION_FIELD_PREFIX = "option__";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleFromKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modelOptionsFromPreset(
  item: Record<string, unknown>,
): MediaPresetModelOption[] {
  const compatibleModels = Array.isArray(item.compatible_models)
    ? item.compatible_models
    : [];
  if (compatibleModels.length) {
    return compatibleModels
      .map((model) => {
        const record = asRecord(model);
        const value = String(record.value ?? "").trim();
        if (!value) return null;
        return { value, label: String(record.label ?? titleFromKey(value)) };
      })
      .filter(Boolean) as MediaPresetModelOption[];
  }
  const modelKeys = [
    ...(Array.isArray(item.applies_to_models_json)
      ? item.applies_to_models_json
      : []),
    ...(Array.isArray(item.applies_to_models) ? item.applies_to_models : []),
    item.model_key,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return modelKeys
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map((value) => ({ value, label: titleFromKey(value) }));
}

function normalizePresetCatalogItem(
  value: unknown,
): MediaPresetCatalogItem | null {
  const item = asRecord(value);
  const presetId = String(item.preset_id ?? "").trim();
  if (!presetId) return null;
  const inputFields = Array.isArray(item.text_fields)
    ? item.text_fields
    : Array.isArray(item.input_schema_json)
      ? item.input_schema_json
      : [];
  const imageSlots = Array.isArray(item.image_slots)
    ? item.image_slots
    : Array.isArray(item.input_slots_json)
      ? item.input_slots_json
      : [];
  const compatibleModels = modelOptionsFromPreset(item);
  const label = String(item.label ?? item.key ?? presetId);
  const requiredSlots = imageSlots
    .map((slot) => asRecord(slot))
    .filter((slot) => Boolean(slot.required))
    .map((slot) =>
      String(slot.label ?? titleFromKey(String(slot.key ?? ""))).trim(),
    )
    .filter(Boolean);
  return {
    preset_id: presetId,
    key: String(item.key ?? presetId),
    label,
    description: String(item.description ?? ""),
    status: String(item.status ?? "active"),
    compatible_models: compatibleModels,
    default_model_key: String(
      item.default_model_key ??
        item.model_key ??
        compatibleModels[0]?.value ??
        "",
    ),
    default_options: asRecord(
      item.default_options ?? item.default_options_json,
    ),
    text_fields: inputFields.map((field) => {
      const record = asRecord(field);
      return {
        key: String(record.key ?? "").trim(),
        label: String(record.label ?? titleFromKey(String(record.key ?? ""))),
        type:
          Boolean(record.multiline) || record.type === "textarea"
            ? "textarea"
            : "text",
        required: Boolean(record.required),
        default_value: record.default_value,
        placeholder:
          typeof record.placeholder === "string" ? record.placeholder : null,
        help_text:
          typeof record.help_text === "string"
            ? record.help_text
            : typeof record.description === "string"
              ? record.description
              : null,
        display_help_text:
          typeof record.display_help_text === "string"
            ? record.display_help_text
            : null,
      };
    }),
    image_slots: imageSlots.map((slot) => {
      const record = asRecord(slot);
      return {
        key: String(record.key ?? "").trim(),
        label: String(record.label ?? titleFromKey(String(record.key ?? ""))),
        required: Boolean(record.required),
        max_files: Number(record.max_files ?? 1),
      };
    }),
    selection_summary: {
      title: label,
      subtitle: "Media Preset",
      description: String(item.description ?? "Run this saved Media Preset."),
      details: [
        `Model: ${compatibleModels[0]?.label ?? "No compatible model"}`,
        `Image slots: ${imageSlots.length}`,
        requiredSlots.length
          ? `Required images: ${requiredSlots.join(", ")}`
          : "Required images: none",
      ],
    },
  };
}

function selectedPresetFromNodeFields(nodeFields: Record<string, unknown>) {
  const raw = nodeFields.__preset_catalog_item_json;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return normalizePresetCatalogItem(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return normalizePresetCatalogItem(raw);
}

export function graphMediaPresetCatalog(
  definition: GraphNodeDefinition,
): MediaPresetCatalogItem[] {
  const source = asRecord(definition.source);
  const raw = Array.isArray(source.preset_catalog) ? source.preset_catalog : [];
  return raw
    .map((item) => normalizePresetCatalogItem(item))
    .filter(Boolean) as MediaPresetCatalogItem[];
}

export function graphMediaPresetById(
  definition: GraphNodeDefinition,
  presetId: string | null | undefined,
  nodeFields?: Record<string, unknown>,
) {
  if (!presetId) return null;
  const selected = nodeFields ? selectedPresetFromNodeFields(nodeFields) : null;
  if (selected?.preset_id === presetId) return selected;
  return (
    graphMediaPresetCatalog(definition).find(
      (item) => item.preset_id === presetId,
    ) ?? null
  );
}

function specFieldForPreset(
  preset: MediaPresetCatalogItem | null,
  fieldId: string,
): MediaPresetSpecField | null {
  if (!preset) return null;
  const fieldKey = fieldId.replace(/^text__/, "");
  return (
    ((preset.text_fields ?? []).find(
      (item) => {
        const key = String(item.key ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
        return key === fieldKey;
      },
    ) as MediaPresetSpecField | undefined) ?? null
  );
}

export function graphMediaPresetFieldOverride(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
  field: GraphNodeField,
) {
  if (definition.type !== "preset.render") return null;
  const preset = graphMediaPresetById(
    definition,
    String(nodeFields.preset_id ?? ""),
    nodeFields,
  );
  if (field.id === "preset_model_key") {
    return {
      preset,
      label: "Model",
      placeholder: null,
      helpText: "Only models supported by the selected Media Preset are shown.",
      options: preset?.compatible_models?.length
        ? preset.compatible_models
        : field.options,
    };
  }
  const spec = specFieldForPreset(preset, field.id);
  if (!spec) return null;
  return {
    preset,
    label: String(spec.label ?? field.label ?? ""),
    placeholder:
      String(spec.placeholder ?? field.placeholder ?? "").trim() || null,
    helpText:
      String(
        spec.display_help_text ?? spec.help_text ?? field.help_text ?? "",
      ).trim() || (spec.required ? "Required." : "Optional."),
    options:
      Array.isArray(spec.options) && spec.options.length
        ? spec.options
        : field.options,
  };
}

export function graphMediaPresetSelectionSummary(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
) {
  if (definition.type !== "preset.render") return null;
  const preset = graphMediaPresetById(
    definition,
    String(nodeFields.preset_id ?? ""),
    nodeFields,
  );
  return preset?.selection_summary ?? null;
}

export function graphMediaPresetSelectionDefaults(
  definition: GraphNodeDefinition,
  presetId: string,
  nodeFields: Record<string, unknown> = {},
) {
  const preset = graphMediaPresetById(definition, presetId, nodeFields);
  if (!preset) return null;
  const defaults: Record<string, unknown> = {};
  if (preset.default_model_key)
    defaults.preset_model_key = preset.default_model_key;
  for (const [key, value] of Object.entries(preset.default_options ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      defaults[`${MODEL_OPTION_FIELD_PREFIX}${key}`] = value;
    }
  }
  for (const field of preset.text_fields ?? []) {
    if (
      field.key &&
      field.default_value !== undefined &&
      field.default_value !== null &&
      field.default_value !== ""
    ) {
      defaults[`text__${slug(String(field.key))}`] = field.default_value;
    }
  }
  return defaults;
}

function graphMediaPresetSelectedModel(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
) {
  const preset = graphMediaPresetById(
    definition,
    String(nodeFields.preset_id ?? ""),
    nodeFields,
  );
  if (!preset) return null;
  const selected = String(nodeFields.preset_model_key ?? "").trim();
  if (
    selected &&
    (preset.compatible_models ?? []).some((item) => item.value === selected)
  )
    return selected;
  return (
    preset.default_model_key || preset.compatible_models?.[0]?.value || null
  );
}

export function graphMediaPresetModelOptionFields(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
): GraphNodeField[] {
  if (definition.type !== "preset.render") return [];
  const modelKey = graphMediaPresetSelectedModel(definition, nodeFields);
  if (!modelKey) return [];
  const source = asRecord(definition.source);
  const fieldsByModel = asRecord(source.model_option_fields_by_model);
  const rawFields = fieldsByModel[modelKey];
  if (!Array.isArray(rawFields)) return [];
  const preset = graphMediaPresetById(
    definition,
    String(nodeFields.preset_id ?? ""),
    nodeFields,
  );
  const defaultOptions = preset?.default_options ?? {};
  return rawFields
    .map((field) => asRecord(field))
    .filter(
      (field) =>
        typeof field.id === "string" && typeof field.label === "string",
    )
    .map((field) => {
      const optionKey =
        String(field.option_key ?? "").trim() ||
        String(field.id).replace(
          new RegExp(`^${MODEL_OPTION_FIELD_PREFIX}`),
          "",
        );
      const presetDefault = defaultOptions[optionKey];
      const visibleIf = asRecord(field.visible_if);
      return {
        id: String(field.id),
        label: String(field.label),
        type: String(field.type ?? "text"),
        required: Boolean(field.required),
        default:
          presetDefault !== undefined &&
          presetDefault !== null &&
          presetDefault !== ""
            ? presetDefault
            : field.default,
        placeholder:
          typeof field.placeholder === "string" ? field.placeholder : null,
        options: Array.isArray(field.options) ? field.options : [],
        min: typeof field.min === "number" ? field.min : null,
        max: typeof field.max === "number" ? field.max : null,
        help_text: typeof field.help_text === "string" ? field.help_text : null,
        advanced: Boolean(field.advanced),
        visible_if: Object.keys(visibleIf).length
          ? (visibleIf as GraphNodeField["visible_if"])
          : null,
      };
    });
}

export function graphMediaPresetDynamicFields(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
): GraphNodeField[] {
  if (definition.type !== "preset.render") return [];
  const preset = graphMediaPresetById(
    definition,
    String(nodeFields.preset_id ?? ""),
    nodeFields,
  );
  if (!preset) return [];
  const textFields = (preset.text_fields ?? [])
    .filter((field) => String(field.key ?? "").trim())
    .map((field) => ({
      id: `text__${slug(String(field.key))}`,
      label: String(field.label ?? titleFromKey(String(field.key))),
      type: String(field.type ?? "text"),
      required: Boolean(field.required),
      default: null,
      placeholder: field.placeholder ?? null,
      options: Array.isArray(field.options) ? field.options : [],
      help_text:
        String(field.display_help_text ?? field.help_text ?? "").trim() ||
        (field.required ? "Required." : "Optional."),
    }));
  return textFields;
}

export function graphMediaPresetApplySelectionDefinition(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
): GraphNodeDefinition {
  if (definition.type !== "preset.render") return definition;
  const optionFields = graphMediaPresetModelOptionFields(
    definition,
    nodeFields,
  );
  const dynamicFields = graphMediaPresetDynamicFields(definition, nodeFields);
  const staticFields = definition.fields.filter(
    (field) =>
      !field.id.startsWith("text__") &&
      !field.id.startsWith("choice__") &&
      !field.id.startsWith(MODEL_OPTION_FIELD_PREFIX),
  );
  const combinedDynamicFields = [...optionFields, ...dynamicFields];
  if (!combinedDynamicFields.length)
    return { ...definition, fields: staticFields };
  const insertAfterIndex = staticFields.findIndex(
    (field) => field.id === "preset_model_key",
  );
  const fields =
    insertAfterIndex >= 0
      ? [
          ...staticFields.slice(0, insertAfterIndex + 1),
          ...combinedDynamicFields,
          ...staticFields.slice(insertAfterIndex + 1),
        ]
      : [...staticFields, ...combinedDynamicFields];
  return { ...definition, fields };
}

export function graphMediaPresetSelectionPayload(value: unknown) {
  const preset = normalizePresetCatalogItem(value);
  return preset;
}
