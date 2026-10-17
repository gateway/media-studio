// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LlmSettingsConsole } from "@/components/settings/llm-settings-console";
import type { MediaEnhancementConfig, PromptRecipeDraftingConfig } from "@/lib/types";

vi.mock("@/components/settings/studio-enhancement-settings-panel", () => ({
  StudioEnhancementSettingsPanel: () => <div>enhancement-panel</div>,
}));

vi.mock("@/components/prompt-recipes/prompt-recipe-drafting-settings-panel", () => ({
  PromptRecipeDraftingSettingsPanel: ({ purpose }: { purpose?: string }) => (
    <div>{purpose === "media_assistant" ? "assistant-panel" : "drafting-panel"}</div>
  ),
}));

function makeEnhancementConfig(overrides: Partial<MediaEnhancementConfig> = {}): MediaEnhancementConfig {
  return {
    config_id: "cfg_1",
    model_key: "__studio_enhancement__",
    status: "active",
    label: "Studio enhancement",
    helper_profile: "midctx-64k-no-thinking-q3-prefill",
    provider_kind: "codex_local",
    provider_label: "GPT-5.4",
    provider_model_id: "gpt-5.4",
    provider_api_key_configured: false,
    provider_base_url_configured: false,
    provider_credential_source: "codex_local_login",
    provider_supports_images: true,
    provider_status: "connected",
    provider_last_tested_at: "2026-05-18T00:00:00.000Z",
    provider_capabilities_json: {},
    system_prompt: "",
    image_analysis_prompt: "",
    supports_text_enhancement: true,
    supports_image_analysis: true,
    notes: "",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function makeDraftingConfig(overrides: Partial<PromptRecipeDraftingConfig> = {}): PromptRecipeDraftingConfig {
  return {
    config_key: "prompt_recipe_drafting",
    enabled: true,
    provider_kind: "openrouter",
    provider_label: "Qwen Draft",
    provider_model_id: "qwen/default",
    provider_base_url_configured: true,
    provider_credential_source: "env",
    provider_supports_images: false,
    provider_status: "connected",
    provider_last_tested_at: "2026-05-16T00:00:00.000Z",
    provider_capabilities_json: {},
    temperature: 0.2,
    max_tokens: 1800,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("LlmSettingsConsole", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the admin settings overview and collapsible sections with consistent copy", () => {
    render(
      <LlmSettingsConsole
        enhancementConfigs={[makeEnhancementConfig()]}
        mediaAssistantConfig={{ ...makeDraftingConfig(), config_key: "media_assistant", supports_media_studio_tools: true }}
        promptRecipeDraftingConfig={makeDraftingConfig()}
        openRouterSpend={null}
        health={{
          codex_local_command_available: true,
          codex_local_login_configured: true,
          codex_local_ready: true,
          openrouter_api_key_configured: true,
        }}
      />,
    );

    expect(screen.getByText("Default models")).toBeTruthy();
    expect(screen.queryByText("Available AI providers")).toBeNull();
    expect(screen.getByText("Prompt Enhance default model")).toBeTruthy();
    expect(screen.getByText("Recipe draft model")).toBeTruthy();
    expect(screen.getByText("Cost and usage")).toBeTruthy();
    expect(screen.getByText(/Start with Codex Local if this machine already uses Codex or ChatGPT/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage connections →" }).getAttribute("href")).toBe("/settings/connections");
    expect(screen.getByText(/Graph prompt nodes still choose their own model/i)).toBeTruthy();
    expect(screen.getByText("enhancement-panel")).toBeTruthy();
    expect(screen.getByText("drafting-panel")).toBeTruthy();
    expect(screen.getByText("assistant-panel")).toBeTruthy();
  });

});
