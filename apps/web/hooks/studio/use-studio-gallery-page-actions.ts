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

export type GalleryPageRequestOwner = {
  pendingAppends: Set<number>;
  appendedOffsets: Set<number>;
  inFlight: Map<string, Promise<AssetPagePayload>>;
  cursors: Map<number, string>;
};

type GalleryPageActionParams = {
  requestOwner: GalleryPageRequestOwner;
  isCurrentQuery: () => boolean;
  activeProjectId: string | null;
  assetPageLimit: number;
  assetFeedHasMore: boolean;
  assetFeedNextOffset: number | null;
  loadingMoreAssets: boolean;
  firstGalleryPageFailed: boolean;
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
  setFirstGalleryPageFailed: Dispatch<SetStateAction<boolean>>;
};

export function buildStudioGalleryAssetPageParams({
  activeProjectId,
  offset,
  cursor,
  favorited,
  limit,
  galleryKindFilter,
  galleryModelFilter,
}: {
  activeProjectId: string | null;
  offset: number;
  cursor?: string;
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
  if (offset <= 0 || cursor) {
    params.set("pagination", "cursor");
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
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

function getOrCreateGalleryPageRequest(requestOwner: GalleryPageRequestOwner, requestKey: string): Promise<AssetPagePayload> {
  let request = requestOwner.inFlight.get(requestKey);
  if (!request) {
    request = (async () => {
      const response = await fetch(`/api/control/media-assets?${requestKey}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as AssetPagePayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to load media assets from the dashboard.");
      }
      return payload;
    })().finally(() => {
      requestOwner.inFlight.delete(requestKey);
    });
    requestOwner.inFlight.set(requestKey, request);
  }
  return request;
}

export function createStudioGalleryPageActions({
  requestOwner,
  isCurrentQuery,
  activeProjectId,
  assetPageLimit,
  assetFeedHasMore,
  assetFeedNextOffset,
  loadingMoreAssets,
  firstGalleryPageFailed,
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
  setFirstGalleryPageFailed,
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
    if (!isCurrentQuery()) {
      return null;
    }
    const params = buildStudioGalleryAssetPageParams({
      activeProjectId,
      offset,
      cursor: offset > 0 ? requestOwner.cursors.get(offset) : undefined,
      favorited,
      limit: limitOverride ?? assetPageLimit,
      galleryKindFilter,
      galleryModelFilter,
    });

    const requestKey = params.toString();
    const request = getOrCreateGalleryPageRequest(requestOwner, requestKey);
    try {
      const payload = await request;
      if (!isCurrentQuery()) {
        return null;
      }
      if (offset === 0) {
        requestOwner.cursors.clear();
      }
      if (payload.next_offset != null && payload.next_cursor) {
        requestOwner.cursors.set(payload.next_offset, payload.next_cursor);
      }
      return payload;
    } catch (error) {
      if (!silent && isCurrentQuery()) {
        onMessage({
          tone: "danger",
          text: error instanceof Error ? error.message : "The dashboard could not load more media assets.",
        });
      }
      return null;
    }
  }

  function claimAppendedPage(page: AssetPagePayload, expectedOffset: number | null) {
    if (!isCurrentQuery()) {
      return false;
    }
    const offset = page.offset ?? expectedOffset;
    if (offset != null) {
      if (requestOwner.appendedOffsets.has(offset)) {
        return false;
      }
      requestOwner.appendedOffsets.add(offset);
      requestOwner.cursors.delete(offset);
    }
    return true;
  }

  function applyLoadedAssetPage(page: AssetPagePayload) {
    if (!claimAppendedPage(page, assetFeedNextOffset)) {
      return;
    }
    const pageAssets = page.assets ?? [];
    setLocalAssets((current) => mergeAssetCollections(current, pageAssets));
    setAssetFeedHasMore(Boolean(page.has_more));
    setAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedAssetPage(null);
  }

  function applyRefreshedAssetPage(page: AssetPagePayload) {
    if (!isCurrentQuery()) {
      return;
    }
    requestOwner.appendedOffsets.clear();
    const pageAssets = page.assets ?? [];
    setLocalAssets((current) => firstGalleryPageFailed ? pageAssets : reconcileAssetCollections(pageAssets, current));
    setFirstGalleryPageFailed(false);
    setAssetFeedHasMore(Boolean(page.has_more));
    setAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedAssetPage(null);
    if (galleryModelFilter === "all" && galleryKindFilter === "all") {
      setLocalLatestAsset((currentLatest) => pageAssets[0] ?? (firstGalleryPageFailed ? null : currentLatest));
    }
  }

  function applyLoadedFavoriteAssetPage(page: AssetPagePayload) {
    if (!claimAppendedPage(page, favoriteAssetFeedNextOffset)) {
      return;
    }
    const pageAssets = page.assets ?? [];
    setFavoriteAssets((current) => mergeAssetCollections(current ?? [], pageAssets));
    setFavoriteAssetFeedHasMore(Boolean(page.has_more));
    setFavoriteAssetFeedNextOffset(page.next_offset ?? null);
    setPrefetchedFavoriteAssetPage(null);
  }

  function applyRefreshedFavoriteAssetPage(page: AssetPagePayload) {
    if (!isCurrentQuery()) {
      return;
    }
    requestOwner.appendedOffsets.clear();
    const pageAssets = page.assets ?? [];
    setFavoriteAssets((current) => firstGalleryPageFailed ? pageAssets : reconcileAssetCollections(pageAssets, current ?? []));
    setFirstGalleryPageFailed(false);
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
    if (
      !isCurrentQuery() ||
      favoritesOnly ||
      loadingMoreAssets ||
      !assetFeedHasMore ||
      assetFeedNextOffset == null ||
      requestOwner.pendingAppends.has(assetFeedNextOffset) ||
      requestOwner.appendedOffsets.has(assetFeedNextOffset)
    ) {
      return;
    }
    requestOwner.pendingAppends.add(assetFeedNextOffset);
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
      requestOwner.pendingAppends.delete(assetFeedNextOffset);
      if (isCurrentQuery()) {
        setLoadingMoreAssets(false);
      }
    }
  }

  async function loadMoreFavoriteGalleryAssets() {
    if (
      !isCurrentQuery() ||
      !favoritesOnly ||
      loadingMoreFavoriteAssets ||
      !favoriteAssetFeedHasMore ||
      favoriteAssetFeedNextOffset == null ||
      requestOwner.pendingAppends.has(favoriteAssetFeedNextOffset) ||
      requestOwner.appendedOffsets.has(favoriteAssetFeedNextOffset)
    ) {
      return;
    }
    requestOwner.pendingAppends.add(favoriteAssetFeedNextOffset);
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
      requestOwner.pendingAppends.delete(favoriteAssetFeedNextOffset);
      if (isCurrentQuery()) {
        setLoadingMoreFavoriteAssets(false);
      }
    }
  }

  function loadMoreActiveGalleryAssets() {
    if (firstGalleryPageFailed) {
      return retryFirstGalleryPage();
    }
    if (favoritesOnly) {
      return loadMoreFavoriteGalleryAssets();
    }
    return loadMoreGalleryAssets();
  }

  async function retryFirstGalleryPage() {
    if (
      !isCurrentQuery() ||
      requestOwner.pendingAppends.has(0) ||
      requestOwner.appendedOffsets.has(0)
    ) {
      return;
    }
    requestOwner.pendingAppends.add(0);
    const setLoading = favoritesOnly ? setLoadingMoreFavoriteAssets : setLoadingMoreAssets;
    setLoading(true);
    setFirstGalleryPageFailed(false);
    try {
      const refreshed = await refreshActiveGalleryAssets({ silent: false, attempts: 1 });
      if (isCurrentQuery()) {
        if (refreshed) {
          requestOwner.appendedOffsets.add(0);
        }
        setFirstGalleryPageFailed(!refreshed);
      }
    } finally {
      requestOwner.pendingAppends.delete(0);
      if (isCurrentQuery()) {
        setLoading(false);
      }
    }
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
