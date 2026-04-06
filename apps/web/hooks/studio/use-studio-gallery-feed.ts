import { useEffect, useMemo, useRef, useState } from "react";

import {
  ASSET_APPEND_BATCH_SIZE,
  type AssetPagePayload,
  type ComposerStatusMessage,
  type GalleryKindFilter,
  INITIAL_ASSET_PAGE_SIZE,
} from "@/lib/media-studio-contract";
import { prefetchAssetThumbs } from "@/lib/media-studio-helpers";
import {
  buildGalleryTiles,
  mergeAssetCollections,
  reconcileAssetCollections,
  type GalleryTile,
  upsertBatchCollection,
} from "@/lib/studio-gallery";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

type UseStudioGalleryFeedParams = {
  batches: MediaBatch[];
  jobs: MediaJob[];
  assets: MediaAsset[];
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
    loadMoreActiveGalleryAssets: () => void;
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
  initialAssetLimit,
  initialAssetsHasMore,
  initialAssetsNextOffset,
  latestAsset,
  onMessage,
}: UseStudioGalleryFeedParams): UseStudioGalleryFeedResult {
  const galleryLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreAssetsRef = useRef<() => void>(() => undefined);
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
  const [galleryScrollArmed, setGalleryScrollArmed] = useState(false);

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
        activeGalleryHasMore,
        allowLatestGalleryFallback,
        {
          modelKey: galleryModelFilter,
          generationKind: galleryKindFilter,
        },
      ),
    [
      activeGalleryHasMore,
      allowLatestGalleryFallback,
      localAssets,
      localLatestAsset,
      openBatches,
      openOptimisticBatches,
      visibleAssets,
    ],
  );

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
    const requestLimit = Math.max(1, limitOverride ?? assetPageLimit);
    const params = new URLSearchParams({
      limit: String(requestLimit),
      offset: String(Math.max(0, offset)),
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
    const expectedMatchSatisfied = (page: AssetPagePayload) =>
      normalizedExpectedJobIds.length === 0 ||
      (page.assets ?? []).some((asset) => {
        const assetJobId = typeof asset.job_id === "string" ? asset.job_id : null;
        return assetJobId ? normalizedExpectedJobIds.includes(assetJobId) : false;
      });

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
      if (expectedMatchSatisfied(page)) {
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

  loadMoreAssetsRef.current = () => {
    if (favoritesOnly) {
      void loadMoreFavoriteGalleryAssets();
      return;
    }
    void loadMoreGalleryAssets();
  };

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
    if (favoritesOnly) {
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
  }, [favoritesOnly, galleryKindFilter, galleryModelFilter]);

  useEffect(() => {
    setLocalLatestAsset(latestAsset);
  }, [latestAsset]);

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
    if (!activeGalleryHasMore || !galleryScrollArmed || activeGalleryLoadingMore || !galleryLoadMoreRef.current) {
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
    galleryTiles.length,
    prefetchedAssetPage,
    prefetchedFavoriteAssetPage,
    prefetchingAssetPage,
    prefetchingFavoriteAssetPage,
  ]);

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
  }, [favoritesOnly, galleryKindFilter, galleryModelFilter]);

  useEffect(() => {
    if (favoritesOnly || !assetFeedHasMore || assetFeedNextOffset == null || loadingMoreAssets || prefetchingAssetPage || prefetchedAssetPage) {
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
          prefetchAssetThumbs(page.assets ?? [], prefetchedThumbUrlsRef.current);
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
  }, [assetFeedHasMore, assetFeedNextOffset, assetPageLimit, favoritesOnly, loadingMoreAssets, prefetchedAssetPage, prefetchingAssetPage]);

  useEffect(() => {
    if (
      !favoritesOnly ||
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
          prefetchAssetThumbs(page.assets ?? [], prefetchedThumbUrlsRef.current);
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
    galleryKindFilter,
    galleryModelFilter,
    loadingMoreFavoriteAssets,
    prefetchedFavoriteAssetPage,
    prefetchingFavoriteAssetPage,
  ]);

  function mergeAssetIntoCollection(collection: MediaAsset[], updatedAsset: MediaAsset) {
    const existingIndex = collection.findIndex((asset) => asset.asset_id === updatedAsset.asset_id);
    if (existingIndex === -1) {
      return [updatedAsset, ...collection];
    }
    const nextCollection = [...collection];
    nextCollection[existingIndex] = updatedAsset;
    return nextCollection;
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
      loadMoreActiveGalleryAssets: loadMoreAssetsRef.current,
      refreshActiveGalleryAssets,
      upsertBatch: (batch) => setLocalBatches((current) => upsertBatchCollection(current, batch)),
      mergeAssetIntoCollection,
      applyFavoriteAssetUpdate,
    },
  };
}
