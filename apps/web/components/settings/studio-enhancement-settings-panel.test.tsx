// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioEnhancementSettingsPanel } from "@/components/settings/studio-enhancement-settings-panel";
import { __resetSharedProviderModelCatalogCacheForTests } from "@/hooks/use-shared-provider-model-catalog";
import type { MediaEnhancementConfig } from "@/lib/types";

const {
  probeEnhancementProviderRequest,
  saveEnhancementConfigRequest,
} = vi.hoisted(() => ({
  probeEnhancementProviderRequest: vi.fn(),
  saveEnhancementConfigRequest: vi.fn(),
}));

vi.mock("@/lib/media-model-admin", () => ({
  probeEnhancementProviderRequest,
  saveEnhancementConfigRequest,
  upsertEnhancementConfigEntry: (items: MediaEnhancementConfig[], config: MediaEnhancementConfig) => {
    const next = items.filter((item) => item.model_key !== config.model_key);
    return [...next, config];
  },
}));

function makeConfig(overrides: Partial<MediaEnhancementConfig> = {}): MediaEnhancementConfig {
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

describe("StudioEnhancementSettingsPanel", () => {
  beforeEach(() => {
    probeEnhancementProviderRequest.mockReset();
    saveEnhancementConfigRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
    __resetSharedProviderModelCatalogCacheForTests();
  });

  it("renders Codex Local defaults and saves the shared config", async () => {
    probeEnhancementProviderRequest.mockResolvedValue({
      ok: true,
      credentialSource: "codex_local_login",
      selectedModel: { id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true },
      availableModels: [
        { id: "gpt-5.5", label: "GPT-5.5", provider: "codex_local", supports_images: true },
        { id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true },
      ],
    });
    saveEnhancementConfigRequest.mockResolvedValue({
      ok: true,
      config: makeConfig(),
    });

    render(<StudioEnhancementSettingsPanel initialConfigs={[makeConfig()]} embedded />);

    await waitFor(() => {
      expect(probeEnhancementProviderRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_kind: "codex_local",
          require_images: true,
        }),
      );
    });

    expect(screen.getByText(/Uses Codex on this machine/i)).toBeTruthy();
    expect(screen.getByText(/included in plan/i)).toBeTruthy();
    expect(screen.getByText("Default model")).toBeTruthy();
    expect(screen.getByRole("button", { name: /refresh models/i })).toBeTruthy();
    expect(screen.getByText("Loaded 2 Codex models · included in plan")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /save prompt enhance defaults/i }));

    await waitFor(() => {
      expect(saveEnhancementConfigRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            provider_kind: "codex_local",
            provider_model_id: "gpt-5.4",
            supports_image_analysis: true,
          }),
        }),
      );
    });
    expect(await screen.findByText("Prompt Enhance defaults saved.")).toBeTruthy();
  });

  it("auto-loads Codex models into the enhancement model dropdown", async () => {
    probeEnhancementProviderRequest.mockResolvedValue({
      ok: true,
      credentialSource: "codex_local_login",
      selectedModel: { id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true },
      availableModels: [
        { id: "gpt-5.5", label: "GPT-5.5", provider: "codex_local", supports_images: true },
        { id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true },
      ],
    });

    render(<StudioEnhancementSettingsPanel initialConfigs={[makeConfig({ provider_model_id: "" })]} embedded />);

    await waitFor(() => {
      expect(probeEnhancementProviderRequest).toHaveBeenCalledTimes(1);
    });

    const modelSelect = screen.getByRole("combobox", { name: "Default model" }) as HTMLSelectElement;
    expect(Array.from(modelSelect.options).map((option) => option.text)).toContain("GPT-5.4 · multimodal");
    expect(Array.from(modelSelect.options).map((option) => option.text)).toContain("GPT-5.5 · multimodal");
  });

  it("keeps a saved local model visible when the provider catalog is unavailable", async () => {
    probeEnhancementProviderRequest.mockResolvedValue({
      ok: false,
      error: "Local endpoint unavailable",
      credentialSource: null,
      selectedModel: null,
      availableModels: [],
    });

    render(
      <StudioEnhancementSettingsPanel
        initialConfigs={[
          makeConfig({
            provider_kind: "local_openai",
            provider_model_id: "local/director",
            provider_label: "Local Director",
            provider_base_url_configured: true,
            provider_supports_images: false,
          }),
        ]}
        embedded
      />,
    );

    await waitFor(() => {
      expect(probeEnhancementProviderRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_kind: "local_openai",
        }),
      );
    });

    const modelSelect = screen.getByRole("combobox", { name: "Default model" }) as HTMLSelectElement;
    expect(Array.from(modelSelect.options).map((option) => option.text)).toContain("Local Director");
  });
});
