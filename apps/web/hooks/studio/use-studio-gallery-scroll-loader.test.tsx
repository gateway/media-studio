// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioGalleryScrollLoader } from "@/hooks/studio/use-studio-gallery-scroll-loader";
import { INITIAL_ASSET_AUTO_FILL_MAX } from "@/lib/media-studio-contract";

class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}

function setNearBottomPage() {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 1300 });
  Object.defineProperty(document.body, "scrollHeight", { configurable: true, value: 1300 });
}

function ScrollLoaderHarness({
  galleryTilesLength,
  onLoadMore,
}: {
  galleryTilesLength: number;
  onLoadMore: () => void;
}) {
  const loader = useStudioGalleryScrollLoader({
    activeGalleryHasMore: true,
    activeGalleryLoadingMore: false,
    assetFeedNextOffset: galleryTilesLength,
    favoriteAssetFeedNextOffset: null,
    favoritesOnly: false,
    galleryTilesLength,
    prefetchedAssetPage: null,
    prefetchedFavoriteAssetPage: null,
    prefetchingAssetPage: false,
    prefetchingFavoriteAssetPage: false,
    onLoadMoreActiveGalleryAssets: onLoadMore,
  });

  return <div ref={loader.galleryLoadMoreRef} />;
}

describe("useStudioGalleryScrollLoader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setNearBottomPage();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("auto-fills while below the initial fill cap", () => {
    const onLoadMore = vi.fn();
    render(
      <ScrollLoaderHarness
        galleryTilesLength={INITIAL_ASSET_AUTO_FILL_MAX - 1}
        onLoadMore={onLoadMore}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not keep auto-filling past the initial fill cap before user scroll", () => {
    const onLoadMore = vi.fn();
    render(
      <ScrollLoaderHarness
        galleryTilesLength={INITIAL_ASSET_AUTO_FILL_MAX}
        onLoadMore={onLoadMore}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
