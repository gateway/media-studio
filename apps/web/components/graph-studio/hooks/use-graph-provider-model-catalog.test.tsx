// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetSharedProviderModelCatalogCacheForTests } from "@/hooks/use-shared-provider-model-catalog";

import { __resetGraphProviderReadinessCacheForTests, useGraphProviderModelCatalog } from "./use-graph-provider-model-catalog";

vi.mock("@/lib/media-model-admin", () => ({
  probeSharedProviderCatalogRequest: vi.fn(),
}));

import { probeSharedProviderCatalogRequest } from "@/lib/media-model-admin";

function Harness() {
  const catalog = useGraphProviderModelCatalog({
    nodes: [
      {
        id: "llm",
        data: {
          definition: { type: "prompt.llm" },
          fields: { provider: "codex_local" },
        },
      } as never,
    ],
    appendConsole: vi.fn(),
  });
  const entry = catalog.catalogs.codex_local;
  return (
    <div>
      <div data-testid="status">{entry?.status ?? "missing"}</div>
      <div data-testid="count">{String(entry?.availableModels.length ?? 0)}</div>
      <button type="button" onClick={() => void catalog.refreshProviderCatalog("codex_local", { announce: false })}>
        Refresh
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  __resetSharedProviderModelCatalogCacheForTests();
  __resetGraphProviderReadinessCacheForTests();
  vi.unstubAllGlobals();
});

describe("useGraphProviderModelCatalog", () => {
  it("loads provider models for prompt nodes and refreshes them on demand", async () => {
    const probe = vi.mocked(probeSharedProviderCatalogRequest);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          openrouter_api_key_configured: true,
          codex_local_command_available: true,
          codex_local_login_configured: true,
          codex_local_ready: true,
          local_openai_configured: false,
          local_openai_ready: false,
        }),
      }),
    );
    probe.mockResolvedValue({
      ok: true,
      credentialSource: "codex_local_login",
      selectedModel: null,
      availableModels: [{ id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true, input_modalities: ["text", "image"] }],
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(probe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
  });
});
