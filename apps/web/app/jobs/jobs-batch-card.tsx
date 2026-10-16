"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Clapperboard } from "lucide-react";

import type { JobsBatchCardView, JobsCardJob } from "@/app/jobs/jobs-batch-card-view";
import { MediaBatchActions } from "@/app/jobs/media-batch-actions";
import { adminInsetCompactClassName } from "@/components/admin-theme";
import { adminInsetCardClassName } from "@/components/admin-controls";
import { StatusPill } from "@/components/status-pill";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { CalloutPanel, SurfaceInset } from "@/components/ui/surface-primitives";
import { mediaDisplayUrl, mediaPlaybackUrl, mediaVariantUrl, toneForStatus } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";
import { cn, formatCreditsAmount, formatDateTime, formatUsdAmount, truncate } from "@/lib/utils";

type JobsBatchCardProps = {
  batch: JobsBatchCardView;
  assets: MediaAsset[];
};

function batchAssetForJob(job: JobsCardJob, assets: MediaAsset[]) {
  return assets.find((asset) => asset.job_id === job.job_id) ?? null;
}

function batchStatusLabel(status: string | null | undefined) {
  if (status === "completed") return "Completed";
  if (status === "partial_failure") return "Partial failure";
  if (status === "failed") return "Failed";
  if (status === "processing" || status === "running") return "Processing";
  if (status === "queued") return "Queued";
  return status ? status.replaceAll("_", " ") : "Unknown";
}

function previewThumbUrl(asset: MediaAsset | null) {
  if (!asset) {
    return null;
  }
  return mediaDisplayUrl(asset);
}

function lightboxVisual(asset: MediaAsset | null) {
  if (!asset) {
    return null;
  }
  if (asset.generation_kind === "video") {
    return mediaPlaybackUrl(asset) ?? previewThumbUrl(asset);
  }
  return mediaVariantUrl(asset, "original") ?? mediaVariantUrl(asset, "web") ?? previewThumbUrl(asset);
}

