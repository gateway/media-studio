import type { GraphNodeDefinition, GraphNodeField } from "../types";

type PromptRecipeSpecField = {
  key?: string;
  label?: string;
  required?: boolean;
  default_value?: unknown;
  description?: string;
  placeholder?: string;
  display_placeholder?: string;
  help_text?: string;
  display_help_text?: string;
  options?: unknown[];
};

type PromptRecipeSelectionSummary = {
  title: string;
  subtitle: string;
  description: string;
  details: string[];
};

export type PromptRecipeCatalogItem = {
  recipe_id: string;
  key: string;
  label: string;
  label_with_category?: string;
  description?: string;
  category: string;
  category_label?: string;
  status?: string;
  output_format: string;
  output_format_label?: string;
  selection_summary?: PromptRecipeSelectionSummary;
  image_input?: {
    enabled?: boolean;
    required?: boolean;
    mode?: string;
    max_files?: number;
  } | null;
  default_options?: {
    temperature?: number;
    max_output_tokens?: number;
  } | null;
  input_variables?: PromptRecipeSpecField[];
  custom_fields?: PromptRecipeSpecField[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function graphPromptRecipeCatalog(definition: GraphNodeDefinition): PromptRecipeCatalogItem[] {
  const source = asRecord(definition.source);
  const raw = Array.isArray(source.recipe_catalog) ? source.recipe_catalog : [];
  return raw
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as PromptRecipeCatalogItem) : null))
    .filter(Boolean) as PromptRecipeCatalogItem[];
}

export function graphPromptRecipeById(definition: GraphNodeDefinition, recipeId: string | null | undefined) {
  if (!recipeId) return null;
  return graphPromptRecipeCatalog(definition).find((item) => item.recipe_id === recipeId) ?? null;
}

export function graphPromptRecipeOptionLabel(option: unknown, activeCategory: string) {
  if (!option || typeof option !== "object") return String(option ?? "");
  const record = option as Record<string, unknown>;
  const label = String(record.label ?? record.value ?? "");
  if (activeCategory && activeCategory !== "all") return label;
  return String(record.label_with_category ?? label);
}

export function graphPromptRecipeFilteredOptions(
  field: GraphNodeField,
  nodeFields: Record<string, unknown>,
) {
  const activeCategory = String(nodeFields.recipe_category ?? field.default ?? "all");
  return (field.options ?? []).filter((option) => {
    if (activeCategory === "all") return true;
    if (!option || typeof option !== "object") return true;
    return String((option as Record<string, unknown>).category ?? "") === activeCategory;
  });
}

function promptRecipeSpecFieldForRecipe(recipe: PromptRecipeCatalogItem | null, fieldId: string): PromptRecipeSpecField | null {
  if (!recipe) return null;
  return [...(recipe.input_variables ?? []), ...(recipe.custom_fields ?? [])].find((item) => item.key === fieldId) ?? null;
}

export function graphPromptRecipeFieldOverride(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
  field: GraphNodeField,
) {
  const recipe = graphPromptRecipeById(definition, String(nodeFields.recipe_id ?? ""));
  const spec = promptRecipeSpecFieldForRecipe(recipe, field.id);
  if (!spec) return null;
  const description = String(spec.help_text ?? spec.description ?? "").trim();
  const placeholder = String(spec.display_placeholder ?? spec.placeholder ?? spec.description ?? field.placeholder ?? "").trim();
  const helpText = String(spec.display_help_text ?? "").trim() || (description ? `${spec.required ? "Required." : "Optional."} ${description}`.trim() : spec.required ? "Required." : "Optional.");
  return {
    recipe,
    label: String(spec.label ?? field.label ?? ""),
    placeholder: placeholder || null,
    helpText,
    options: Array.isArray(spec.options) && spec.options.length ? spec.options : field.options,
  };
}

export function graphPromptRecipeSelectionSummary(definition: GraphNodeDefinition, nodeFields: Record<string, unknown>) {
  const recipe = graphPromptRecipeById(definition, String(nodeFields.recipe_id ?? ""));
  if (!recipe) return null;
  return recipe.selection_summary ?? null;
}

export function graphPromptRecipeImageWarning(
  definition: GraphNodeDefinition,
  nodeFields: Record<string, unknown>,
  connectedInputPorts: string[] = [],
) {
  const recipe = graphPromptRecipeById(definition, String(nodeFields.recipe_id ?? ""));
  const imageInput = recipe?.image_input;
  if (!imageInput?.enabled) return null;
  const mode = String(imageInput.mode ?? "none").trim();
  if (!mode || mode === "none") return null;
  if (connectedInputPorts.includes("image_refs")) return null;
  return "This recipe can look at images, but no images are connected to Image References.";
}

export function graphPromptRecipeSelectionDefaults(definition: GraphNodeDefinition, recipeId: string) {
  const recipe = graphPromptRecipeById(definition, recipeId);
  if (!recipe) return null;
  const defaults: Record<string, unknown> = {
    recipe_category: recipe.category,
  };
  for (const item of recipe.input_variables ?? []) {
    if (item.key && item.default_value !== undefined && item.default_value !== null && item.default_value !== "") {
      defaults[item.key] = item.default_value;
    }
  }
  for (const item of recipe.custom_fields ?? []) {
    if (item.key && item.default_value !== undefined && item.default_value !== null && item.default_value !== "") {
      defaults[item.key] = item.default_value;
    }
  }
  return defaults;
}
