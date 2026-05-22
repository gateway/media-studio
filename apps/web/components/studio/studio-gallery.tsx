"use client";

import { StudioGalleryEmptyState } from "@/components/studio/studio-gallery-empty-state";
import { StudioGalleryLoadMore } from "@/components/studio/studio-gallery-load-more";
import { StudioGalleryTile } from "@/components/studio/studio-gallery-tile";
import type { GalleryTile } from "@/lib/studio-gallery";
import type { MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

type StudioGalleryProps = {
  apiHealthy: boolean;
  immersive: boolean;
  galleryTiles: GalleryTile[];
  activeGalleryHasMore: boolean;
  activeGalleryLoadingMore: boolean;
  selectedAssetId: string | number | null;
  favoriteAssetIdBusy: string | number | null;
  galleryLoadMoreRef: React.MutableRefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  onSelectAsset: (assetId: string | number) => void;
  onSelectFailedJob: (jobId: string) => void;
  onDragAsset: (event: React.DragEvent<HTMLDivElement>, asset: MediaAsset | null) => void;
  onToggleFavorite: (asset: MediaAsset | null) => void;
};

export function StudioGallery({
  apiHealthy,
  immersive,
  galleryTiles,
  activeGalleryHasMore,
  activeGalleryLoadingMore,
  selectedAssetId,
  favoriteAssetIdBusy,
  galleryLoadMoreRef,
  onLoadMore,
  onSelectAsset,
  onSelectFailedJob,
  onDragAsset,
  onToggleFavorite,
}: StudioGalleryProps) {
  if (galleryTiles.length === 0) {
    return <StudioGalleryEmptyState apiHealthy={apiHealthy} immersive={immersive} />;
  }

  return (
    <div
      data-testid="studio-gallery"
      className={cn(
        "studio-gallery-grid-shell relative z-[1] grid grid-flow-dense grid-cols-2 auto-rows-[92px] gap-px p-px sm:grid-cols-3 sm:auto-rows-[98px] lg:grid-cols-5 lg:auto-rows-[102px] xl:grid-cols-6 xl:auto-rows-[108px]",
        immersive ? "min-h-dvh pb-[270px] pt-0 md:pb-[290px]" : "min-h-[920px] pt-20",
      )}
    >
      {galleryTiles.map((tile, index) => {
        return (
          <StudioGalleryTile
            key={
              tile.job?.job_id
                ? `job-${tile.job.job_id}`
                : tile.asset?.asset_id != null
                  ? `asset-${tile.asset.asset_id}`
                  : `placeholder-${index}-${tile.label}`
            }
            tile={tile}
            index={index}
            selectedAssetId={selectedAssetId}
            favoriteAssetIdBusy={favoriteAssetIdBusy}
            onSelectAsset={onSelectAsset}
            onSelectFailedJob={onSelectFailedJob}
            onDragAsset={onDragAsset}
            onToggleFavorite={onToggleFavorite}
          />
        );
      })}
      {activeGalleryHasMore || activeGalleryLoadingMore ? (
        <StudioGalleryLoadMore
          loading={activeGalleryLoadingMore}
          galleryLoadMoreRef={galleryLoadMoreRef}
          onLoadMore={onLoadMore}
        />
      ) : null}
    </div>
  );
}