export function JobsBatchCard({ batch, assets }: JobsBatchCardProps) {
  const mutedCardClassName = adminInsetCardClassName;
  const adminInsetClassName = adminInsetCompactClassName;
  const jobs = useMemo(
    () => [...(batch.jobs ?? [])].sort((left, right) => (left.batch_index ?? 1) - (right.batch_index ?? 1)),
    [batch.jobs],
  );
  const pricingSummary = batch.pricing_summary;
  const [lightboxAssetId, setLightboxAssetId] = useState<string | number | null>(null);
  const lightboxVideoRef = useRef<HTMLVideoElement | null>(null);
  const lightboxAssetIds = useMemo(
    () =>
      jobs
        .map((job) => batchAssetForJob(job, assets)?.asset_id ?? null)
        .filter((assetId): assetId is string | number => assetId != null),
    [assets, jobs],
  );
  const selectedLightboxAsset = useMemo(
    () => assets.find((asset) => String(asset.asset_id) === String(lightboxAssetId)) ?? null,
    [assets, lightboxAssetId],
  );
  const navigateLightboxAsset = useCallback(
    (direction: 1 | -1) => {
      if (lightboxAssetId == null || lightboxAssetIds.length < 2) {
        return false;
      }
      const currentIndex = lightboxAssetIds.findIndex((assetId) => String(assetId) === String(lightboxAssetId));
      if (currentIndex === -1) {
        return false;
      }
      const nextIndex = (currentIndex + direction + lightboxAssetIds.length) % lightboxAssetIds.length;
      const nextAssetId = lightboxAssetIds[nextIndex];
      if (nextAssetId == null || String(nextAssetId) === String(lightboxAssetId)) {
        return false;
      }
      setLightboxAssetId(nextAssetId);
      return true;
    },
    [lightboxAssetId, lightboxAssetIds],
  );
  const batchStatusTone = batch.status === "partial_failure" ? "warning" : toneForStatus(batch.status);

  return (
    <>
      <details className="admin-data-row">
        <summary className="admin-data-summary admin-jobs-columns">
          <div className="admin-job-identity">
            <span className="admin-job-thumbnail">
              {previewThumbUrl(assets[0] ?? null)
                ? <img src={previewThumbUrl(assets[0])!} alt="" loading="lazy" />
                : <Clapperboard className="size-5" />}
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{batch.prompt_summary || "Generation batch"}</h3>
              <div className="admin-data-meta">{truncate(batch.batch_id, 20)} · {formatDateTime(batch.created_at)}</div>
            </div>
          </div>
          <span className="admin-data-model">{batch.model_key ?? "Unknown model"}</span>
          <StatusPill label={batchStatusLabel(batch.status)} tone={batchStatusTone} />
          <span>{jobs.filter((job) => batchAssetForJob(job, assets)).length} / {batch.requested_outputs} outputs</span>
          <span>{formatUsdAmount(pricingSummary?.totalUsd) ?? "n/a"}<span className="admin-data-meta">Estimated total</span></span>
          <span className="admin-row-action">View outputs</span>
        </summary>
        <div className="admin-data-body">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="admin-label-muted">Prompt summary</div>
              <p className="mt-2 text-sm text-[var(--muted-strong)]">{batch.prompt_summary}</p>
            </div>
            <MediaBatchActions
              batchId={batch.batch_id}
              canCancelQueued={batch.queued_count > 0 && (batch.status === "queued" || batch.status === "processing")}
            />
          </div>
          <div className="my-4 flex flex-wrap gap-3 text-xs text-[var(--muted-strong)]">
            <span>{batch.queued_count} queued</span>
            <span>{batch.running_count} processing</span>
            <span>{batch.failed_count} failed</span>
          </div>
          {pricingSummary ? (
            <SurfaceInset appearance="admin" density="compact" className={`${adminInsetClassName} grid gap-3 lg:grid-cols-3`}>
              <div className="grid gap-1">
                <span className="admin-label-muted">Estimated total</span>
                <span className="text-[var(--foreground)]">
                  {formatUsdAmount(pricingSummary.totalUsd)}{" "}
                  <span className="text-[var(--muted-strong)]">/ {formatCreditsAmount(pricingSummary.totalCredits)} credits</span>
                </span>
              </div>
              <div className="grid gap-1">
                <span className="admin-label-muted">Per output</span>
                <span className="text-[var(--foreground)]">
                  {formatUsdAmount(pricingSummary.perOutputUsd)}{" "}
                  <span className="text-[var(--muted-strong)]">/ {formatCreditsAmount(pricingSummary.perOutputCredits)} credits</span>
                </span>
              </div>
              <div className="grid gap-1">
                <span className="admin-label-muted">Outputs</span>
                <span className="text-[var(--foreground)]">{pricingSummary.outputCount ?? batch.requested_outputs}</span>
              </div>
            </SurfaceInset>
          ) : null}
          <div className="flex flex-wrap gap-3 pt-2">
            {jobs.map((job) => {
              const asset = batchAssetForJob(job, assets);
              const childPreview = previewThumbUrl(asset);
              const canOpenLightbox = Boolean(asset && lightboxVisual(asset));
              return (
                <button
                  key={`${job.job_id}-inline-preview`}
                  type="button"
                  onClick={() => {
                    if (asset?.asset_id != null) {
                      setLightboxAssetId(asset.asset_id);
                    }
                  }}
                  disabled={!canOpenLightbox}
                  className={cn(
                    "surface-preview-frame overflow-hidden transition",
                    canOpenLightbox ? "hover:border-[var(--surface-border)] hover:bg-[color:var(--surface-muted)]" : "cursor-default opacity-80",
                  )}
                  title={canOpenLightbox ? `Open output ${job.batch_index ?? 1}` : `Output ${job.batch_index ?? 1}`}
                >
                  {childPreview ? (
                    <img
                      src={childPreview}
                      alt={`Output ${job.batch_index ?? 1}`}
                      loading="lazy"
                      decoding="async"
                      className="h-[84px] w-[84px] object-cover"
                    />
                  ) : (
                    <div className="flex h-[84px] w-[84px] items-center justify-center px-2 text-center text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                      Output {job.batch_index ?? 1}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {jobs.some((job) => Boolean(job.error)) ? (
            <div className="mt-4 grid gap-3">
              {jobs
                .filter((job) => Boolean(job.error))
                .map((job) => (
                  <SurfaceInset key={`${job.job_id}-error`} appearance="admin" className={mutedCardClassName}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="text-sm text-[var(--foreground)]">Output {job.batch_index ?? 1}</div>
                      <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                        {formatDateTime(job.updated_at)}
                      </div>
                    </div>
                    <CalloutPanel appearance="admin" tone="danger" className="mt-3 px-3 py-2 text-sm text-[var(--danger)]">
                      {job.error}
                    </CalloutPanel>
                  </SurfaceInset>
                ))}
            </div>
          ) : null}
        </div>
      </details>

      {selectedLightboxAsset ? (
        <StudioLightbox
          selectedAsset={selectedLightboxAsset}
          selectedAssetDisplayVisual={previewThumbUrl(selectedLightboxAsset)}
          selectedAssetPlaybackVisual={mediaPlaybackUrl(selectedLightboxAsset)}
          selectedAssetLightboxVisual={lightboxVisual(selectedLightboxAsset)}
          lightboxVideoRef={lightboxVideoRef}
          onNavigate={navigateLightboxAsset}
          onClose={() => setLightboxAssetId(null)}
        />
      ) : null}
    </>
  );
}
