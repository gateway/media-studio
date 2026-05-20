import type { MediaEnhancementProviderModel } from "@/lib/types";
import { llmProviderLabel, type SharedLlmProviderKind } from "@/lib/llm-provider-metadata";

export type SharedProviderCatalogState = {
  status: "idle" | "loading" | "ready" | "error";
  availableModels: MediaEnhancementProviderModel[];
  credentialSource: string | null;
  error: string | null;
  fetchedAt: number | null;
};

export const SHARED_LLM_PROVIDER_KIND_OPTIONS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "codex_local", label: "Codex Local" },
  { value: "local_openai", label: "Local OpenAI-compatible" },
] as const satisfies ReadonlyArray<{ value: SharedLlmProviderKind; label: string }>;

export function isSharedLlmProviderKind(value: string): value is SharedLlmProviderKind {
  return value === "openrouter" || value === "codex_local" || value === "local_openai";
}

export function sharedProviderKindOptions() {
  return [...SHARED_LLM_PROVIDER_KIND_OPTIONS];
}

export function providerCatalogLabel(providerKind: SharedLlmProviderKind) {
  return llmProviderLabel(providerKind);
}

export function providerCatalogPlaceholder(providerKind: SharedLlmProviderKind) {
  if (providerKind === "openrouter") {
    return "Choose an OpenRouter model";
  }
  if (providerKind === "codex_local") {
    return "Choose a Codex model";
  }
  return "Choose a local model";
}

export function providerCatalogSearchPlaceholder(providerKind: SharedLlmProviderKind) {
  if (providerKind === "openrouter") {
    return "Search available OpenRouter models";
  }
  if (providerKind === "codex_local") {
    return "Search detected Codex models";
  }
  return "Search detected local models";
}

export function providerCatalogLoadHint(providerKind: SharedLlmProviderKind) {
  if (providerKind === "openrouter") {
    return "Refresh to see available models.";
  }
  if (providerKind === "codex_local") {
    return "Refresh to see available models from local Codex.";
  }
  return "Use Test endpoint to see models from your local server.";
}

export function providerModelCapabilities(model: MediaEnhancementProviderModel) {
  return {
    provider: model.provider,
    model_id: model.id,
    model_label: model.label,
    supports_images: Boolean(model.supports_images),
    input_modalities: Array.isArray(model.input_modalities)
      ? model.input_modalities.filter((item) => typeof item === "string")
      : [],
  };
}

export function providerModelSupportsImages(model: MediaEnhancementProviderModel | null | undefined) {
  return Boolean(model?.supports_images);
}

export function providerModelLabel(model: MediaEnhancementProviderModel) {
  return `${model.label}${model.supports_images ? " · multimodal" : ""}`;
}

export function providerModelChoices(
  providerKind: SharedLlmProviderKind,
  models: MediaEnhancementProviderModel[],
) {
  return [
    {
      value: "",
      label: providerCatalogPlaceholder(providerKind),
    },
    ...models.map((model) => ({
      value: model.id,
      label: providerModelLabel(model),
    })),
  ];
}

export function filterProviderModels(
  providerKind: SharedLlmProviderKind,
  models: MediaEnhancementProviderModel[],
  query: string,
  options?: {
    requireImages?: boolean;
  },
) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredByCapability = options?.requireImages
    ? models.filter((model) => providerModelSupportsImages(model))
    : models;
  if (!normalizedQuery) {
    return filteredByCapability;
  }
  return filteredByCapability.filter((model) =>
    `${model.label} ${model.id}`.toLowerCase().includes(normalizedQuery),
  );
}

export function resolveSelectedProviderModel(
  providerKind: SharedLlmProviderKind,
  models: MediaEnhancementProviderModel[],
  options?: {
    selectedModelId?: string | null;
    preferredModelId?: string | null;
    selectedModel?: MediaEnhancementProviderModel | null;
  },
) {
  if (options?.selectedModel) {
    return options.selectedModel;
  }
  if (options?.selectedModelId) {
    const matchingSelected = models.find((item) => item.id === options.selectedModelId);
    if (matchingSelected) {
      return matchingSelected;
    }
  }
  if (options?.preferredModelId) {
    const preferredModel = models.find((item) => item.id === options.preferredModelId);
    if (preferredModel) {
      return preferredModel;
    }
  }
  if (providerKind === "openrouter") {
    return models.find((item) => providerModelSupportsImages(item)) ?? models[0] ?? null;
  }
  return models[0] ?? null;
}

export function providerModelFallback(options: {
  providerKind: SharedLlmProviderKind;
  modelId: string;
  label: string;
  supportsImages: boolean;
}) {
  return {
    id: options.modelId,
    label: options.label,
    provider: options.providerKind,
    supports_images: options.supportsImages,
    input_modalities: options.supportsImages ? ["text", "image"] : ["text"],
  } satisfies MediaEnhancementProviderModel;
}

export function providerCatalogStatusDetail(
  providerKind: SharedLlmProviderKind,
  entry: SharedProviderCatalogState | null | undefined,
) {
  if (entry?.status === "error") {
    return entry.error ?? "Unable to load provider models.";
  }
  if (entry?.status === "loading") {
    return `Loading ${providerCatalogLabel(providerKind)} models...`;
  }
  if (entry?.status === "ready") {
    const count = entry.availableModels.length;
    return `Loaded ${count} ${providerCatalogLabel(providerKind)} model${count === 1 ? "" : "s"}.`;
  }
  return `Refresh to load ${providerCatalogLabel(providerKind)} models.`;
}

export function providerModelSelectionDetail(
  selectedModel: MediaEnhancementProviderModel | null,
  fallbackModel: MediaEnhancementProviderModel | null,
) {
  if (selectedModel) {
    return selectedModel.supports_images
      ? "Selected model accepts text and image input."
      : "Selected model accepts text input.";
  }
  if (fallbackModel) {
    return "Saved model is not in the current provider catalog. Refresh to confirm it still exists.";
  }
  return null;
}
