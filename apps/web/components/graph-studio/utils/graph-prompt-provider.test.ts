import { describe, expect, it } from "vitest";

import {
  graphNormalizePromptProviderFields,
  graphPromptAdvancedSummary,
  graphPromptNodeHeaderSummary,
  graphPromptRuntimeFieldOverride,
  graphPromptSavedModelLabel,
} from "./graph-prompt-provider";

describe("graph prompt provider helpers", () => {
  it("clears mismatched provider model metadata on hydrate", () => {
    expect(
      graphNormalizePromptProviderFields("prompt.recipe", {
        provider: "codex_local",
        model_id: "qwen/qwen3.6",
        provider_model_label: "Qwen 3.6",
        provider_supports_images: true,
        provider_capabilities_json: { provider: "openrouter", model_id: "qwen/qwen3.6", model_label: "Qwen 3.6" },
      }),
    ).toMatchObject({
      provider: "codex_local",
      model_id: "",
      provider_model_label: "",
      provider_supports_images: null,
      provider_capabilities_json: {},
    });
  });

  it("keeps legacy labels only when the provider metadata still matches", () => {
    expect(
      graphPromptSavedModelLabel(
        {
          provider_model_label: "GPT-5.4",
          provider_capabilities_json: { provider: "codex_local", model_id: "gpt-5.4", model_label: "GPT-5.4" },
        },
        "codex_local",
        "gpt-5.4",
      ),
    ).toBe("GPT-5.4");

    expect(
      graphPromptSavedModelLabel(
        {
          provider_model_label: "Qwen 3.6",
          provider_capabilities_json: { provider: "openrouter", model_id: "qwen/qwen3.6", model_label: "Qwen 3.6" },
        },
        "codex_local",
        "qwen/qwen3.6",
      ),
    ).toBe("Saved model (qwen/qwen3.6)");
  });

  it("builds prompt header summaries and advanced runtime guidance", () => {
    expect(
      graphPromptNodeHeaderSummary("prompt.llm", {
        provider: "codex_local",
        model_id: "gpt-5.4",
        provider_capabilities_json: { provider: "codex_local", model_id: "gpt-5.4", model_label: "GPT-5.4", supports_images: true },
      }),
    ).toBe("Codex Local • GPT-5.4 • Vision");

    expect(graphPromptAdvancedSummary("prompt.recipe", { provider: "codex_local" })).toContain("Codex-managed runtime defaults");
    expect(graphPromptAdvancedSummary("prompt.recipe", { provider: "openrouter" })).toContain("recipe defaults");
    expect(graphPromptAdvancedSummary("prompt.image_analyzer", { provider: "openrouter" })).toContain("vision-capable model");
  });

  it("describes runtime override behavior per provider", () => {
    expect(
      graphPromptRuntimeFieldOverride("prompt.llm", { provider: "openrouter" }, { id: "temperature", label: "Temperature", type: "float" }),
    ).toMatchObject({
      placeholder: "Provider default",
    });
    expect(
      graphPromptRuntimeFieldOverride("prompt.recipe", { provider: "codex_local" }, { id: "max_tokens", label: "Max Tokens", type: "integer" })?.helpText.toLowerCase(),
    ).toContain("ignores this field");
  });
});
