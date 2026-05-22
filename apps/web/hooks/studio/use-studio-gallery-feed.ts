import { useEffect, useMemo, useRef, useState } from "react";

import {
  type AssetPagePayload,
  type ComposerStatusMessage,
  type GalleryKindFilter,
  INITIAL_ASSET_PAGE_SIZE,
} from "@/lib/media-studio-contract";
import {
  buildGalleryTiles,
  reconcileAssetCollections,
  type GalleryTile,
  upsertBatchCollection,
} from "@/lib/studio-gallery";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";
import { createStudioGalleryPageActions } from "@/hooks/studio/use-studio-gallery-page-actions";
import { useStudioGalleryPageEffects } from "@/hooks/studio/use-studio-gallery-page-effects";
import { useStudioGalleryScrollLoader } from "@/hooks/studio/use-studio-gallery-scroll-loader";
export { isDefaultStudioGalleryQuery } from "@/lib/studio-gallery-feed";

type UseStudioGalleryFeedParams = {
  batches: MediaBatch[];
  jobs: MediaJob[];
  assets: MediaAsset[];
  activeProjectId?: string | null;
  initialAssetLimit: number;
  initialAssetsHasMore: boolean;
  initialAssetsNextOffset: number | null;
  latestAsset: MediaAsset | null;
  onMessage: (message: ComposerStatusMessage) => void;
};

type UseStudioGalleryFeedResult = {
  state: {
    localBatches: MediaBatch[];
    optimisticBatches: MediaBatch[];
    localJobs: MediaJob[];
    localAssets: MediaAsset[];
    assetFeedHasMore: boolean;
    assetFeedNextOffset: number | null;
    loadingMoreAssets: boolean;
    localLatestAsset: MediaAsset | null;
    galleryModelFilter: string;
    galleryKindFilter: GalleryKindFilter;
    favoritesOnly: boolean;
    favoriteAssets: MediaAsset[] | null;
    favoritesLoading: boolean;
    favoriteAssetFeedHasMore: boolean;
    favoriteAssetFeedNextOffset: number | null;
    loadingMoreFavoriteAssets: boolean;
    galleryScrollArmed: boolean;
  };
  derived: {
    baseGalleryAssets: MediaAsset[];
    visibleAssets: MediaAsset[];
    allowLatestGalleryFallback: boolean;
    openBatches: MediaBatch[];
    openOptimisticBatches: MediaBatch[];
    activeGalleryHasMore: boolean;
    activeGalleryLoadingMore: boolean;
    galleryTiles: GalleryTile[];
  };
  refs: {
    galleryLoadMoreRef: React.MutableRefObject<HTMLDivElement | null>;
  };
  actions: {
    setLocalJobs: React.Dispatch<React.SetStateAction<MediaJob[]>>;
    setLocalBatches: React.Dispatch<React.SetStateAction<MediaBatch[]>>;
    setOptimisticBatches: React.Dispatch<React.SetStateAction<MediaBatch[]>>;
    setLocalAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
    setLocalLatestAsset: React.Dispatch<React.SetStateAction<MediaAsset | null>>;
    setGalleryModelFilter: React.Dispatch<React.SetStateAction<string>>;
    setGalleryKindFilter: React.Dispatch<React.SetStateAction<GalleryKindFilter>>;
    setFavoritesOnly: React.Dispatch<React.SetStateAction<boolean>>;
    setFavoriteAssets: React.Dispatch<React.SetStateAction<MediaAsset[] | null>>;
    activateGalleryKindFilter: (nextKind: GalleryKindFilter) => void;
    toggleFavoritesFilter: () => void;
    loadMoreActiveGalleryAssets: () => Promise<void>;
    refreshActiveGalleryAssets: (options?: { expectedJobIds?: string[]; silent?: boolean; attempts?: number }) => Promise<boolean>;
    upsertBatch: (batch: MediaBatch) => void;
    mergeAssetIntoCollection: (collection: MediaAsset[], updatedAsset: MediaAsset) => MediaAsset[];
    applyFavoriteAssetUpdate: (updatedAsset: MediaAsset) => void;
  };
};

