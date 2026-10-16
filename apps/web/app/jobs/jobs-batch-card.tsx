"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, LoaderCircle, XCircle } from "lucide-react";

import type { JobsBatchCardView, JobsCardJob } from "@/app/jobs/jobs-batch-card-view";
import { MediaBatchActions } from "@/app/jobs/media-batch-actions";
import {
  adminInsetCompactClassName,
} from "@/components/admin-theme";
import {
  adminInsetCardClassName,
  adminInsetPanelClassName,
} from "@/components/admin-controls";
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

function batchStatusIcon(status: string | null | undefined) {
  if (status === "completed") return CheckCircle2;
  if (status === "partial_failure") return AlertTriangle;
  if (status === "failed") return XCircle;
  return LoaderCircle;
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
  const BatchStatusIcon = batchStatusIcon(batch.status);
  const batchStatusTone = batch.status === "partial_failure" ? "warning" : toneForStatus(batch.status);

  return (
    <>
      <div className={cn(adminInsetPanelClassName, "surface-card")}>
        <div className="grid gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="min-w-0 text-[0.98rem] font-semibold tracking-[0.02em] text-[var(--foreground)]">
                    {batch.model_key ?? "Unknown model"}
                  </h3>
                  <div
                    className={cn(
                      "ml-auto inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] leading-none",
                      batchStatusTone === "healthy"
                        ? "text-[var(--success)]"
                        : batchStatusTone === "warning"
                          ? "text-[var(--warning)]"
                          : batchStatusTone === "danger"
                            ? "text-[var(--danger)]"
                            : "text-[var(--muted-strong)]",
                    )}
                  >
                    <BatchStatusIcon className={cn("size-[13px] shrink-0", batchStatusTone === "warning" ? "animate-[spin_1.4s_linear_infinite]" : "")} />
                    <span>{batchStatusLabel(batch.status)}</span>
                  </div>
                </div>
                <p className="max-w-none pr-4 text-sm leading-6 text-[var(--muted-strong)]">
                  {batch.prompt_summary}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right text-xs uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                  <div>{truncate(batch.batch_id, 20)}</div>
                  <span className="text-[var(--surface-border-soft)]">•</span>
                  <div>{formatDateTime(batch.created_at)}</div>
                </div>
                <MediaBatchActions
                  batchId={batch.batch_id}
                  canCancelQueued={batch.queued_count > 0 && (batch.status === "queued" || batch.status === "processing")}
                />
              </div>
            </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">
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
            </div>
          </div>
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
