import type {
  PromptRecipe,
  PromptRecipeCategory,
  PromptRecipeCustomField,
  PromptRecipeDraftPayload,
  PromptRecipeImageInput,
  PromptRecipeOutputFormat,
  PromptRecipeVariable,
} from "@/lib/types";

export const PROMPT_RECIPE_CATEGORIES: Array<{ value: PromptRecipeCategory; label: string }> = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "analysis", label: "Analysis" },
  { value: "utility", label: "Utility" },
];

export const PROMPT_RECIPE_OUTPUT_FORMATS: Array<{ value: PromptRecipeOutputFormat; label: string }> = [
  { value: "single_prompt", label: "Single Prompt" },
  { value: "prompt_list", label: "Prompt List" },
  { value: "json_prompt_batch", label: "JSON Prompt Batch" },
  { value: "image_analysis", label: "Image Analysis" },
  { value: "structured_shot_sequence", label: "Structured Shot Sequence" },
];

export const PROMPT_RECIPE_RESERVED_VARIABLES: PromptRecipeVariable[] = [
  { key: "user_prompt", token: "{{user_prompt}}", label: "User Prompt", enabled: true, required: false, default_value: "", description: "User creative direction." },
  { key: "image_analysis", token: "{{image_analysis}}", label: "Image Analysis", enabled: false, required: false, default_value: "", description: "Analyzed reference-image description." },
  { key: "source_prompt", token: "{{source_prompt}}", label: "Source Prompt", enabled: false, required: false, default_value: "", description: "Prompt text from an upstream node." },
  { key: "source_image_prompt", token: "{{source_image_prompt}}", label: "Source Image Prompt", enabled: false, required: false, default_value: "", description: "Prompt used to create an upstream image." },
  { key: "previous_output", token: "{{previous_output}}", label: "Previous Output", enabled: false, required: false, default_value: "", description: "Prior LLM output." },
  { key: "shot_count", token: "{{shot_count}}", label: "Shot Count", enabled: false, required: false, default_value: "4", description: "Number of prompts or shots to create." },
  { key: "duration_seconds", token: "{{duration_seconds}}", label: "Duration Seconds", enabled: false, required: false, default_value: "5", description: "Target duration for a video shot." },
  { key: "aspect_ratio", token: "{{aspect_ratio}}", label: "Aspect Ratio", enabled: false, required: false, default_value: "16:9", description: "Target media aspect ratio." },
  { key: "output_format", token: "{{output_format}}", label: "Output Format", enabled: false, required: false, default_value: "", description: "Preferred returned format." },
  { key: "style_direction", token: "{{style_direction}}", label: "Style Direction", enabled: false, required: false, default_value: "", description: "Visual or genre direction." },
];

export const PROMPT_RECIPE_KEY_RE = /^[a-z][a-z0-9_]*$/;
const TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
const ANY_TOKEN_RE = /\{\{([^}]+)\}\}/g;
const IMAGE_REFERENCE_RE = /\[\[\s*image[_\s-]*reference\s*(\d+)\s*\]\]|\[\s*image\s+reference\s+(\d+)\s*\]|@image\s*(\d+)/gi;

export function detectPromptRecipeVariables(template: string) {
  return Array.from(new Set(Array.from(template.matchAll(TOKEN_RE)).map((match) => match[1]))).sort();
}

export function detectInvalidPromptRecipeTokens(template: string) {
  return Array.from(template.matchAll(ANY_TOKEN_RE))
    .map((match) => match[1].trim())
    .filter((token) => !PROMPT_RECIPE_KEY_RE.test(token));
}

export function highestPromptRecipeImageReferenceIndex(...values: string[]) {
  let highest = 0;
  for (const value of values) {
    for (const match of String(value || "").matchAll(IMAGE_REFERENCE_RE)) {
      const index = Number(match[1] ?? match[2] ?? match[3] ?? 0);
      if (Number.isFinite(index) && index > highest) {
        highest = index;
      }
    }
  }
  return highest;
}

export function slugifyPromptRecipeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function defaultPromptRecipeVariables(template = "{{user_prompt}}"): PromptRecipeVariable[] {
  const tokens = new Set(detectPromptRecipeVariables(template));
  tokens.add("user_prompt");
  return PROMPT_RECIPE_RESERVED_VARIABLES.map((variable) => ({
    ...variable,
    token: `{{${variable.key}}}`,
    enabled: tokens.has(variable.key),
    required: variable.key === "user_prompt" && tokens.has("user_prompt"),
  }));
}

export function defaultPromptRecipeImageInput(): PromptRecipeImageInput {
  return {
    enabled: false,
    required: false,
    mode: "none",
    analysis_variable: "image_analysis",
    max_files: 0,
  };
}

export function normalizePromptRecipeVariables(variables: PromptRecipeVariable[], template: string) {
  const byKey = new Map(variables.map((variable) => [variable.key, variable]));
  const tokens = new Set(detectPromptRecipeVariables(template));
  return PROMPT_RECIPE_RESERVED_VARIABLES.map((reserved) => {
    const existing = byKey.get(reserved.key);
    return {
      ...reserved,
      ...existing,
      token: `{{${reserved.key}}}`,
      enabled: Boolean(existing?.enabled ?? tokens.has(reserved.key)),
    };
  });
}

