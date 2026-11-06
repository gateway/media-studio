"use client";

import { AlertTriangle, Clapperboard, Heart, Image as ImageIcon, LoaderCircle, Music2, Play } from "lucide-react";

import { mediaThumbnailUrl, prettifyModelLabel } from "@/lib/media-studio-helpers";
import { galleryTileSizeBand, type GalleryTile } from "@/lib/studio-gallery";
import type { MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

type StudioGalleryTileProps = {
  tile: GalleryTile;
  index: number;
  selectedAssetId: string | number | null;
  favoriteAssetIdBusy: string | number | null;
  onSelectAsset: (assetId: string | number) => void;
  onSelectFailedJob: (jobId: string) => void;
  onDragAsset: (event: React.DragEvent<HTMLDivElement>, asset: MediaAsset | null) => void;
  onToggleFavorite: (asset: MediaAsset | null) => void;
};

function failedBatchSummary(_jobError: string | null | undefined) {
  return "Render failed. Open this tile to review the issue and retry in Studio.";
}

function tileBandClassName(tile: GalleryTile) {
  const band = galleryTileSizeBand(tile);
  if (band === "tall") {
    return "row-span-5";
  }
  if (band === "short") {
    return "row-span-2";
  }
  return "row-span-3";
}

export function StudioGalleryTile({
  tile,
  index,
  selectedAssetId,
  favoriteAssetIdBusy,
  onSelectAsset,
  onSelectFailedJob,
  onDragAsset,
  onToggleFavorite,
}: StudioGalleryTileProps) {
  const preview = mediaThumbnailUrl(tile.asset);
  const batchTile = tile.batch;
  const batchJob = tile.job;
  const jobPreview = preview;
  const eagerTile = index < 4;
  const selected = tile.asset?.asset_id != null && tile.asset.asset_id === selectedAssetId && !batchTile;
  const failedBatchTile = Boolean(batchTile && batchJob?.status === "failed");

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
        "studio-gallery-tile group",
        tileBandClassName(tile),
        selected ? "studio-gallery-tile-selected" : "",
        failedBatchTile ? "cursor-pointer" : "",
        tile.asset?.asset_id != null && !batchTile ? "cursor-pointer" : "",
        tile.asset?.asset_id != null && !batchTile ? "cursor-grab active:cursor-grabbing" : "",
      )}
      onClick={() => {
        if (tile.asset?.asset_id != null && !batchTile) {
          onSelectAsset(tile.asset.asset_id);
          return;
        }
        if (failedBatchTile && batchJob?.job_id) {
          onSelectFailedJob(batchJob.job_id);
        }
      }}
    >
      {jobPreview ? (
        <img
          src={jobPreview}
          alt={tile.asset?.prompt_summary ?? tile.label}
          loading={eagerTile ? "eager" : "lazy"}
          fetchPriority={eagerTile ? "high" : "auto"}
          decoding="async"
          className="transition duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="studio-gallery-placeholder h-full w-full" />
      )}
      <div className="studio-gallery-scrim" />
      {tile.asset?.generation_kind === "video" && !batchTile ? (
        <div className="studio-gallery-video-overlay">
          <span className="studio-icon-button studio-gallery-icon-button-md">
            <Play className="ml-0.5 size-5" />
          </span>
        </div>
      ) : null}
      {batchTile ? (
        <div className="studio-gallery-overlay">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="studio-icon-button studio-gallery-icon-button-lg">
              {batchJob?.status === "queued" ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="relative flex h-11 w-11 items-center justify-center">
                    <div className="absolute inset-0 animate-pulse rounded-full border border-[var(--accent-border)]" />
                    <div className="absolute inset-[6px] rounded-full border border-[var(--accent-border)] opacity-60" />
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-strong)]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-strong)] [animation-delay:180ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-strong)] [animation-delay:360ms]" />
                    </div>
                  </div>
                  <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]">Queued</div>
                </div>
              ) : batchJob?.status === "failed" ? (
                <AlertTriangle className="size-6 text-[var(--feedback-danger-text)]" />
              ) : (
                <LoaderCircle className="size-6 animate-spin text-[var(--accent-strong)]" />
              )}
            </div>
            <div className="text-[0.88rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {prettifyModelLabel(batchJob?.model_key ?? batchTile.model_key)}
            </div>
            {batchJob?.status === "failed" ? (
              <div className="max-w-[18rem] text-[0.74rem] leading-5 text-[var(--feedback-danger-text)]">
                {failedBatchSummary(batchJob?.error)}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {!batchTile ? (
        <div className="studio-gallery-footer">
          <div className="studio-gallery-footer-row">
            <div className="studio-gallery-model-label">
              {prettifyModelLabel(tile.asset?.model_key)}
            </div>
            <div className="studio-gallery-icon-row">
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
                    "studio-icon-button studio-gallery-icon-button-sm",
                    tile.asset?.favorited
                      ? "studio-icon-button-favorite"
                      : "",
                    favoriteAssetIdBusy === tile.asset.asset_id ? "opacity-60" : "",
                  )}
                  aria-label={tile.asset?.favorited ? "Unfavorite media asset" : "Favorite media asset"}
                >
                  <Heart className={cn("size-3.5", tile.asset?.favorited ? "fill-current" : "")} />
                </button>
              ) : null}
              <div className="studio-icon-button studio-gallery-icon-button-sm">
                {tile.asset?.generation_kind === "video" ? (
                  <Clapperboard className="size-3.5" />
                ) : tile.asset?.generation_kind === "audio" ? (
                  <Music2 className="size-3.5" />
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
}
