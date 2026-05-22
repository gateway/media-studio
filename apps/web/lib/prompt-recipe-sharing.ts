import type {
  PromptRecipe,
  PromptRecipeCustomField,
  PromptRecipeImageInput,
  PromptRecipeVariable,
} from "@/lib/types";
import { slugifyPromptRecipeKey } from "@/lib/prompt-recipes";

export const PORTABLE_PROMPT_RECIPE_BUNDLE_KIND = "media_studio_prompt_recipe_bundle";
export const PORTABLE_PROMPT_RECIPE_BUNDLE_SCHEMA_VERSION = 1;

export type PortablePromptRecipeThumbnail = {
  file_name: string;
};

export type PortablePromptRecipePayload = {
  key: string;
  label: string;
  description: string | null;
  category: string;
  status: string;
  system_prompt_template: string;
  image_analysis_prompt: string;
  user_prompt_placeholder: string;
  output_format: string;
  output_contract_json: Record<string, unknown>;
  input_variables_json: PromptRecipeVariable[];
  custom_fields_json: PromptRecipeCustomField[];
  image_input_json: PromptRecipeImageInput;
  validation_warnings_json: string[];
  default_options_json: Record<string, unknown>;
  rules_json: Record<string, unknown>;
  notes: string | null;
  source_kind: string;
  version: string;
  priority: number;
  thumbnail: PortablePromptRecipeThumbnail | null;
};

export type PortablePromptRecipeBundleManifest = {
  schema_version: number;
  kind: string;
  exported_at: string;
  recipe: PortablePromptRecipePayload;
};

export type ResolvedPromptRecipeImport = {
  status: "skipped" | "created" | "copied";
  payload: Record<string, unknown> | null;
  message: string;
  duplicateRecipeId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableString(value: unknown) {
  const valueString = normalizeString(value);
  return valueString || null;
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function normalizeVariable(value: unknown): PromptRecipeVariable | null {
  const record = asRecord(value);
  const key = normalizeString(record?.key);
  const label = normalizeString(record?.label);
  if (!key || !label) return null;
  return {
    key,
    token: normalizeString(record?.token) || `{{${key}}}`,
    label,
    enabled: record?.enabled !== false,
    required: Boolean(record?.required),
    default_value: normalizeString(record?.default_value),
    description: normalizeString(record?.description),
  };
}

function normalizeCustomField(value: unknown): PromptRecipeCustomField | null {
  const record = asRecord(value);
  const key = normalizeString(record?.key);
  const label = normalizeString(record?.label);
  if (!key || !label) return null;
  return {
    key,
    label,
    type: normalizeString(record?.type) || "text",
    placeholder: normalizeString(record?.placeholder),
    default_value: record?.default_value ?? "",
    required: Boolean(record?.required),
    help_text: normalizeString(record?.help_text),
    options: Array.isArray(record?.options)
      ? record.options.map((item) => normalizeString(item)).filter(Boolean)
      : [],
  };
}

function normalizeImageInput(value: unknown): PromptRecipeImageInput {
  const record = asRecord(value);
  return {
    enabled: Boolean(record?.enabled),
    required: Boolean(record?.required),
    mode: normalizeString(record?.mode) || "none",
    analysis_variable: normalizeString(record?.analysis_variable) || "image_analysis",
    max_files: Math.max(0, normalizeNumber(record?.max_files, 0)),
  };
}

function normalizeWarnings(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => normalizeString(entry)).filter(Boolean) : [];
}

function normalizeVariablesList(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item: unknown) => normalizeVariable(item))
    .filter((item): item is PromptRecipeVariable => Boolean(item))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeCustomFieldsList(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item: unknown) => normalizeCustomField(item))
    .filter((item): item is PromptRecipeCustomField => Boolean(item))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function normalizePortablePromptRecipePayload(
  recipe: PromptRecipe | Record<string, unknown> | PortablePromptRecipePayload,
): PortablePromptRecipePayload {
  const record = recipe as Record<string, unknown>;
  const thumbnailRecord = asRecord(record.thumbnail);
  const thumbnailFileName = thumbnailRecord ? normalizeString(thumbnailRecord.file_name) : "";
  return {
    key: normalizeString(record.key),
    label: normalizeString(record.label),
    description: normalizeNullableString(record.description),
    category: normalizeString(record.category) || "utility",
    status: normalizeString(record.status) || "active",
    system_prompt_template: normalizeString(record.system_prompt_template),
    image_analysis_prompt: normalizeString(record.image_analysis_prompt),
    user_prompt_placeholder: normalizeString(record.user_prompt_placeholder) || "{{user_prompt}}",
    output_format: normalizeString(record.output_format) || "single_prompt",
    output_contract_json: (normalizeUnknown(asRecord(record.output_contract_json ?? record.output_contract) ?? {}) as Record<string, unknown>) ?? {},
    input_variables_json: normalizeVariablesList(record.input_variables_json ?? record.input_variables),
    custom_fields_json: normalizeCustomFieldsList(record.custom_fields_json ?? record.custom_fields),
    image_input_json: normalizeImageInput(record.image_input_json ?? record.image_input),
    validation_warnings_json: normalizeWarnings(record.validation_warnings_json ?? record.validation_warnings),
    default_options_json: (normalizeUnknown(asRecord(record.default_options_json ?? record.default_options) ?? {}) as Record<string, unknown>) ?? {},
    rules_json: (normalizeUnknown(asRecord(record.rules_json ?? record.rules) ?? {}) as Record<string, unknown>) ?? {},
    notes: normalizeNullableString(record.notes),
    source_kind: normalizeString(record.source_kind) || "custom",
    version: normalizeString(record.version) || "1",
    priority: normalizeNumber(record.priority, 0),
    thumbnail: thumbnailFileName ? { file_name: thumbnailFileName } : null,
  };
}