export function normalizePromptRecipeCustomField(field: Partial<PromptRecipeCustomField>): PromptRecipeCustomField {
  return {
    key: field.key ?? "",
    label: field.label ?? "",
    type: field.type ?? "text",
    placeholder: field.placeholder ?? "",
    default_value: field.default_value ?? "",
    required: Boolean(field.required),
    help_text: field.help_text ?? "",
    options: field.options ?? [],
  };
}

export function validatePromptRecipeDraft({
  key,
  label,
  category,
  outputFormat,
  template,
  variables,
  customFields,
  imageInput,
  imageAnalysisPrompt,
  rules,
}: {
  key: string;
  label: string;
  category: string;
  outputFormat: string;
  template: string;
  variables: PromptRecipeVariable[];
  customFields: PromptRecipeCustomField[];
  imageInput: PromptRecipeImageInput;
  imageAnalysisPrompt: string;
  rules: Record<string, unknown>;
}) {
  if (!label.trim()) {
    return "Recipe name is required.";
  }
  if (!PROMPT_RECIPE_KEY_RE.test(key)) {
    return "Recipe key must start with a lowercase letter and use lowercase letters, numbers, and underscores.";
  }
  if (!PROMPT_RECIPE_CATEGORIES.some((entry) => entry.value === category)) {
    return "Choose a valid category.";
  }
  if (!PROMPT_RECIPE_OUTPUT_FORMATS.some((entry) => entry.value === outputFormat)) {
    return "Choose a valid output format.";
  }
  if (!template.trim()) {
    return "System prompt template is required.";
  }
  const invalidTokens = detectInvalidPromptRecipeTokens(template);
  if (invalidTokens.length) {
    return `Invalid variable token: ${invalidTokens[0]}.`;
  }
  const variableKeys = new Set(variables.map((variable) => variable.key));
  const reservedKeys = new Set(PROMPT_RECIPE_RESERVED_VARIABLES.map((variable) => variable.key));
  const customKeys = new Set<string>();
  for (const field of customFields) {
    if (!PROMPT_RECIPE_KEY_RE.test(field.key)) {
      return "Custom field keys must start with a lowercase letter and use lowercase letters, numbers, and underscores.";
    }
    if (reservedKeys.has(field.key) || variableKeys.has(field.key)) {
      return `Custom field key conflicts with a reserved variable: ${field.key}.`;
    }
    if (customKeys.has(field.key)) {
      return `Custom field key is duplicated: ${field.key}.`;
    }
    if (field.type === "select" && !field.options?.length) {
      return `Select field ${field.key} needs at least one option.`;
    }
    if (field.type === "select") {
      const normalizedOptions = (field.options ?? []).map((value) => String(value).trim()).filter(Boolean);
      if (new Set(normalizedOptions).size !== normalizedOptions.length) {
        return `Select field ${field.key} has duplicate options.`;
      }
    }
    customKeys.add(field.key);
  }
  const templateTokens = detectPromptRecipeVariables(template);
  const allowExternalVariables = rules.allow_external_variables !== false;
  const unknownTokens = templateTokens.filter((token) => !variableKeys.has(token) && !customKeys.has(token));
  if (unknownTokens.length && !allowExternalVariables) {
    return `Unknown variables are not allowed: ${unknownTokens.join(", ")}.`;
  }
  if (!["none", "direct_reference", "analyze_then_inject", "both"].includes(imageInput.mode)) {
    return "Choose a valid image input mode.";
  }
  const maxFiles = Math.max(0, Number(imageInput.max_files) || 0);
  const analysisVariable = imageInput.analysis_variable?.trim() || "image_analysis";
  if (!PROMPT_RECIPE_KEY_RE.test(analysisVariable)) {
    return "Image analysis variable must start with a lowercase letter and use lowercase letters, numbers, and underscores.";
  }
  if (!imageInput.enabled) {
    if (imageInput.required) {
      return "Image input cannot be required while image input is turned off.";
    }
    if (imageInput.mode !== "none") {
      return "Image input mode must be None when image input is turned off.";
    }
  }
  if (imageInput.enabled) {
    if (imageInput.mode === "none") {
      return "Choose an image input mode when image input is turned on.";
    }
    if (maxFiles < 1) {
      return "Max Files must be at least 1 when image input is turned on.";
    }
  }
  const usesAnalysisVariable = templateTokens.includes(analysisVariable);
  const usesDefaultAnalysisVariable = templateTokens.includes("image_analysis");
  if (usesDefaultAnalysisVariable && analysisVariable !== "image_analysis") {
    return `The template uses {{image_analysis}}, but the configured image analysis variable is {{${analysisVariable}}}.`;
  }
  if (usesAnalysisVariable) {
    if (!imageInput.enabled) {
      return `The template uses {{${analysisVariable}}}, but image input is turned off.`;
    }
    if (!["analyze_then_inject", "both"].includes(imageInput.mode)) {
      return `The template uses {{${analysisVariable}}}, so image input mode must analyze images.`;
    }
  }
  if (imageInput.enabled && ["analyze_then_inject", "both"].includes(imageInput.mode) && !imageAnalysisPrompt.trim()) {
    return "Image analysis mode needs an Image Analysis Prompt.";
  }
  const highestImageReference = highestPromptRecipeImageReferenceIndex(template, imageAnalysisPrompt);
  if (highestImageReference > 0) {
    if (!imageInput.enabled) {
      return `Recipe text mentions image reference ${highestImageReference}, but image input is turned off.`;
    }
    if (maxFiles < highestImageReference) {
      return `Recipe text mentions image reference ${highestImageReference}, but Max Files is ${maxFiles}.`;
    }
  }
  return null;
}

