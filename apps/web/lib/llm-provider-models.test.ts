import { describe, expect, it } from "vitest";

import {
  filterProviderModels,
  providerCatalogStatusDetail,
  providerModelChoices,
  providerModelFallback,
  providerModelSelectionDetail,
  resolveSelectedProviderModel,
  sharedProviderKindOptions,
} from "@/lib/llm-provider-models";
import type { MediaEnhancementProviderModel } from "@/lib/types";

const MODELS: MediaEnhancementProviderModel[] = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    provider: "codex_local",
    supports_images: true,
    input_modalities: ["text", "image"],
  },
  {
    id: "gpt-5.3-mini",
    label: "GPT-5.3 Mini",
    provider: "codex_local",
    supports_images: false,
    input_modalities: ["text"],
  },
];

describe("llm-provider-models", () => {
  it("returns stable shared provider options", () => {
    expect(sharedProviderKindOptions()).toEqual([
      { value: "openrouter", label: "OpenRouter" },
      { value: "codex_local", label: "Codex Local" },
      { value: "local_openai", label: "Local OpenAI-compatible" },
    ]);
  });

  it("filters provider models by search query and optional image support", () => {
    expect(filterProviderModels("codex_local", MODELS, "mini").map((model) => model.id)).toEqual(["gpt-5.3-mini"]);
    expect(filterProviderModels("codex_local", MODELS, "", { requireImages: true }).map((model) => model.id)).toEqual(["gpt-5.4"]);
  });

  it("builds model choices and resolves selected models consistently", () => {
    expect(providerModelChoices("codex_local", MODELS)[0]).toEqual({
      value: "",
      label: "Choose a Codex model",
    });
    expect(resolveSelectedProviderModel("codex_local", MODELS, { selectedModelId: "gpt-5.3-mini" })?.label).toBe("GPT-5.3 Mini");
    expect(resolveSelectedProviderModel("openrouter", MODELS, {})?.id).toBe("gpt-5.4");
  });

  it("describes fallback and status details clearly", () => {
    const fallback = providerModelFallback({
      providerKind: "codex_local",
      modelId: "legacy/model",
      label: "Legacy Model",
      supportsImages: true,
    });
    expect(providerModelSelectionDetail(null, fallback)).toContain("Saved model is not in the current provider catalog");
    expect(
      providerCatalogStatusDetail("codex_local", {
        status: "ready",
        availableModels: MODELS,
        credentialSource: "codex_local_login",
        error: null,
        fetchedAt: Date.now(),
      }),
    ).toContain("Loaded 2 Codex Local models.");
  });
});
