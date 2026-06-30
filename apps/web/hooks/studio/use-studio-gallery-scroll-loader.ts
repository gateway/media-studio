import { useEffect, useRef, useState } from "react";

import {
  INITIAL_ASSET_AUTO_FILL_MAX,
  type AssetPagePayload,
} from "@/lib/media-studio-contract";

type UseStudioGalleryScrollLoaderOptions = {
  activeGalleryHasMore: boolean;
  activeGalleryLoadingMore: boolean;
  assetFeedNextOffset: number | null;
  favoriteAssetFeedNextOffset: number | null;
  favoritesOnly: boolean;
  galleryTilesLength: number;
  prefetchedAssetPage: AssetPagePayload | null;
  prefetchedFavoriteAssetPage: AssetPagePayload | null;
  prefetchingAssetPage: boolean;
  prefetchingFavoriteAssetPage: boolean;
  onLoadMoreActiveGalleryAssets: () => void;
};

export function useStudioGalleryScrollLoader({
  activeGalleryHasMore,
  activeGalleryLoadingMore,
  assetFeedNextOffset,
  favoriteAssetFeedNextOffset,
  favoritesOnly,
  galleryTilesLength,
  prefetchedAssetPage,
  prefetchedFavoriteAssetPage,
  prefetchingAssetPage,
  prefetchingFavoriteAssetPage,
  onLoadMoreActiveGalleryAssets,
}: UseStudioGalleryScrollLoaderOptions) {
  const galleryLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreAssetsRef = useRef<() => void>(() => undefined);
  const [galleryScrollArmed, setGalleryScrollArmed] = useState(false);

  loadMoreAssetsRef.current = onLoadMoreActiveGalleryAssets;

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 16) {
        setGalleryScrollArmed(true);
      }
    };
    const armFromGesture = () => {
      setGalleryScrollArmed(true);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("touchmove", armFromGesture, { passive: true });
    window.addEventListener("wheel", armFromGesture, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("touchmove", armFromGesture);
      window.removeEventListener("wheel", armFromGesture);
    };
  }, []);

  useEffect(() => {
    if (!activeGalleryHasMore || activeGalleryLoadingMore || !galleryLoadMoreRef.current) {
      return;
    }
    const target = galleryLoadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreAssetsRef.current();
        }
      },
      { rootMargin: "360px 0px 360px 0px" },
    );
    observer.observe(target);
    const maybeLoadMore = () => {
      if (!galleryScrollArmed && galleryTilesLength >= INITIAL_ASSET_AUTO_FILL_MAX) {
        return;
      }
      const scrollBottom = window.innerHeight + window.scrollY;
      const documentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      if (documentHeight - scrollBottom <= 520) {
        loadMoreAssetsRef.current();
      }
    };
    window.setTimeout(maybeLoadMore, 0);
    return () => observer.disconnect();
  }, [
    activeGalleryHasMore,
    activeGalleryLoadingMore,
    assetFeedNextOffset,
    favoriteAssetFeedNextOffset,
    favoritesOnly,
    galleryScrollArmed,
    galleryTilesLength,
    prefetchedAssetPage,
    prefetchedFavoriteAssetPage,
    prefetchingAssetPage,
    prefetchingFavoriteAssetPage,
  ]);

  return {
    galleryLoadMoreRef,
    galleryScrollArmed,
  };
}