export function createPortablePromptRecipeBundleManifest(
  recipe: PromptRecipe | Record<string, unknown> | PortablePromptRecipePayload,
): PortablePromptRecipeBundleManifest {
  return {
    schema_version: PORTABLE_PROMPT_RECIPE_BUNDLE_SCHEMA_VERSION,
    kind: PORTABLE_PROMPT_RECIPE_BUNDLE_KIND,
    exported_at: new Date().toISOString(),
    recipe: normalizePortablePromptRecipePayload(recipe),
  };
}

export function parsePortablePromptRecipeBundleManifest(value: unknown): PortablePromptRecipeBundleManifest {
  const record = asRecord(value);
  if (!record) {
    throw new Error("The prompt recipe bundle manifest is missing.");
  }
  if (normalizeString(record.kind) !== PORTABLE_PROMPT_RECIPE_BUNDLE_KIND) {
    throw new Error("This file is not a Media Studio prompt recipe bundle.");
  }
  const schemaVersion = normalizeNumber(record.schema_version, NaN);
  if (schemaVersion !== PORTABLE_PROMPT_RECIPE_BUNDLE_SCHEMA_VERSION) {
    throw new Error("This prompt recipe bundle format is not supported.");
  }
  const recipeRecord = asRecord(record.recipe);
  if (!recipeRecord) {
    throw new Error("The prompt recipe bundle is missing the recipe payload.");
  }
  return {
    schema_version: schemaVersion,
    kind: PORTABLE_PROMPT_RECIPE_BUNDLE_KIND,
    exported_at: normalizeString(record.exported_at) || new Date(0).toISOString(),
    recipe: normalizePortablePromptRecipePayload(recipeRecord),
  };
}

function comparablePromptRecipePayload(recipe: PortablePromptRecipePayload) {
  const { key: _key, source_kind: _sourceKind, thumbnail: _thumbnail, validation_warnings_json: _warnings, ...rest } = recipe;
  return rest;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeUnknown(value));
}

export function portablePromptRecipeFingerprint(recipe: PortablePromptRecipePayload) {
  return stableSerialize(comparablePromptRecipePayload(normalizePortablePromptRecipePayload(recipe)));
}