export function promptRecipeDraftWarnings({
  template,
  variables,
  customFields,
  imageInput,
  imageAnalysisPrompt,
  rules,
}: {
  template: string;
  variables: PromptRecipeVariable[];
  customFields: PromptRecipeCustomField[];
  imageInput: PromptRecipeImageInput;
  imageAnalysisPrompt: string;
  rules: Record<string, unknown>;
}) {
  const warnings: string[] = [];
  const templateTokens = new Set(detectPromptRecipeVariables(template));
  const enabledVariableKeys = new Set(variables.filter((variable) => variable.enabled).map((variable) => variable.key));
  const variableKeys = new Set(variables.map((variable) => variable.key));
  const customKeys = new Set(customFields.map((field) => field.key).filter(Boolean));
  const unusedEnabled = Array.from(enabledVariableKeys).filter((key) => !templateTokens.has(key)).sort();
  if (unusedEnabled.length) {
    warnings.push(`Enabled variables are not used in the template: ${unusedEnabled.join(", ")}.`);
  }
  const disabledUsed = variables
    .filter((variable) => !variable.enabled && templateTokens.has(variable.key))
    .map((variable) => variable.key)
    .sort();
  if (disabledUsed.length) {
    warnings.push(`Template uses variables that are disabled in the recipe: ${disabledUsed.join(", ")}.`);
  }
  const allowExternalVariables = rules.allow_external_variables !== false;
  const unknownTokens = Array.from(templateTokens).filter((token) => !variableKeys.has(token) && !customKeys.has(token)).sort();
  if (unknownTokens.length && allowExternalVariables) {
    warnings.push(`Template uses external variables that future graph nodes must provide: ${unknownTokens.join(", ")}.`);
  }
  if (templateTokens.has("image_analysis") && !imageInput.enabled) {
    warnings.push("Template uses image_analysis, but image input is disabled.");
  }
  if (imageInput.enabled && ["analyze_then_inject", "both"].includes(imageInput.mode) && !imageAnalysisPrompt.trim()) {
    warnings.push("Image input is enabled for analysis, but no image analysis prompt is configured.");
  }
  const unusedCustom = Array.from(customKeys).filter((key) => !templateTokens.has(key)).sort();
  if (unusedCustom.length) {
    warnings.push(`Custom fields are configured but not used in the template: ${unusedCustom.join(", ")}.`);
  }
  return warnings;
}

export function promptRecipeToDraft(recipe: Partial<PromptRecipe> | PromptRecipeDraftPayload | null | undefined) {
  const template = recipe?.system_prompt_template ?? "USER PROMPT:\n{{user_prompt}}\n\nReturn only the final prompt.";
  const recipeId = recipe && "recipe_id" in recipe ? recipe.recipe_id ?? null : null;
  return {
    recipeId,
    key: recipe?.key ?? "",
    label: recipe?.label ?? "",
    description: recipe?.description ?? "",
    category: recipe?.category ?? "image",
    status: recipe?.status ?? "active",
    template,
    imageAnalysisPrompt: recipe?.image_analysis_prompt ?? "",
    userPromptPlaceholder: recipe?.user_prompt_placeholder ?? "{{user_prompt}}",
    outputFormat: recipe?.output_format ?? "single_prompt",
    outputContractText: JSON.stringify(recipe?.output_contract_json ?? recipe?.output_contract ?? {}, null, 2),
    variables: normalizePromptRecipeVariables(recipe?.input_variables_json ?? recipe?.input_variables ?? [], template),
    customFields: (recipe?.custom_fields_json ?? recipe?.custom_fields ?? []).map(normalizePromptRecipeCustomField),
    imageInput: recipe?.image_input_json ?? recipe?.image_input ?? defaultPromptRecipeImageInput(),
    defaultOptionsText: JSON.stringify(recipe?.default_options_json ?? recipe?.default_options ?? {}, null, 2),
    rulesText: JSON.stringify(recipe?.rules_json ?? recipe?.rules ?? { allow_external_variables: true, return_only_final_output: true }, null, 2),
    thumbnailPath: recipe?.thumbnail_path ?? "",
    thumbnailUrl: recipe?.thumbnail_url ?? "",
    notes: recipe?.notes ?? "",
    sourceKind: recipe?.source_kind ?? "custom",
    priority: recipe?.priority ?? 0,
  };
}

export type PromptRecipeEditorDraft = ReturnType<typeof promptRecipeToDraft>;
