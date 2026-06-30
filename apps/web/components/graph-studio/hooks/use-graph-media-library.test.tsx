// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGraphMediaLibrary } from "./use-graph-media-library";

const { jsonFetch } = vi.hoisted(() => ({
  jsonFetch: vi.fn(),
}));

vi.mock("../utils/graph-api", () => ({
  creditBalanceFromPayload: vi.fn(() => null),
  jsonFetch,
}));

function Harness() {
  const { refreshImageAssets, refreshMediaLibrary, refreshReferenceMedia, assets, references } = useGraphMediaLibrary();

  useEffect(() => {
    void refreshMediaLibrary();
    void refreshImageAssets();
    void refreshReferenceMedia();
  }, [refreshImageAssets, refreshMediaLibrary, refreshReferenceMedia]);

  return (
    <div>
      <div data-testid="asset-count">{assets.length}</div>
      <div data-testid="reference-count">{references.length}</div>
    </div>
  );
}

function DetailHarness() {
  const { refreshAssetsByIds, assets } = useGraphMediaLibrary();

  useEffect(() => {
    void refreshAssetsByIds(["asset_1", "asset_1"]);
  }, [refreshAssetsByIds]);

  const firstAsset = assets[0];
  const outputs = firstAsset?.payload?.outputs;
  const firstOutput = Array.isArray(outputs) ? (outputs[0] as Record<string, unknown> | undefined) : undefined;

  return (
    <div>
      <div data-testid="asset-count">{assets.length}</div>
      <div data-testid="asset-width">{String(firstOutput?.width ?? "")}</div>
    </div>
  );
}

function ReferenceDetailHarness() {
  const { refreshReferencesByIds, references } = useGraphMediaLibrary();

  useEffect(() => {
    void refreshReferencesByIds(["ref_audio_1", "ref_audio_1"]);
  }, [refreshReferencesByIds]);

  return (
    <div>
      <div data-testid="reference-count">{references.length}</div>
      <div data-testid="reference-kind">{references[0]?.kind ?? ""}</div>
    </div>
  );
}

function PreserveExactAssetHarness() {
  const { refreshImageAssets, refreshAssetsByIds, assets } = useGraphMediaLibrary();

  useEffect(() => {
    void (async () => {
      await refreshImageAssets({ force: true });
      await refreshAssetsByIds(["asset_old_selected"]);
    })();
  }, [refreshAssetsByIds, refreshImageAssets]);

  return (
    <div>
      <div data-testid="asset-count">{assets.length}</div>
      <div data-testid="first-asset-id">{String(assets[0]?.asset_id ?? "")}</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  jsonFetch.mockReset();
});

describe("useGraphMediaLibrary", () => {
  it("deduplicates overlapping asset and reference refreshes", async () => {
    jsonFetch.mockImplementation(async (url: string) => {
      if (url.includes("/media-assets")) {
        if (url.includes("offset=0")) {
          return {
            assets: [{ asset_id: "asset_1", created_at: "2026-05-19T00:00:00.000Z" }],
            next_offset: 40,
          };
        }
        return {
          assets: [{ asset_id: "asset_41", created_at: "2026-05-18T00:00:00.000Z" }],
          next_offset: null,
        };
      }
      if (url.includes("/reference-media")) {
        return { items: [{ reference_id: "ref_1", file: "image.png" }] };
      }
      return {};
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("asset-count").textContent).toBe("2"));
    await waitFor(() => expect(screen.getByTestId("reference-count").textContent).toBe("1"));
    const assetCalls = jsonFetch.mock.calls.filter(([url]: [string]) => url.includes("/media-assets"));
    expect(assetCalls).toHaveLength(2);
    expect(assetCalls.map(([url]: [string]) => url)).toEqual([
      "/api/control/media-assets?limit=40&offset=0&generation_kind=image&view=picker",
      "/api/control/media-assets?limit=40&offset=40&generation_kind=image&view=picker",
    ]);
    expect(jsonFetch.mock.calls.filter(([url]: [string]) => url.includes("/reference-media"))).toHaveLength(1);
    expect(jsonFetch.mock.calls.some(([url]: [string]) => url === "/api/control/reference-media?limit=40&offset=0&kind=image")).toBe(true);
  });

  it("hydrates exact asset ids with full detail for graph previews", async () => {
    jsonFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/media-assets/asset_1")) {
        return {
          asset: {
            asset_id: "asset_1",
            created_at: "2026-05-19T00:00:00.000Z",
            generation_kind: "image",
            hero_thumb_url: "/thumb.webp",
            payload: { outputs: [{ width: 1536, height: 1024 }] },
          },
        };
      }
      return {};
    });

    render(<DetailHarness />);

    await waitFor(() => expect(screen.getByTestId("asset-count").textContent).toBe("1"));
    expect(screen.getByTestId("asset-width").textContent).toBe("1536");
    expect(jsonFetch.mock.calls.filter(([url]: [string]) => url.endsWith("/media-assets/asset_1"))).toHaveLength(1);
  });

  it("keeps an exact hydrated asset even when it is older than the capped library page", async () => {
    const pageAssets = Array.from({ length: 80 }, (_, index) => ({
      asset_id: `asset_new_${index}`,
      created_at: `2026-06-${String(23 - Math.floor(index / 4)).padStart(2, "0")}T00:00:00.000Z`,
      generation_kind: "image",
      hero_thumb_url: `/thumb-${index}.webp`,
    }));
    jsonFetch.mockImplementation(async (url: string) => {
      if (url.includes("/media-assets?")) {
        return {
          assets: pageAssets,
          next_offset: null,
        };
      }
      if (url.endsWith("/media-assets/asset_old_selected")) {
        return {
          asset: {
            asset_id: "asset_old_selected",
            created_at: "2026-05-19T00:00:00.000Z",
            generation_kind: "audio",
            hero_original_url: "/audio/old.mp3",
          },
        };
      }
      return {};
    });

    render(<PreserveExactAssetHarness />);

    await waitFor(() => expect(screen.getByTestId("asset-count").textContent).toBe("80"));
    expect(screen.getByTestId("first-asset-id").textContent).toBe("asset_old_selected");
  });

  it("hydrates exact reference ids with full detail for graph previews", async () => {
    jsonFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/reference-media/ref_audio_1")) {
        return {
          item: {
            reference_id: "ref_audio_1",
            kind: "audio",
            stored_url: "/reference/dialog.wav",
            duration_seconds: 2,
            created_at: "2026-05-19T00:00:00.000Z",
          },
        };
      }
      return {};
    });

    render(<ReferenceDetailHarness />);

    await waitFor(() => expect(screen.getByTestId("reference-count").textContent).toBe("1"));
    expect(screen.getByTestId("reference-kind").textContent).toBe("audio");
    expect(jsonFetch.mock.calls.filter(([url]: [string]) => url.endsWith("/reference-media/ref_audio_1"))).toHaveLength(1);
  });
});
