"use client";

import { Clapperboard, Heart, Image as ImageIcon, LoaderCircle, Play } from "lucide-react";

import { gallerySpanClasses } from "@/lib/media-studio-contract";
import { mediaThumbnailUrl, prettifyModelLabel } from "@/lib/media-studio-helpers";
import type { GalleryTile } from "@/lib/studio-gallery";
import type { MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

type StudioGalleryProps = {
  immersive: boolean;
  galleryTiles: GalleryTile[];
  activeGalleryHasMore: boolean;
  activeGalleryLoadingMore: boolean;
  selectedAssetId: string | number | null;
  favoriteAssetIdBusy: string | number | null;
  galleryLoadMoreRef: React.MutableRefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  onSelectAsset: (assetId: string | number) => void;
  onDragAsset: (event: React.DragEvent<HTMLDivElement>, asset: MediaAsset | null) => void;
  onToggleFavorite: (asset: MediaAsset | null) => void;
};

export function StudioGallery({
  immersive,
  galleryTiles,
  activeGalleryHasMore,
  activeGalleryLoadingMore,
  selectedAssetId,
  favoriteAssetIdBusy,
  galleryLoadMoreRef,
  onLoadMore,
  onSelectAsset,
  onDragAsset,
  onToggleFavorite,
}: StudioGalleryProps) {
  if (galleryTiles.length === 0) {
    return (
      <div
        data-testid="studio-gallery"
        className={cn(
          "relative z-[1] flex items-center justify-center bg-white/6 p-px",
          immersive ? "min-h-dvh pb-[270px] pt-0 md:pb-[290px]" : "min-h-[920px] pt-20",
        )}
      >
        <div className="mx-4 w-full max-w-xl rounded-[32px] border border-white/10 bg-[rgba(11,14,13,0.9)] px-8 py-10 text-center text-white shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl">
          <div className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[rgba(216,141,67,0.82)]">Gallery Empty</div>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-white">Your studio is ready for the first render.</h2>
          <p className="mt-3 text-sm leading-6 text-white/68">
            Pick a model, write a prompt, and generate your first image or video. Finished results will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="studio-gallery"
      className={cn(
        "relative z-[1] grid grid-cols-2 gap-px bg-white/6 p-px sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6",
        immersive ? "min-h-dvh pb-[270px] pt-0 md:pb-[290px]" : "min-h-[920px] pt-20",
      )}
    >
      {galleryTiles.map((tile, index) => {
        const preview = mediaThumbnailUrl(tile.asset);
        const batchTile = tile.batch;
        const batchJob = tile.job;
        const jobPreview = preview;
        const eagerTile = index < 4;
        const selected = tile.asset?.asset_id != null && tile.asset.asset_id === selectedAssetId && !batchTile;
        return (
          <div
            data-testid={batchTile ? "studio-gallery-batch-card" : "studio-gallery-card"}
            data-asset-id={tile.asset?.asset_id != null ? String(tile.asset.asset_id) : undefined}
            data-job-id={tile.job?.job_id ?? undefined}
            data-generation-kind={tile.asset?.generation_kind ?? undefined}
            key={
              tile.job?.job_id
                ? `job-${tile.job.job_id}`
                : tile.asset?.asset_id != null
                  ? `asset-${tile.asset.asset_id}`
                  : `placeholder-${index}-${tile.label}`
            }
            draggable={Boolean(tile.asset?.asset_id != null && !batchTile)}
            onDragStart={(event) => onDragAsset(event, tile.asset)}
            className={cn(
              "group relative min-h-[190px] overflow-hidden bg-[#171b18] text-left sm:min-h-[250px]",
              gallerySpanClasses[index] ?? "",
              selected ? "ring-2 ring-[rgba(216,141,67,0.58)] ring-inset" : "",
              tile.asset?.asset_id != null && !batchTile ? "cursor-pointer" : "",
              tile.asset?.asset_id != null && !batchTile ? "cursor-grab active:cursor-grabbing" : "",
            )}
            onClick={() => tile.asset?.asset_id != null && !batchTile && onSelectAsset(tile.asset.asset_id)}
          >
            {jobPreview ? (
              <img
                src={jobPreview}
                alt={tile.asset?.prompt_summary ?? tile.label}
                loading={eagerTile ? "eager" : "lazy"}
                fetchPriority={eagerTile ? "high" : "auto"}
                decoding="async"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_45%),linear-gradient(180deg,#28302d,#1a1d1c)]" />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_20%,rgba(0,0,0,0.34)_76%,rgba(0,0,0,0.58)_100%)]" />
            {tile.asset?.generation_kind === "video" && !batchTile ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-[rgba(10,12,11,0.62)] text-white/88 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                  <Play className="ml-0.5 size-5" />
                </span>
              </div>
            ) : null}
            {batchTile ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[rgba(6,8,7,0.36)] p-4">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/14 bg-[rgba(18,22,19,0.92)] shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                    {batchJob?.status === "queued" ? (
                      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/84">Queued</div>
                    ) : (
                      <LoaderCircle className="size-6 animate-spin text-[#d8ff2e]" />
                    )}
                  </div>
                  <div className="text-[0.88rem] font-semibold uppercase tracking-[0.18em] text-white/68">
                    {prettifyModelLabel(batchJob?.model_key ?? batchTile.model_key)}
                  </div>
                </div>
              </div>
            ) : null}
            {!batchTile ? (
              <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/72">
                    {prettifyModelLabel(tile.asset?.model_key)}
                  </div>
                  <div className="flex items-center gap-2">
                    {tile.asset?.asset_id != null ? (
                      <button
                        type="button"
                        data-testid="studio-favorite-toggle"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleFavorite(tile.asset ?? null);
                        }}
                        disabled={favoriteAssetIdBusy === tile.asset.asset_id}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-xl transition",
                          tile.asset?.favorited
                            ? "border-[rgba(255,126,166,0.38)] bg-[rgba(255,126,166,0.16)] text-[#ff8db3]"
                            : "border-white/10 bg-[rgba(10,12,11,0.56)] text-white/76 hover:border-[rgba(255,126,166,0.28)] hover:text-[#ffd6e3]",
                          favoriteAssetIdBusy === tile.asset.asset_id ? "opacity-60" : "",
                        )}
                        aria-label={tile.asset?.favorited ? "Unfavorite media asset" : "Favorite media asset"}
                      >
                        <Heart className={cn("size-3.5", tile.asset?.favorited ? "fill-current" : "")} />
                      </button>
                    ) : null}
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[rgba(10,12,11,0.56)] text-white/82 backdrop-blur-xl">
                      {tile.asset?.generation_kind === "video" ? (
                        <Clapperboard className="size-3.5" />
                      ) : (
                        <ImageIcon className="size-3.5" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {activeGalleryHasMore || activeGalleryLoadingMore ? (
        <div
          ref={galleryLoadMoreRef}
          className="col-span-full flex min-h-16 items-center justify-center border-t border-white/6 bg-[rgba(10,12,11,0.72)] px-4 py-4 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/46"
        >
          {activeGalleryLoadingMore ? (
            "Loading more gallery items"
          ) : (
            <button
              type="button"
              onClick={onLoadMore}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-[rgba(18,22,19,0.92)] px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/72 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
            >
              Scroll or tap to load more
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
