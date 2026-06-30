// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStudioGalleryPageEffects } from "@/hooks/studio/use-studio-gallery-page-effects";
import type { AssetPagePayload, GalleryKindFilter } from "@/lib/media-studio-contract";
import type { MediaAsset } from "@/lib/types";

type HarnessProps = {
  galleryKindFilter?: GalleryKindFilter;
  skipInitialAssetPageFetch?: boolean;
  fetchAssetPage: (options: {
    offset: number;
    favorited?: boolean;
    limitOverride?: number;
    silent?: boolean;
  }) => Promise<AssetPagePayload | null>;
  setLocalAssets: (assets: MediaAsset[]) => void;
};

function EffectsHarness({
  galleryKindFilter = "all",
  skipInitialAssetPageFetch = false,
  fetchAssetPage,
  setLocalAssets,
}: HarnessProps) {
  useStudioGalleryPageEffects({
    activeProjectId: null,
    assetPageLimit: 18,
    assetFeedHasMore: true,
    assetFeedNextOffset: 18,
    loadingMoreAssets: false,
    prefetchingAssetPage: false,
    prefetchedAssetPage: null,
    favoriteAssetFeedHasMore: false,
    favoriteAssetFeedNextOffset: null,
    loadingMoreFavoriteAssets: false,
    prefetchingFavoriteAssetPage: false,
    prefetchedFavoriteAssetPage: null,
    favoritesOnly: false,
    galleryKindFilter,
    galleryModelFilter: "all",
    galleryScrollArmed: false,
    skipInitialAssetPageFetch,
    prefetchedThumbUrls: new Set(),
    fetchAssetPage,
    applyLoadedAssetPage: vi.fn(),
    applyLoadedFavoriteAssetPage: vi.fn(),
    setLocalAssets,
    setAssetFeedHasMore: vi.fn(),
    setAssetFeedNextOffset: vi.fn(),
    setPrefetchedAssetPage: vi.fn(),
    setFavoriteAssets: vi.fn(),
    setFavoritesLoading: vi.fn(),
    setFavoriteAssetFeedHasMore: vi.fn(),
    setFavoriteAssetFeedNextOffset: vi.fn(),
    setPrefetchedFavoriteAssetPage: vi.fn(),
    setPrefetchingAssetPage: vi.fn(),
    setPrefetchingFavoriteAssetPage: vi.fn(),
  });

  return null;
}

describe("useStudioGalleryPageEffects", () => {
  it("skips only the initial server-backed asset page fetch", async () => {
    const fetchAssetPage = vi.fn(async () => ({
      ok: true,
      assets: [{ asset_id: "asset-image" } as MediaAsset],
      has_more: false,
      next_offset: null,
    }));
    const setLocalAssets = vi.fn();

    const { rerender } = render(
      <EffectsHarness
        skipInitialAssetPageFetch
        fetchAssetPage={fetchAssetPage}
        setLocalAssets={setLocalAssets}
      />,
    );

    await Promise.resolve();
    expect(fetchAssetPage).not.toHaveBeenCalled();

    rerender(
      <EffectsHarness
        galleryKindFilter="image"
        skipInitialAssetPageFetch={false}
        fetchAssetPage={fetchAssetPage}
        setLocalAssets={setLocalAssets}
      />,
    );

    await waitFor(() => expect(fetchAssetPage).toHaveBeenCalledTimes(1));
    expect(fetchAssetPage).toHaveBeenCalledWith({
      offset: 0,
      limitOverride: 18,
      silent: true,
    });
    expect(setLocalAssets).toHaveBeenCalledWith([{ asset_id: "asset-image" }]);
  });
});