function isSharedRecipe(recipe: PromptRecipe | Record<string, unknown>) {
  const record = recipe as Record<string, unknown>;
  const sourceKind = normalizeString(record.source_kind);
  return sourceKind === "builtin" || sourceKind === "built_in_override";
}

function resolveCopyIdentity(recipe: PortablePromptRecipePayload, recipes: Array<PromptRecipe | Record<string, unknown>>) {
  const existingKeys = new Set(recipes.map((entry) => normalizeString((entry as Record<string, unknown>).key)));
  const existingLabels = new Set(recipes.map((entry) => normalizeString((entry as Record<string, unknown>).label)));
  let index = 1;
  while (index < 5000) {
    const suffix = index === 1 ? "copy" : `copy_${index}`;
    const key = slugifyPromptRecipeKey(`${recipe.key}_${suffix}`);
    const label = index === 1 ? `${recipe.label} Copy` : `${recipe.label} Copy ${index}`;
    if (!existingKeys.has(key) && !existingLabels.has(label)) {
      return { key, label };
    }
    index += 1;
  }
  throw new Error("Unable to generate a unique prompt recipe copy name.");
}

export function buildImportedPromptRecipePayload(
  recipe: PortablePromptRecipePayload,
  {
    key = recipe.key,
    label = recipe.label,
    thumbnailPath = null,
    thumbnailUrl = null,
  }: {
    key?: string;
    label?: string;
    thumbnailPath?: string | null;
    thumbnailUrl?: string | null;
  } = {},
) {
  const normalized = normalizePortablePromptRecipePayload(recipe);
  return {
    key,
    label,
    description: normalized.description,
    category: normalized.category,
    status: "active",
    system_prompt_template: normalized.system_prompt_template,
    image_analysis_prompt: normalized.image_analysis_prompt,
    user_prompt_placeholder: normalized.user_prompt_placeholder,
    output_format: normalized.output_format,
    output_contract_json: normalized.output_contract_json,
    input_variables: normalized.input_variables_json,
    custom_fields: normalized.custom_fields_json,
    image_input: normalized.image_input_json,
    default_options_json: normalized.default_options_json,
    rules: normalized.rules_json,
    thumbnail_path: thumbnailPath,
    thumbnail_url: thumbnailUrl,
    notes: normalized.notes,
    source_kind: "imported",
    version: normalized.version,
    priority: normalized.priority,
  };
}

export function resolvePromptRecipeImport(
  existingRecipes: PromptRecipe[],
  incomingRecipe: PortablePromptRecipePayload,
): ResolvedPromptRecipeImport {
  const normalizedIncoming = normalizePortablePromptRecipePayload(incomingRecipe);
  const incomingFingerprint = portablePromptRecipeFingerprint(normalizedIncoming);
  const sameKeyRecipe = existingRecipes.find((recipe) => normalizeString(recipe.key) === normalizedIncoming.key) ?? null;
  const sameContentRecipe =
    existingRecipes.find((recipe) => portablePromptRecipeFingerprint(normalizePortablePromptRecipePayload(recipe)) === incomingFingerprint) ?? null;

  if (sameContentRecipe && !isSharedRecipe(sameContentRecipe)) {
    return {
      status: "skipped",
      payload: null,
      message: "Prompt recipe already installed.",
      duplicateRecipeId: sameContentRecipe.recipe_id,
    };
  }

  if (sameKeyRecipe || sameContentRecipe) {
    const copyIdentity = resolveCopyIdentity(normalizedIncoming, existingRecipes);
    return {
      status: "copied",
      payload: buildImportedPromptRecipePayload(normalizedIncoming, copyIdentity),
      message: `Prompt recipe imported as ${copyIdentity.label}.`,
      duplicateRecipeId: sameKeyRecipe?.recipe_id ?? sameContentRecipe?.recipe_id ?? null,
    };
  }

  return {
    status: "created",
    payload: buildImportedPromptRecipePayload(normalizedIncoming),
    message: "Prompt recipe imported.",
    duplicateRecipeId: null,
  };
}
