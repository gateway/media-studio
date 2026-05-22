import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseSavedEnhancementConfig,
  parseSavedPromptRecipeDraftingConfig,
  probeEnhancementProviderRequest,
  probePromptRecipeDraftingProviderRequest,
  probeSharedProviderCatalogRequest,
  saveEnhancementConfigRequest,
  saveGlobalQueueSettingsRequest,
  saveModelQueuePolicyRequest,
  savePromptRecipeDraftingConfigRequest,
  upsertEnhancementConfigEntry,
} from "./media-model-admin";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("media-model-admin", () => {
  it("upserts enhancement configs by model key", () => {
    const list = [
      { model_key: "nano-banana-2", label: "Old" },
      { model_key: "seedance-2.0", label: "Seedance" },
    ] as never;
    const next = upsertEnhancementConfigEntry(list, { model_key: "nano-banana-2", label: "New" } as never);

    expect(next.map((entry) => entry.label)).toEqual(["New", "Seedance"]);
  });

  it("parses saved enhancement configs from both wrapped and direct responses", () => {
    expect(parseSavedEnhancementConfig({ config: { model_key: "nano-banana-2" } as never })).toMatchObject({
      model_key: "nano-banana-2",
    });
    expect(parseSavedEnhancementConfig({ model_key: "seedance-2.0" } as never)).toMatchObject({
      model_key: "seedance-2.0",
    });
    expect(parseSavedPromptRecipeDraftingConfig({ config: { config_key: "prompt_recipe_drafting" } as never })).toMatchObject({
      config_key: "prompt_recipe_drafting",
    });
  });

  it("sends enhancement config saves through the shared request helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, config: { model_key: "global" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveEnhancementConfigRequest({
      endpoint: "/api/control/media-enhancement-configs/global",
      method: "PATCH",
      payload: { model_key: "global", provider_kind: "openrouter" },
    });

    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject({ model_key: "global" });
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media-enhancement-configs/global", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_key: "global", provider_kind: "openrouter" }),
    });
  });

  it("sends provider probes through the shared request helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        credential_source: "stored",
        selected_model: { id: "qwen" },
        available_models: [{ id: "qwen" }, { id: "gpt" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeEnhancementProviderRequest({
      provider_kind: "openrouter",
      model_key: "global",
      api_key: "secret",
      base_url: null,
      selected_model_id: "qwen",
      require_images: true,
    });

    expect(result.ok).toBe(true);
    expect(result.credentialSource).toBe("stored");
    expect(result.availableModels).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media-enhancement-providers/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_kind: "openrouter",
        model_key: "global",
        api_key: "secret",
        base_url: null,
        selected_model_id: "qwen",
        require_images: true,
      }),
    });
  });

  it("normalizes queue settings saves through the shared request helper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, settings: { max_concurrent_jobs: 2, queue_enabled: true, default_poll_seconds: 8, max_retry_attempts: 3 } }),
      }),
    );

    const result = await saveGlobalQueueSettingsRequest({
      max_concurrent_jobs: 2,
      queue_enabled: true,
      default_poll_seconds: 8,
      max_retry_attempts: 3,
    } as never);

    expect(result.ok).toBe(true);
    expect(result.settings).toMatchObject({ max_concurrent_jobs: 2, queue_enabled: true });
  });

  it("saves prompt recipe drafting config through the shared request helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, config: { config_key: "prompt_recipe_drafting", provider_kind: "openrouter" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await savePromptRecipeDraftingConfigRequest({
      provider_kind: "openrouter",
      provider_model_id: "qwen/qwen3.5-35b-a3b",
    });

    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject({ config_key: "prompt_recipe_drafting", provider_kind: "openrouter" });
    expect(fetchMock).toHaveBeenCalledWith("/api/control/prompt-recipe-drafting-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_kind: "openrouter",
        provider_model_id: "qwen/qwen3.5-35b-a3b",
      }),
    });
  });

  it("probes prompt recipe drafting providers through the shared request helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        credential_source: "env",
        selected_model: { id: "qwen" },
        available_models: [{ id: "qwen" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await probePromptRecipeDraftingProviderRequest({
      provider_kind: "openrouter",
      provider_model_id: "qwen",
      provider_base_url: null,
      require_images: false,
    });

    expect(result.ok).toBe(true);
    expect(result.credentialSource).toBe("env");
    expect(result.selectedModel).toMatchObject({ id: "qwen" });
    expect(fetchMock).toHaveBeenCalledWith("/api/control/prompt-recipe-drafting-config/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_kind: "openrouter",
        provider_model_id: "qwen",
        provider_base_url: null,
        require_images: false,
      }),
    });
  });

  it("probes shared provider catalogs through the shared request helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        credential_source: "codex_local_login",
        selected_model: { id: "gpt-5.4" },
        available_models: [{ id: "gpt-5.4" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeSharedProviderCatalogRequest({
      provider_kind: "codex_local",
      provider_model_id: "gpt-5.4",
      provider_base_url: null,
      require_images: true,
    });

    expect(result.ok).toBe(true);
    expect(result.credentialSource).toBe("codex_local_login");
    expect(result.selectedModel).toMatchObject({ id: "gpt-5.4" });
    expect(fetchMock).toHaveBeenCalledWith("/api/control/shared-provider-catalog/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_kind: "codex_local",
        provider_model_id: "gpt-5.4",
        provider_base_url: null,
        require_images: true,
      }),
    });
  });

  it("clamps model queue policy saves through the shared request helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, policy: { model_key: "nano-banana-2", enabled: true, max_outputs_per_run: 4 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveModelQueuePolicyRequest("nano-banana-2", true, 999);

    expect(result.ok).toBe(true);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/control/media-queue-policies/nano-banana-2");
    expect(JSON.parse(request[1].body)).toMatchObject({ enabled: true, max_outputs_per_run: 10 });
  });
});
