"use client";

import {
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Heart,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Music2,
  Play,
} from "lucide-react";

import {
  jobStatusLabel,
  mediaThumbnailUrl,
  prettifyModelLabel,
} from "@/lib/media-studio-helpers";
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
  onDragAsset: (
    event: React.DragEvent<HTMLDivElement>,
    asset: MediaAsset | null,
  ) => void;
  onToggleFavorite: (asset: MediaAsset | null) => void;
};

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
  const assetId = tile.asset?.asset_id;
  const inspectableAsset = assetId != null && !batchTile;
  const selected = inspectableAsset && assetId === selectedAssetId;
  const failedBatchTile = Boolean(batchTile && batchJob?.status === "failed");
  const canInspect = inspectableAsset || failedBatchTile;
  const modelLabel = prettifyModelLabel(
    batchJob?.model_key ?? tile.asset?.model_key ?? batchTile?.model_key,
  );
  const status = batchJob?.status ?? batchTile?.status;

  function selectTile() {
    if (inspectableAsset) {
      onSelectAsset(assetId);
    } else if (failedBatchTile && batchJob?.job_id) {
      onSelectFailedJob(batchJob.job_id);
    }
  }

  return (
    <div
      data-testid={
        batchTile ? "studio-gallery-batch-card" : "studio-gallery-card"
      }
      data-asset-id={
        tile.asset?.asset_id != null ? String(tile.asset.asset_id) : undefined
      }
      data-job-id={tile.job?.job_id ?? undefined}
      data-generation-kind={tile.asset?.generation_kind ?? undefined}
      key={
        tile.job?.job_id
          ? `job-${tile.job.job_id}`
          : tile.asset?.asset_id != null
            ? `asset-${tile.asset.asset_id}`
            : `placeholder-${index}-${tile.label}`
      }
      draggable={Boolean(inspectableAsset)}
      onDragStart={(event) => onDragAsset(event, tile.asset)}
      className={cn(
        "studio-gallery-tile group",
        tileBandClassName(tile),
        selected ? "studio-gallery-tile-selected" : "",
        failedBatchTile ? "cursor-pointer" : "",
        inspectableAsset ? "cursor-pointer" : "",
        inspectableAsset ? "cursor-grab active:cursor-grabbing" : "",
      )}
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
      {canInspect ? (
        <button
          type="button"
          className="studio-gallery-select"
          aria-label={
            failedBatchTile
              ? `View details for failed ${modelLabel} job`
              : `Inspect ${tile.asset?.generation_kind ?? "media"}: ${tile.asset?.prompt_summary ?? tile.label}`
          }
          aria-pressed={selected}
          onClick={selectTile}
        />
      ) : null}
      {tile.asset?.generation_kind === "video" && !batchTile ? (
        <div className="studio-gallery-video-overlay">
          <span className="studio-icon-button studio-gallery-icon-button-md">
            <Play className="ml-0.5 size-5" />
          </span>
        </div>
      ) : null}
      {batchTile ? (
        <StudioGalleryJobState
          status={status}
          failed={failedBatchTile}
          modelLabel={modelLabel}
        />
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
                    "studio-icon-button studio-gallery-icon-button-sm studio-gallery-favorite",
                    tile.asset.favorited ? "studio-icon-button-favorite" : "",
                    favoriteAssetIdBusy === tile.asset.asset_id
                      ? "opacity-60"
                      : "",
                  )}
                  aria-label={
                    tile.asset.favorited
                      ? "Unfavorite media asset"
                      : "Favorite media asset"
                  }
                  aria-pressed={Boolean(tile.asset.favorited)}
                >
                  <Heart
                    className={cn(
                      "size-3.5",
                      tile.asset.favorited ? "fill-current" : "",
                    )}
                  />
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

function StudioGalleryJobState({
  status,
  failed,
  modelLabel,
}: {
  status: string | null | undefined;
  failed: boolean;
  modelLabel: string;
}) {
  return (
    <div className="studio-gallery-overlay" data-status={status}>
      <div className="studio-gallery-state-visual" aria-hidden="true">
        {status === "queued" ? (
          <Layers3 className="size-10" />
        ) : failed ? (
          <ImageIcon className="size-10" />
        ) : (
          <LoaderCircle className="size-10 animate-spin" />
        )}
      </div>
      <div className="studio-gallery-state-footer">
        <span className="studio-gallery-state-label">
          {failed ? (
            <CircleAlert className="studio-gallery-state-danger size-4" />
          ) : status === "queued" ? (
            <Layers3 className="size-4" />
          ) : null}
          {jobStatusLabel(status)}
        </span>
        {failed ? (
          <span className="studio-gallery-state-details">
            View details
            <ChevronRight className="size-4" />
          </span>
        ) : null}
      </div>
      <span className="sr-only">{modelLabel}</span>
      {failed ? (
        <span className="sr-only">
          Render failed. Open this tile to review the issue and retry in Studio.
        </span>
      ) : null}
    </div>
  );
}