export function useStudioGalleryFeed({
  batches,
  jobs,
  assets,
  activeProjectId = null,
  initialAssetLimit,
  initialAssetsHasMore,
  initialAssetsNextOffset,
  latestAsset,
  onMessage,
}: UseStudioGalleryFeedParams): UseStudioGalleryFeedResult {
  const prefetchedThumbUrlsRef = useRef(new Set<string>());
  const [localBatches, setLocalBatches] = useState<MediaBatch[]>(batches);
  const [optimisticBatches, setOptimisticBatches] = useState<MediaBatch[]>([]);
  const [localJobs, setLocalJobs] = useState<MediaJob[]>(jobs);
  const [localAssets, setLocalAssets] = useState<MediaAsset[]>(assets);
  const [assetPageLimit, setAssetPageLimit] = useState(Math.max(initialAssetLimit, INITIAL_ASSET_PAGE_SIZE));
  const [assetFeedHasMore, setAssetFeedHasMore] = useState(initialAssetsHasMore);
  const [assetFeedNextOffset, setAssetFeedNextOffset] = useState<number | null>(initialAssetsNextOffset);
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false);
  const [prefetchingAssetPage, setPrefetchingAssetPage] = useState(false);
  const [prefetchedAssetPage, setPrefetchedAssetPage] = useState<AssetPagePayload | null>(null);
  const [localLatestAsset, setLocalLatestAsset] = useState<MediaAsset | null>(latestAsset);
  const [galleryModelFilter, setGalleryModelFilter] = useState("all");
  const [galleryKindFilter, setGalleryKindFilter] = useState<GalleryKindFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteAssets, setFavoriteAssets] = useState<MediaAsset[] | null>(null);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteAssetFeedHasMore, setFavoriteAssetFeedHasMore] = useState(false);
  const [favoriteAssetFeedNextOffset, setFavoriteAssetFeedNextOffset] = useState<number | null>(null);
  const [loadingMoreFavoriteAssets, setLoadingMoreFavoriteAssets] = useState(false);
  const [prefetchingFavoriteAssetPage, setPrefetchingFavoriteAssetPage] = useState(false);
  const [prefetchedFavoriteAssetPage, setPrefetchedFavoriteAssetPage] = useState<AssetPagePayload | null>(null);

  const baseGalleryAssets = favoritesOnly ? favoriteAssets ?? [] : localAssets;
  const visibleAssets = useMemo(
    () =>
      baseGalleryAssets.filter((asset) => {
        if (galleryModelFilter !== "all" && asset.model_key !== galleryModelFilter) {
          return false;
        }
        if (galleryKindFilter !== "all" && asset.generation_kind !== galleryKindFilter) {
          return false;
        }
        return true;
      }),
    [baseGalleryAssets, galleryKindFilter, galleryModelFilter],
  );
  const allowLatestGalleryFallback = !favoritesOnly && galleryModelFilter === "all" && galleryKindFilter === "all";
  const openBatches = useMemo(
    () => localBatches.filter((batch) => ["queued", "processing", "failed", "partial_failure", "completed"].includes(batch.status)),
    [localBatches],
  );
  const openOptimisticBatches = useMemo(
    () => optimisticBatches.filter((batch) => ["queued", "processing"].includes(batch.status)),
    [optimisticBatches],
  );
  const activeGalleryHasMore = favoritesOnly ? favoriteAssetFeedHasMore : assetFeedHasMore;
  const activeGalleryLoadingMore = favoritesOnly ? loadingMoreFavoriteAssets : loadingMoreAssets;
  const galleryTiles = useMemo(
    () =>
      buildGalleryTiles(
        visibleAssets,
        localLatestAsset,
        [...openOptimisticBatches, ...openBatches],
        localAssets,
        localJobs,
        activeGalleryHasMore,
        allowLatestGalleryFallback,
        {
          modelKey: galleryModelFilter,
          generationKind: galleryKindFilter,
          favoritesOnly,
        },
      ),
    [
      activeGalleryHasMore,
      allowLatestGalleryFallback,
      localAssets,
      localJobs,
      localLatestAsset,
      openBatches,
      openOptimisticBatches,
      visibleAssets,
    ],
  );

  const pageActions = createStudioGalleryPageActions({
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
  });

  const galleryScrollLoader = useStudioGalleryScrollLoader({
    activeGalleryHasMore,
    activeGalleryLoadingMore,
    assetFeedNextOffset,
    favoriteAssetFeedNextOffset,
    favoritesOnly,
    galleryTilesLength: galleryTiles.length,
    prefetchedAssetPage,
    prefetchedFavoriteAssetPage,
    prefetchingAssetPage,
    prefetchingFavoriteAssetPage,
    onLoadMoreActiveGalleryAssets: pageActions.loadMoreActiveGalleryAssets,
  });

  const { galleryLoadMoreRef, galleryScrollArmed } = galleryScrollLoader;

  useEffect(() => {
    setLocalJobs(jobs);
  }, [jobs]);

  useEffect(() => {
    setLocalBatches(batches);
  }, [batches]);

  useEffect(() => {
    setLocalAssets((current) => reconcileAssetCollections(assets, current));
    setAssetPageLimit(Math.max(initialAssetLimit, INITIAL_ASSET_PAGE_SIZE));
    setAssetFeedHasMore((current) => current || initialAssetsHasMore);
    setAssetFeedNextOffset((current) => {
      if (current == null) {
        return initialAssetsNextOffset;
      }
      if (initialAssetsNextOffset == null) {
        return current;
      }
      return Math.max(current, initialAssetsNextOffset);
    });
    setPrefetchedAssetPage(null);
    setFavoriteAssetFeedHasMore(false);
    setFavoriteAssetFeedNextOffset(null);
    setPrefetchedFavoriteAssetPage(null);
  }, [assets, initialAssetLimit, initialAssetsHasMore, initialAssetsNextOffset]);

  useEffect(() => {
    setLocalLatestAsset(latestAsset);
  }, [latestAsset]);

  useStudioGalleryPageEffects({
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
    prefetchedThumbUrls: prefetchedThumbUrlsRef.current,
    fetchAssetPage: pageActions.fetchAssetPage,
    applyLoadedAssetPage: pageActions.applyLoadedAssetPage,
    applyLoadedFavoriteAssetPage: pageActions.applyLoadedFavoriteAssetPage,
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
  });

  function activateGalleryKindFilter(nextKind: GalleryKindFilter) {
    setFavoritesOnly(false);
    setGalleryKindFilter(nextKind);
  }

  function toggleFavoritesFilter() {
    setFavoritesOnly((current) => {
      const next = !current;
      if (next) {
        setGalleryKindFilter("all");
      }
      return next;
    });
  }

  return {
    state: {
      localBatches,
      optimisticBatches,
      localJobs,
      localAssets,
      assetFeedHasMore,
      assetFeedNextOffset,
      loadingMoreAssets,
      localLatestAsset,
      galleryModelFilter,
      galleryKindFilter,
      favoritesOnly,
      favoriteAssets,
      favoritesLoading,
      favoriteAssetFeedHasMore,
      favoriteAssetFeedNextOffset,
      loadingMoreFavoriteAssets,
      galleryScrollArmed,
    },
    derived: {
      baseGalleryAssets,
      visibleAssets,
      allowLatestGalleryFallback,
      openBatches,
      openOptimisticBatches,
      activeGalleryHasMore,
      activeGalleryLoadingMore,
      galleryTiles,
    },
    refs: {
      galleryLoadMoreRef,
    },
    actions: {
      setLocalJobs,
      setLocalBatches,
      setOptimisticBatches,
      setLocalAssets,
      setLocalLatestAsset,
      setGalleryModelFilter,
      setGalleryKindFilter,
      setFavoritesOnly,
      setFavoriteAssets,
      activateGalleryKindFilter,
      toggleFavoritesFilter,
      loadMoreActiveGalleryAssets: async () => pageActions.loadMoreActiveGalleryAssets(),
      refreshActiveGalleryAssets: pageActions.refreshActiveGalleryAssets,
      upsertBatch: (batch) => setLocalBatches((current) => upsertBatchCollection(current, batch)),
      mergeAssetIntoCollection: pageActions.mergeAssetIntoCollection,
      applyFavoriteAssetUpdate: pageActions.applyFavoriteAssetUpdate,
    },
  };
}
