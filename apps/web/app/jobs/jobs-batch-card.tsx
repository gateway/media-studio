"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, LoaderCircle, XCircle } from "lucide-react";

import { MediaBatchActions } from "@/app/jobs/media-batch-actions";
import {
  adminInsetCompactClassName,
} from "@/components/admin-theme";
import {
  adminInsetCardClassName,
  adminInsetPanelClassName,
} from "@/components/admin-controls";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { mediaDisplayUrl, mediaPlaybackUrl, mediaVariantUrl, toneForStatus } from "@/lib/media-studio-helpers";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";
import { cn, formatCreditsAmount, formatDateTime, formatUsdAmount, isRecord, toFiniteNumber, truncate } from "@/lib/utils";

type JobsBatchCardProps = {
  batch: MediaBatch;
  assets: MediaAsset[];
};

function batchPromptSummary(batch: MediaBatch) {
  const promptSummary = batch.request_summary?.prompt_summary;
  return typeof promptSummary === "string" && promptSummary.trim()
    ? promptSummary.trim()
    : "No prompt recorded for this batch.";
}

function batchAssetForJob(job: MediaJob, assets: MediaAsset[]) {
  return assets.find((asset) => asset.job_id === job.job_id) ?? null;
}

function batchPricingSummary(batch: MediaBatch) {
  const requestSummary = isRecord(batch.request_summary) ? batch.request_summary : null;
  const requestPricing = isRecord(requestSummary?.pricing_summary) ? requestSummary.pricing_summary : null;
  if (requestPricing) {
    return requestPricing;
  }

  for (const job of batch.jobs ?? []) {
    const preflight = isRecord(job.preflight) ? job.preflight : null;
    const pricing = isRecord(preflight?.pricing_summary) ? preflight.pricing_summary : null;
    if (pricing) {
      return pricing;
    }
  }

  return null;
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
  const pricingSummary = batchPricingSummary(batch);
  const totalPricing = isRecord(pricingSummary?.total) ? pricingSummary.total : null;
  const perOutputPricing = isRecord(pricingSummary?.per_output) ? pricingSummary.per_output : null;
  const savedOutputCount = toFiniteNumber(pricingSummary?.output_count);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | number | null>(null);
  const lightboxVideoRef = useRef<HTMLVideoElement | null>(null);
  const selectedLightboxAsset = useMemo(
    () => assets.find((asset) => String(asset.asset_id) === String(lightboxAssetId)) ?? null,
    [assets, lightboxAssetId],
  );
  const BatchStatusIcon = batchStatusIcon(batch.status);
  const batchStatusTone = batch.status === "partial_failure" ? "warning" : toneForStatus(batch.status);

  return (
    <>
      <div className={adminInsetPanelClassName}>
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
                      "ml-auto inline-flex items-center gap-2 text-[0.76rem] font-semibold uppercase tracking-[0.14em]",
                      batchStatusTone === "healthy"
                        ? "text-[var(--success)]"
                        : batchStatusTone === "warning"
                          ? "text-[var(--warning)]"
                          : batchStatusTone === "danger"
                            ? "text-[var(--danger)]"
                            : "text-[var(--muted-strong)]",
                    )}
                  >
                    <BatchStatusIcon className={cn("size-3.5", batchStatusTone === "warning" ? "animate-[spin_1.4s_linear_infinite]" : "")} />
                    <span>{batchStatusLabel(batch.status)}</span>
                  </div>
                </div>
                <p className="max-w-none pr-4 text-sm leading-6 text-[var(--muted-strong)]">
                  {truncate(batchPromptSummary(batch), 180)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right text-xs uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                  <div>{truncate(batch.batch_id, 20)}</div>
                  <span className="text-white/20">•</span>
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
                <div className={`${adminInsetClassName} grid gap-3 lg:grid-cols-3`}>
                  <div className="grid gap-1">
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                      Estimated total
                    </span>
                    <span className="text-[var(--foreground)]">
                      {formatUsdAmount(totalPricing?.estimated_cost_usd)}{" "}
                      <span className="text-[var(--muted-strong)]">/ {formatCreditsAmount(totalPricing?.estimated_credits)} credits</span>
                    </span>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                      Per output
                    </span>
                    <span className="text-[var(--foreground)]">
                      {formatUsdAmount(perOutputPricing?.estimated_cost_usd)}{" "}
                      <span className="text-[var(--muted-strong)]">/ {formatCreditsAmount(perOutputPricing?.estimated_credits)} credits</span>
                    </span>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                      Outputs
                    </span>
                    <span className="text-[var(--foreground)]">{savedOutputCount ?? batch.requested_outputs}</span>
                  </div>
                </div>
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
                        "overflow-hidden rounded-[18px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 transition",
                        canOpenLightbox ? "hover:border-white/16 hover:bg-[color:var(--surface-muted)]" : "cursor-default opacity-80",
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
                <div key={`${job.job_id}-error`} className={mutedCardClassName}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="text-sm text-[var(--foreground)]">Output {job.batch_index ?? 1}</div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/42">
                      {formatDateTime(job.updated_at)}
                    </div>
                  </div>
                  <div className="mt-3 rounded-[14px] border border-[rgba(175,79,64,0.18)] bg-[rgba(175,79,64,0.08)] px-3 py-2 text-sm text-[var(--danger)]">
                    {job.error}
                  </div>
                </div>
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
          onClose={() => setLightboxAssetId(null)}
        />
      ) : null}
    </>
  );
}
