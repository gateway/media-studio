import type { Dispatch, SetStateAction } from "react";

import {
  ASSET_APPEND_BATCH_SIZE,
  type AssetPagePayload,
  type ComposerStatusMessage,
  type GalleryKindFilter,
  INITIAL_ASSET_PAGE_SIZE,
} from "@/lib/media-studio-contract";
import { mergeAssetCollections, reconcileAssetCollections } from "@/lib/studio-gallery";
import {
  mergeAssetIntoCollection,
  pageMatchesExpectedJobIds,
} from "@/lib/studio-gallery-feed";
import type { MediaAsset } from "@/lib/types";

type GalleryPageActionParams = {
  activeProjectId: string | null;
  assetPageLimit: number;
  assetFeedHasMore: boolean;
  assetFeedNextOffset: number | null;
  loadingMoreAssets: boolean;
  prefetchedAssetPage: AssetPagePayload | null;
  favoritesOnly: boolean;
  favoriteAssetFeedHasMore: boolean;
  favoriteAssetFeedNextOffset: number | null;
  loadingMoreFavoriteAssets: boolean;
  prefetchedFavoriteAssetPage: AssetPagePayload | null;
  galleryKindFilter: GalleryKindFilter;
  galleryModelFilter: string;
  onMessage: (message: ComposerStatusMessage) => void;
  setLocalAssets: Dispatch<SetStateAction<MediaAsset[]>>;
  setAssetFeedHasMore: Dispatch<SetStateAction<boolean>>;
  setAssetFeedNextOffset: Dispatch<SetStateAction<number | null>>;
  setPrefetchedAssetPage: Dispatch<SetStateAction<AssetPagePayload | null>>;
  setLocalLatestAsset: Dispatch<SetStateAction<MediaAsset | null>>;
  setLoadingMoreAssets: Dispatch<SetStateAction<boolean>>;
  setFavoriteAssets: Dispatch<SetStateAction<MediaAsset[] | null>>;
  setFavoriteAssetFeedHasMore: Dispatch<SetStateAction<boolean>>;
  setFavoriteAssetFeedNextOffset: Dispatch<SetStateAction<number | null>>;
  setPrefetchedFavoriteAssetPage: Dispatch<SetStateAction<AssetPagePayload | null>>;
  setLoadingMoreFavoriteAssets: Dispatch<SetStateAction<boolean>>;
};

export function buildStudioGalleryAssetPageParams({
  activeProjectId,
  offset,
  favorited,
  limit,
  galleryKindFilter,
  galleryModelFilter,
}: {
  activeProjectId: string | null;
  offset: number;
  favorited?: boolean;
  limit: number;
  galleryKindFilter: GalleryKindFilter;
  galleryModelFilter: string;
}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, limit)),
    offset: String(Math.max(0, offset)),
    view: "summary",
  });
  if (favorited) {
    params.set("favorited", "true");
  }
  if (galleryKindFilter !== "all") {
    params.set("generation_kind", galleryKindFilter);
  }
  if (galleryModelFilter !== "all") {
    params.set("model_key", galleryModelFilter);
  }
  if (activeProjectId) {
    params.set("project_id", activeProjectId);
  }
  return params;
}

