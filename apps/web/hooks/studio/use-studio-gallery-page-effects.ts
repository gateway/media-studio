import { useEffect } from "react";

import {
  ASSET_APPEND_BATCH_SIZE,
  type AssetPagePayload,
  type GalleryKindFilter,
  INITIAL_ASSET_PAGE_SIZE,
} from "@/lib/media-studio-contract";
import { prefetchAssetThumbs } from "@/lib/media-studio-helpers";
import { isDefaultStudioGalleryQuery } from "@/lib/studio-gallery-feed";
import type { MediaAsset } from "@/lib/types";

type StudioGalleryPageEffectsOptions = {
  activeProjectId: string | null;
  assetPageLimit: number;
  assetFeedHasMore: boolean;
  assetFeedNextOffset: number | null;
  loadingMoreAssets: boolean;
  prefetchingAssetPage: boolean;
  prefetchedAssetPage: AssetPagePayload | null;
  favoriteAssetFeedHasMore: boolean;
  favoriteAssetFeedNextOffset: number | null;
  loadingMoreFavoriteAssets: boolean;
  prefetchingFavoriteAssetPage: boolean;
  prefetchedFavoriteAssetPage: AssetPagePayload | null;
  favoritesOnly: boolean;
  galleryKindFilter: GalleryKindFilter;
  galleryModelFilter: string;
  galleryScrollArmed: boolean;
  prefetchedThumbUrls: Set<string>;
  fetchAssetPage: (options: {
    offset: number;
    favorited?: boolean;
    limitOverride?: number;
    silent?: boolean;
  }) => Promise<AssetPagePayload | null>;
  applyLoadedAssetPage: (page: AssetPagePayload) => void;
  applyLoadedFavoriteAssetPage: (page: AssetPagePayload) => void;
  setLocalAssets: (assets: MediaAsset[]) => void;
  setAssetFeedHasMore: (value: boolean) => void;
  setAssetFeedNextOffset: (value: number | null) => void;
  setPrefetchedAssetPage: (value: AssetPagePayload | null) => void;
  setFavoriteAssets: (assets: MediaAsset[] | null) => void;
  setFavoritesLoading: (value: boolean) => void;
  setFavoriteAssetFeedHasMore: (value: boolean) => void;
  setFavoriteAssetFeedNextOffset: (value: number | null) => void;
  setPrefetchedFavoriteAssetPage: (value: AssetPagePayload | null) => void;
  setPrefetchingAssetPage: (value: boolean) => void;
  setPrefetchingFavoriteAssetPage: (value: boolean) => void;
};

