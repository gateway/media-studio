// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetSharedProviderModelCatalogCacheForTests,
  invalidateProviderModelCatalogs,
  useSharedProviderModelCatalog,
} from "@/hooks/use-shared-provider-model-catalog";
import type { SharedLlmProviderKind } from "@/lib/llm-provider-metadata";

function Harness({
  testId,
  providerKind,
  probeRequest,
}: {
  testId: string;
  providerKind: SharedLlmProviderKind;
  probeRequest: Parameters<typeof useSharedProviderModelCatalog>[0]["probeRequest"];
}) {
  const { catalogs, loadProviderCatalog } = useSharedProviderModelCatalog({ probeRequest });

  useEffect(() => {
    void loadProviderCatalog(providerKind, {
      selectedModelId: "gpt-5.4",
      requireImages: false,
    });
  }, [loadProviderCatalog, providerKind]);

  return <div data-testid={testId}>{catalogs[providerKind]?.status ?? "idle"}</div>;
}

afterEach(() => {
  cleanup();
  __resetSharedProviderModelCatalogCacheForTests();
});

describe("useSharedProviderModelCatalog", () => {
  it("deduplicates concurrent provider catalog probes across hook instances", async () => {
    const probeRequest = vi.fn(async () => ({
      ok: true,
      credentialSource: "codex_local_login",
      selectedModel: { id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true, input_modalities: ["text", "image"] },
      availableModels: [{ id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true, input_modalities: ["text", "image"] }],
    }));

    render(
      <>
        <Harness testId="first" providerKind="codex_local" probeRequest={probeRequest} />
        <Harness testId="second" providerKind="codex_local" probeRequest={probeRequest} />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId("first").textContent).toBe("ready"));
    await waitFor(() => expect(screen.getByTestId("second").textContent).toBe("ready"));
    expect(probeRequest).toHaveBeenCalledTimes(1);
  });
  it("reloads a catalog after a connection save invalidates the cache", async () => {
    const probeRequest = vi.fn(async () => ({ ok: true, credentialSource: "stored", selectedModel: null, availableModels: [] }));
    const first = render(<Harness testId="before" providerKind="openrouter" probeRequest={probeRequest} />);
    await waitFor(() => expect(screen.getByTestId("before").textContent).toBe("ready"));
    first.unmount();
    invalidateProviderModelCatalogs();
    render(<Harness testId="after" providerKind="openrouter" probeRequest={probeRequest} />);
    await waitFor(() => expect(screen.getByTestId("after").textContent).toBe("ready"));
    expect(probeRequest).toHaveBeenCalledTimes(2);
  });
});
