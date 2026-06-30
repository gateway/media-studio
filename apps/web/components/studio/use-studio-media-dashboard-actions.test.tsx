// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudioMediaDashboardActions } from "@/hooks/studio/use-studio-media-dashboard-actions";
import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

const baseAsset = {
  asset_id: "asset-1",
  job_id: "job-1",
  created_at: "2026-06-09T00:00:00.000Z",
  generation_kind: "image",
  favorited: false,
  hero_thumb_url: "/thumb.webp",
  payload: { outputs: [{ width: 1536, height: 1024 }] },
} as MediaAsset;

const secondAsset = {
  asset_id: "asset-2",
  created_at: "2026-06-08T00:00:00.000Z",
  generation_kind: "image",
  hero_thumb_url: "/thumb-2.webp",
} as MediaAsset;

function DashboardActionsHarness({
  initialAsset = baseAsset,
  initialFavorites = [baseAsset],
}: {
  initialAsset?: MediaAsset;
  initialFavorites?: MediaAsset[] | null;
}) {
  const [localAssets, setLocalAssets] = useState<MediaAsset[]>([initialAsset, secondAsset]);
  const [favoriteAssets, setFavoriteAssets] = useState<MediaAsset[] | null>(initialFavorites);
  const [localLatestAsset, setLocalLatestAsset] = useState<MediaAsset | null>(initialAsset);
  const [selectedAssetId, setSelectedAssetId] = useState<string | number | null>(initialAsset.asset_id);
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(initialAsset.asset_id);
  const [message, setMessage] = useState<ComposerStatusMessage | null>(null);
  const [favoriteUpdate, setFavoriteUpdate] = useState<MediaAsset | null>(null);
  const actions = useStudioMediaDashboardActions({
    selectedAssetId,
    selectedFailedJobId: null,
    sourceAssetId,
    setFormMessage: setMessage,
    setLocalJobs: vi.fn(),
    setLocalBatches: vi.fn(),
    setLocalAssets,
    setFavoriteAssets,
    setLocalLatestAsset,
    setSelectedAssetId,
    setSelectedFailedJobId: vi.fn(),
    setSourceAssetId,
    applyFavoriteAssetUpdate: (updatedAsset) => {
      setFavoriteUpdate(updatedAsset);
      setLocalAssets((current) => current.map((asset) => (asset.asset_id === updatedAsset.asset_id ? updatedAsset : asset)));
      setFavoriteAssets((current) => {
        if (!current) return current;
        return updatedAsset.favorited
          ? [updatedAsset, ...current.filter((asset) => asset.asset_id !== updatedAsset.asset_id)]
          : current.filter((asset) => asset.asset_id !== updatedAsset.asset_id);
      });
      setLocalLatestAsset((current) => (current?.asset_id === updatedAsset.asset_id ? updatedAsset : current));
    },
    upsertBatch: vi.fn(),
    pollJob: vi.fn(async (_jobId: string) => undefined),
    pollBatch: vi.fn(async (_batchId: string) => undefined),
    startRefresh: (callback) => callback(),
    refreshRoute: vi.fn(),
  });

  return (
    <div>
      <button type="button" onClick={() => void actions.dismissAsset(initialAsset.asset_id)}>
        dismiss
      </button>
      <button type="button" onClick={() => void actions.toggleAssetFavorite(localAssets[0] ?? null)}>
        favorite
      </button>
      <div data-testid="asset-ids">{localAssets.map((asset) => asset.asset_id).join(",")}</div>
      <div data-testid="favorite-ids">{favoriteAssets?.map((asset) => asset.asset_id).join(",") ?? "null"}</div>
      <div data-testid="latest-id">{String(localLatestAsset?.asset_id ?? "")}</div>
      <div data-testid="selected-id">{String(selectedAssetId ?? "")}</div>
      <div data-testid="source-id">{String(sourceAssetId ?? "")}</div>
      <div data-testid="favorite-update">{String(favoriteUpdate?.payload?.outputs ? "full" : favoriteUpdate?.asset_id ?? "")}</div>
      <div data-testid="message">{message?.text ?? ""}</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useStudioMediaDashboardActions", () => {
  it("dismisses an asset from local, favorite, latest, selected, and source state", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, asset: { ...baseAsset, dismissed_at: "2026-06-09T01:00:00.000Z" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardActionsHarness />);
    fireEvent.click(screen.getByText("dismiss"));

    await waitFor(() => expect(screen.getByTestId("asset-ids").textContent).toBe("asset-2"));
    expect(screen.getByTestId("favorite-ids").textContent).toBe("");
    expect(screen.getByTestId("latest-id").textContent).toBe("asset-2");
    expect(screen.getByTestId("selected-id").textContent).toBe("");
    expect(screen.getByTestId("source-id").textContent).toBe("");
    expect(screen.getByTestId("message").textContent).toBe("Removed the media card from the dashboard.");
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media-assets/asset-1", {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
  });

  it("applies the full exact-route asset returned by the favorite update", async () => {
    const fullFavoriteAsset = {
      ...baseAsset,
      favorited: true,
      favorited_at: "2026-06-09T01:00:00.000Z",
      payload: { outputs: [{ width: 2048, height: 1536 }] },
    } as MediaAsset;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, asset: fullFavoriteAsset }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardActionsHarness initialFavorites={[]} />);
    fireEvent.click(screen.getByText("favorite"));

    await waitFor(() => expect(screen.getByTestId("favorite-ids").textContent).toBe("asset-1"));
    expect(screen.getByTestId("asset-ids").textContent).toBe("asset-1,asset-2");
    expect(screen.getByTestId("latest-id").textContent).toBe("asset-1");
    expect(screen.getByTestId("favorite-update").textContent).toBe("full");
    expect(screen.getByTestId("message").textContent).toBe("Saved the media asset to favorites.");
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media-assets/asset-1", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ favorited: true }),
    });
  });
});