export function createStudioGalleryPageActions({
  activeProjectId,
  assetPageLimit,
  assetFeedHasMore,
  assetFeedNextOffset,
  loadingMoreAssets,
  prefetchedAssetPage,
  favoritesOnly,
  favoriteAssetFeedHasMore,
  favoriteAssetFeedNextOffset,
  loadingMoreFavoriteAssets,
  prefetchedFavoriteAssetPage,
  galleryKindFilter,
  galleryModelFilter,
  onMessage,
  setLocalAssets,
  setAssetFeedHasMore,
  setAssetFeedNextOffset,
  setPrefetchedAssetPage,
  setLocalLatestAsset,
  setLoadingMoreAssets,
  setFavoriteAssets,
  setFavoriteAssetFeedHasMore,
  setFavoriteAssetFeedNextOffset,
  setPrefetchedFavoriteAssetPage,
  setLoadingMoreFavoriteAssets,
}: GalleryPageActionParams) {
  async function fetchAssetPage({
    offset,
    favorited,
    limitOverride,
    silent = false,
  }: {
    offset: number;
    favorited?: boolean;
    limitOverride?: number;
    silent?: boolean;
  }): Promise<AssetPagePayload | null> {
    const params = buildStudioGalleryAssetPageParams({
      activeProjectId,
      offset,
      favorited,
      limit: limitOverride ?? assetPageLimit,
      galleryKindFilter,
      galleryModelFilter,
    });

    try {
      const response = await fetch(`/api/control/media-assets?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as AssetPagePayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to load media assets from the dashboard.");
      }
      return payload;
    } catch (error) {
      if (!silent) {
        onMessage({
          tone: "danger",
          text: error instanceof Error ? error.message : "The dashboard could not load more media assets.",
        });
      }
      return null;
    }
  }

  function applyLoadedAssetPage(page: AssetPagePayload) {
    const pageAssets = page.assets ?? [];
    setLocalAssets((current) => mergeAssetCollections(current, pageAssets));
    setAssetFeedHasMore(Boolean(page.has_more));
    setAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedAssetPage(null);
  }

  function applyRefreshedAssetPage(page: AssetPagePayload) {
    const pageAssets = page.assets ?? [];
    setLocalAssets((current) => reconcileAssetCollections(pageAssets, current));
    setAssetFeedHasMore(Boolean(page.has_more));
    setAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedAssetPage(null);
    if (galleryModelFilter === "all" && galleryKindFilter === "all") {
      setLocalLatestAsset((currentLatest) => pageAssets[0] ?? currentLatest);
    }
  }

  function applyLoadedFavoriteAssetPage(page: AssetPagePayload) {
    const pageAssets = page.assets ?? [];
    setFavoriteAssets((current) => mergeAssetCollections(current ?? [], pageAssets));
    setFavoriteAssetFeedHasMore(Boolean(page.has_more));
    setFavoriteAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedFavoriteAssetPage(null);
  }

  function applyRefreshedFavoriteAssetPage(page: AssetPagePayload) {
    const pageAssets = page.assets ?? [];
    setFavoriteAssets((current) => reconcileAssetCollections(pageAssets, current ?? []));
    setFavoriteAssetFeedHasMore(Boolean(page.has_more));
    setFavoriteAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedFavoriteAssetPage(null);
  }

  async function refreshActiveGalleryAssets({
    expectedJobIds = [],
    silent = true,
    attempts = 4,
  }: {
    expectedJobIds?: string[];
    silent?: boolean;
    attempts?: number;
  } = {}): Promise<boolean> {
    const normalizedExpectedJobIds = expectedJobIds.map((jobId) => String(jobId)).filter(Boolean);

    for (let attemptIndex = 0; attemptIndex < Math.max(1, attempts); attemptIndex += 1) {
      const page = await fetchAssetPage({
        offset: 0,
        favorited: favoritesOnly ? true : undefined,
        limitOverride: Math.max(assetPageLimit, INITIAL_ASSET_PAGE_SIZE),
        silent,
      });
      if (!page) {
        return false;
      }
      if (favoritesOnly) {
        applyRefreshedFavoriteAssetPage(page);
      } else {
        applyRefreshedAssetPage(page);
      }
      if (pageMatchesExpectedJobIds(page, normalizedExpectedJobIds)) {
        return true;
      }
      if (attemptIndex < attempts - 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 700);
        });
      }
    }

    return false;
  }

  async function loadMoreGalleryAssets() {
    if (favoritesOnly || loadingMoreAssets || !assetFeedHasMore || assetFeedNextOffset == null) {
      return;
    }
    setLoadingMoreAssets(true);
    try {
      if (prefetchedAssetPage && prefetchedAssetPage.offset === assetFeedNextOffset) {
        applyLoadedAssetPage(prefetchedAssetPage);
        return;
      }
      const page = await fetchAssetPage({ offset: assetFeedNextOffset, limitOverride: ASSET_APPEND_BATCH_SIZE });
      if (!page) {
        return;
      }
      applyLoadedAssetPage(page);
    } finally {
      setLoadingMoreAssets(false);
    }
  }

  async function loadMoreFavoriteGalleryAssets() {
    if (!favoritesOnly || loadingMoreFavoriteAssets || !favoriteAssetFeedHasMore || favoriteAssetFeedNextOffset == null) {
      return;
    }
    setLoadingMoreFavoriteAssets(true);
    try {
      if (prefetchedFavoriteAssetPage && prefetchedFavoriteAssetPage.offset === favoriteAssetFeedNextOffset) {
        applyLoadedFavoriteAssetPage(prefetchedFavoriteAssetPage);
        return;
      }
      const page = await fetchAssetPage({
        offset: favoriteAssetFeedNextOffset,
        favorited: true,
        limitOverride: ASSET_APPEND_BATCH_SIZE,
      });
      if (!page) {
        return;
      }
      applyLoadedFavoriteAssetPage(page);
    } finally {
      setLoadingMoreFavoriteAssets(false);
    }
  }

  function loadMoreActiveGalleryAssets() {
    if (favoritesOnly) {
      void loadMoreFavoriteGalleryAssets();
      return;
    }
    void loadMoreGalleryAssets();
  }

  function applyFavoriteAssetUpdate(updatedAsset: MediaAsset) {
    setLocalAssets((current) => mergeAssetIntoCollection(current, updatedAsset));
    setLocalLatestAsset((currentLatest) => (currentLatest?.asset_id === updatedAsset.asset_id ? updatedAsset : currentLatest));
    setFavoriteAssets((currentFavorites) => {
      if (!currentFavorites) {
        return currentFavorites;
      }
      if (updatedAsset.favorited) {
        return mergeAssetIntoCollection(currentFavorites, updatedAsset);
      }
      return currentFavorites.filter((asset) => asset.asset_id !== updatedAsset.asset_id);
    });
  }

  return {
    fetchAssetPage,
    applyLoadedAssetPage,
    applyRefreshedAssetPage,
    applyLoadedFavoriteAssetPage,
    applyRefreshedFavoriteAssetPage,
    refreshActiveGalleryAssets,
    loadMoreActiveGalleryAssets,
    mergeAssetIntoCollection,
    applyFavoriteAssetUpdate,
  };
}
