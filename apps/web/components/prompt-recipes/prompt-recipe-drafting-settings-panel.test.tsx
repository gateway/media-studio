// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptRecipeDraftingSettingsPanel } from "@/components/prompt-recipes/prompt-recipe-drafting-settings-panel";
import { __resetSharedProviderModelCatalogCacheForTests } from "@/hooks/use-shared-provider-model-catalog";
import type { PromptRecipeDraftingConfig } from "@/lib/types";

const {
  probePromptRecipeDraftingProviderRequest,
  savePromptRecipeDraftingConfigRequest,
} = vi.hoisted(() => ({
  probePromptRecipeDraftingProviderRequest: vi.fn(),
  savePromptRecipeDraftingConfigRequest: vi.fn(),
}));

vi.mock("@/lib/media-model-admin", () => ({
  probePromptRecipeDraftingProviderRequest,
  savePromptRecipeDraftingConfigRequest,
}));

function makeConfig(overrides: Partial<PromptRecipeDraftingConfig> = {}): PromptRecipeDraftingConfig {
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

describe("PromptRecipeDraftingSettingsPanel", () => {
  beforeEach(() => {
    probePromptRecipeDraftingProviderRequest.mockReset();
    savePromptRecipeDraftingConfigRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
    __resetSharedProviderModelCatalogCacheForTests();
  });

  it("saves drafting defaults and shows a success message", async () => {
    savePromptRecipeDraftingConfigRequest.mockResolvedValue({
      ok: true,
      config: makeConfig({
        provider_kind: "local_openai",
        provider_model_id: "local/director",
        provider_base_url_configured: false,
        provider_credential_source: "stored",
        temperature: 0.45,
        max_tokens: 2200,
      }),
    });

    render(
      <PromptRecipeDraftingSettingsPanel
        initialConfig={makeConfig({
          provider_kind: "local_openai",
          provider_model_id: "local/director",
          provider_base_url_configured: false,
          provider_credential_source: "stored",
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0.45" } });
    fireEvent.change(screen.getByLabelText("Max tokens"), { target: { value: "2200" } });
    fireEvent.click(screen.getByRole("button", { name: /save recipe defaults/i }));

    await waitFor(() => {
      expect(savePromptRecipeDraftingConfigRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          provider_kind: "local_openai",
          provider_model_id: "local/director",
          temperature: 0.45,
          max_tokens: 2200,
        }),
      );
    });
    expect(await screen.findByText("Recipe drafting defaults saved.")).toBeTruthy();
  });

  it("keeps the configured provider visible without exposing a provider-family switcher", () => {
    render(<PromptRecipeDraftingSettingsPanel initialConfig={makeConfig()} />);

    expect(screen.queryByTestId("studio-picker-drafting-provider-kind")).toBeNull();
    expect(screen.getByText(/AI service:/)).toBeTruthy();
    expect(screen.getAllByText("OpenRouter").length).toBeGreaterThan(0);
    expect(screen.getByTestId("studio-picker-drafting-openrouter-model")).toBeTruthy();
  });

  it("shows Codex Local copy and hides the base URL override", async () => {
    probePromptRecipeDraftingProviderRequest.mockResolvedValue({
      ok: true,
      credentialSource: "codex_local_login",
      selectedModel: { id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true },
      availableModels: [{ id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true }],
    });

    render(
      <PromptRecipeDraftingSettingsPanel
        initialConfig={makeConfig({
          provider_kind: "codex_local",
          provider_model_id: "gpt-5.4",
          provider_credential_source: "codex_local_login",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /refresh models/i }));

    await waitFor(() => {
      expect(probePromptRecipeDraftingProviderRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_kind: "codex_local",
        }),
      );
    });
    expect(screen.getByText(/AI service:/)).toBeTruthy();
    expect(screen.getAllByText("Codex Local").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Endpoint URL")).toBeNull();
    expect(screen.getByText(/Uses Codex on this machine with the local Codex or ChatGPT sign-in/i)).toBeTruthy();
    expect(screen.queryByLabelText("Temperature")).toBeNull();
    expect(screen.queryByLabelText("Max tokens")).toBeNull();
    expect(screen.getByText(/Codex Local manages its own drafting behavior/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /refresh models/i })).toBeTruthy();
    expect(screen.getByText(/Loaded 1 Codex model/i)).toBeTruthy();
  });

  it("saves the enabled toggle and hides provider-specific controls when recipe drafts are off", async () => {
    savePromptRecipeDraftingConfigRequest.mockResolvedValue({
      ok: true,
      config: makeConfig({
        enabled: false,
        provider_kind: "codex_local",
        provider_model_id: "gpt-5.4",
        provider_credential_source: "codex_local_login",
      }),
    });

    render(
      <PromptRecipeDraftingSettingsPanel
        initialConfig={makeConfig({
          enabled: true,
          provider_kind: "codex_local",
          provider_model_id: "gpt-5.4",
          provider_credential_source: "codex_local_login",
        })}
      />,
    );

    fireEvent.click(screen.getByLabelText("Let Media Studio draft recipes from an idea"));
    fireEvent.click(screen.getByRole("button", { name: /save recipe defaults/i }));

    await waitFor(() => {
      expect(savePromptRecipeDraftingConfigRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
        }),
      );
    });
    expect(screen.queryByLabelText("Default model")).toBeNull();
    expect(screen.getByText(/Recipe drafts are off\./i)).toBeTruthy();
  });

  it("keeps a saved provider model visible when a provider probe fails", async () => {
    probePromptRecipeDraftingProviderRequest.mockResolvedValue({
      ok: false,
      error: "Local endpoint unavailable",
      credentialSource: null,
      selectedModel: null,
      availableModels: [],
    });

    render(
      <PromptRecipeDraftingSettingsPanel
        initialConfig={makeConfig({
          provider_kind: "local_openai",
          provider_model_id: "local/director",
          provider_label: "Local Director",
          provider_base_url_configured: true,
          provider_credential_source: "stored",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /test endpoint/i }));

    await waitFor(() => {
      expect(probePromptRecipeDraftingProviderRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_kind: "local_openai",
        }),
      );
    });

    const modelSelect = screen.getByRole("combobox", { name: "Default model" }) as HTMLSelectElement;
    expect(Array.from(modelSelect.options).map((option) => option.text)).toContain("Local Director");
  });
});