export function useStudioGalleryPageEffects({
  activeProjectId,
  assetPageLimit,
  assetFeedHasMore,
  assetFeedNextOffset,
  loadingMoreAssets,
  prefetchingAssetPage,
  prefetchedAssetPage,
  favoriteAssetFeedHasMore,
  favoriteAssetFeedNextOffset,
  loadingMoreFavoriteAssets,
  prefetchingFavoriteAssetPage,
  prefetchedFavoriteAssetPage,
  favoritesOnly,
  galleryKindFilter,
  galleryModelFilter,
  galleryScrollArmed,
  prefetchedThumbUrls,
  fetchAssetPage,
  applyLoadedAssetPage,
  applyLoadedFavoriteAssetPage,
  setLocalAssets,
  setAssetFeedHasMore,
  setAssetFeedNextOffset,
  setPrefetchedAssetPage,
  setFavoriteAssets,
  setFavoritesLoading,
  setFavoriteAssetFeedHasMore,
  setFavoriteAssetFeedNextOffset,
  setPrefetchedFavoriteAssetPage,
  setPrefetchingAssetPage,
  setPrefetchingFavoriteAssetPage,
}: StudioGalleryPageEffectsOptions) {
  useEffect(() => {
    if (favoritesOnly || isDefaultStudioGalleryQuery({ favoritesOnly, galleryKindFilter, galleryModelFilter })) {
      return;
    }
    let cancelled = false;
    setPrefetchedAssetPage(null);
    void fetchAssetPage({ offset: 0, limitOverride: INITIAL_ASSET_PAGE_SIZE, silent: true })
      .then((payload) => {
        if (cancelled || !payload) {
          return;
        }
        setLocalAssets(payload.assets ?? []);
        setAssetFeedHasMore(Boolean(payload.has_more));
        setAssetFeedNextOffset(payload.next_offset ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, favoritesOnly, galleryKindFilter, galleryModelFilter]);

  useEffect(() => {
    if (!favoritesOnly) {
      setFavoriteAssets(null);
      setFavoriteAssetFeedHasMore(false);
      setFavoriteAssetFeedNextOffset(null);
      setPrefetchedFavoriteAssetPage(null);
      return;
    }
    let cancelled = false;
    setFavoritesLoading(true);
    void fetchAssetPage({ offset: 0, favorited: true, limitOverride: INITIAL_ASSET_PAGE_SIZE })
      .then((payload) => {
        if (cancelled || !payload) {
          return;
        }
        setFavoriteAssets(payload.assets ?? []);
        setFavoriteAssetFeedHasMore(Boolean(payload.has_more));
        setFavoriteAssetFeedNextOffset(payload.next_offset ?? null);
        setPrefetchedFavoriteAssetPage(null);
      })
      .finally(() => {
        if (!cancelled) {
          setFavoritesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, favoritesOnly, galleryKindFilter, galleryModelFilter]);

  useEffect(() => {
    if (
      favoritesOnly ||
      !galleryScrollArmed ||
      !assetFeedHasMore ||
      assetFeedNextOffset == null ||
      loadingMoreAssets ||
      prefetchingAssetPage ||
      prefetchedAssetPage
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPrefetchingAssetPage(true);
      void fetchAssetPage({ offset: assetFeedNextOffset, limitOverride: ASSET_APPEND_BATCH_SIZE, silent: true })
        .then((page) => {
          if (cancelled || !page) {
            return;
          }
          prefetchAssetThumbs(page.assets ?? [], prefetchedThumbUrls);
          const scrollBottom = window.innerHeight + window.scrollY;
          const documentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          if (documentHeight - scrollBottom <= 520) {
            applyLoadedAssetPage(page);
            return;
          }
          setPrefetchedAssetPage(page);
        })
        .finally(() => {
          if (!cancelled) {
            setPrefetchingAssetPage(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeProjectId,
    assetFeedHasMore,
    assetFeedNextOffset,
    assetPageLimit,
    favoritesOnly,
    galleryScrollArmed,
    loadingMoreAssets,
    prefetchedAssetPage,
    prefetchingAssetPage,
  ]);

  useEffect(() => {
    if (
      !favoritesOnly ||
      !galleryScrollArmed ||
      !favoriteAssetFeedHasMore ||
      favoriteAssetFeedNextOffset == null ||
      loadingMoreFavoriteAssets ||
      prefetchingFavoriteAssetPage ||
      prefetchedFavoriteAssetPage
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPrefetchingFavoriteAssetPage(true);
      void fetchAssetPage({
        offset: favoriteAssetFeedNextOffset,
        favorited: true,
        limitOverride: ASSET_APPEND_BATCH_SIZE,
        silent: true,
      })
        .then((page) => {
          if (cancelled || !page) {
            return;
          }
          prefetchAssetThumbs(page.assets ?? [], prefetchedThumbUrls);
          const scrollBottom = window.innerHeight + window.scrollY;
          const documentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          if (documentHeight - scrollBottom <= 520) {
            applyLoadedFavoriteAssetPage(page);
            return;
          }
          setPrefetchedFavoriteAssetPage(page);
        })
        .finally(() => {
          if (!cancelled) {
            setPrefetchingFavoriteAssetPage(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    favoriteAssetFeedHasMore,
    favoriteAssetFeedNextOffset,
    favoritesOnly,
    galleryScrollArmed,
    galleryKindFilter,
    galleryModelFilter,
    activeProjectId,
    loadingMoreFavoriteAssets,
    prefetchedFavoriteAssetPage,
    prefetchingFavoriteAssetPage,
  ]);
}
