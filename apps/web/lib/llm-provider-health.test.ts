import { describe, expect, it } from "vitest";

import { hasConfiguredLocalOpenAiProvider, normalizeMediaStudioHealth, summarizeLlmProviderReadiness } from "@/lib/llm-provider-health";
import type { MediaEnhancementConfig, PromptRecipeDraftingConfig } from "@/lib/types";

function makeEnhancementConfig(
  overrides: Partial<MediaEnhancementConfig> = {},
): MediaEnhancementConfig {
  return {
    config_id: "cfg_1",
    model_key: "__studio_enhancement__",
    status: "active",
    label: "Studio enhancement",
    helper_profile: "midctx",
    provider_kind: "builtin",
    provider_label: null,
    provider_model_id: null,
    provider_api_key_configured: false,
    provider_base_url_configured: false,
    provider_credential_source: null,
    provider_supports_images: false,
    provider_status: null,
    provider_last_tested_at: null,
    provider_capabilities_json: {},
    system_prompt: "",
    image_analysis_prompt: null,
    supports_text_enhancement: true,
    supports_image_analysis: false,
    notes: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function makeDraftingConfig(
  overrides: Partial<PromptRecipeDraftingConfig> = {},
): PromptRecipeDraftingConfig {
  return {
    config_key: "prompt_recipe_drafting",
    enabled: true,
    provider_kind: "openrouter",
    provider_label: null,
    provider_model_id: null,
    provider_base_url_configured: false,
    provider_credential_source: null,
    provider_supports_images: false,
    provider_status: null,
    provider_last_tested_at: null,
    provider_capabilities_json: {},
    temperature: 0.2,
    max_tokens: 1800,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("llm-provider-health", () => {
  it("normalizes health booleans", () => {
    expect(
      normalizeMediaStudioHealth({
        codex_local_ready: 1,
        codex_local_command_available: "",
        local_openai_ready: "yes",
        openrouter_api_key_configured: "yes",
      }),
    ).toEqual(
      expect.objectContaining({
        codex_local_ready: true,
        codex_local_command_available: false,
        local_openai_ready: true,
        openrouter_api_key_configured: true,
      }),
    );
  });

  it("detects local OpenAI configuration from either enhancement or drafting config", () => {
    expect(
      hasConfiguredLocalOpenAiProvider(
        [makeEnhancementConfig({ provider_kind: "local_openai", provider_model_id: "local/model" })],
        null,
      ),
    ).toBe(true);
    expect(
      hasConfiguredLocalOpenAiProvider(
        [],
        makeDraftingConfig({ provider_kind: "local_openai", provider_base_url_configured: true }),
      ),
    ).toBe(true);
  });

  it("summarizes provider readiness in one place", () => {
    expect(
      summarizeLlmProviderReadiness(
        {
          codex_local_command_available: true,
          codex_local_login_configured: true,
          codex_local_ready: true,
          openrouter_api_key_configured: false,
        },
        [],
        null,
      ),
    ).toEqual(
      expect.objectContaining({
        codexLocal: expect.objectContaining({ configured: true, ready: true }),
        openRouter: expect.objectContaining({ configured: false, ready: false }),
        localOpenAi: expect.objectContaining({ configured: false, ready: false }),
        promptWorkflowsAvailable: true,
      }),
    );
  });

  it("treats saved local OpenAI defaults as configured while keeping prompt workflows gated on readiness", () => {
    expect(
      summarizeLlmProviderReadiness(
        {
          codex_local_command_available: false,
          codex_local_login_configured: false,
          codex_local_ready: false,
          openrouter_api_key_configured: false,
        },
        [makeEnhancementConfig({ provider_kind: "local_openai", provider_model_id: "local/director" })],
        null,
      ),
    ).toEqual(
      expect.objectContaining({
        localOpenAi: expect.objectContaining({ configured: true, ready: false }),
        promptWorkflowsAvailable: false,
      }),
    );
  });
});
