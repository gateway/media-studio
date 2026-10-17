"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, Clapperboard, Music2, Play } from "lucide-react";

import type { JobsBatchCardView, JobsCardJob } from "@/app/jobs/jobs-batch-card-view";
import { MediaBatchActions } from "@/app/jobs/media-batch-actions";
import { AdminButton } from "@/components/admin-controls";
import { StatusPill } from "@/components/status-pill";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { CalloutPanel } from "@/components/ui/surface-primitives";
import { mediaDisplayUrl, mediaPlaybackUrl, mediaVariantUrl, toneForStatus } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";
import { formatCreditsAmount, formatDateTime, formatUsdAmount } from "@/lib/utils";

type JobsBatchCardProps = {
  batch: JobsBatchCardView;
  assets: MediaAsset[];
  modelLabel?: string;
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
  if (asset.generation_kind === "video" || asset.generation_kind === "audio") {
    return mediaPlaybackUrl(asset) ?? previewThumbUrl(asset);
  }
  return mediaVariantUrl(asset, "original") ?? mediaVariantUrl(asset, "web") ?? previewThumbUrl(asset);
}

export function JobsBatchCard({ batch, assets, modelLabel }: JobsBatchCardProps) {
  const jobs = useMemo(
    () => [...(batch.jobs ?? [])].sort((left, right) => (left.batch_index ?? 1) - (right.batch_index ?? 1)),
    [batch.jobs],
  );
  const pricingSummary = batch.pricing_summary;
  const [lightboxAssetId, setLightboxAssetId] = useState<string | number | null>(null);
  const lightboxVideoRef = useRef<HTMLVideoElement | null>(null);
  const lightboxAssetIds = useMemo(
    () =>
      jobs.flatMap((job) => {
        const asset = batchAssetForJob(job, assets);
        return asset && lightboxVisual(asset) ? [asset.asset_id] : [];
      }),
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
  const firstOutputId = lightboxAssetIds[0];
  const batchStatusTone = batch.status === "partial_failure" ? "warning" : toneForStatus(batch.status);

  return (
    <>
      <details className="admin-data-row admin-job-row">
        <summary className="admin-data-summary admin-jobs-columns">
          <div className="admin-job-identity">
            <span className="admin-job-thumbnail">
              {previewThumbUrl(assets[0] ?? null)
                ? <img src={previewThumbUrl(assets[0])!} alt="" loading="lazy" />
                : <Clapperboard className="size-5" />}
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{batch.prompt_summary || "Generation batch"}</h3>
              <div className="admin-data-meta">{formatDateTime(batch.created_at)}</div>
            </div>
            <ChevronDown className="admin-job-mobile-chevron size-3.5" aria-hidden="true" />
          </div>
          <span className="admin-data-model">{modelLabel || batch.model_key || "Unknown model"}</span>
          <StatusPill label={batchStatusLabel(batch.status)} tone={batchStatusTone} />
          <span className="admin-job-output-count">{jobs.filter((job) => batchAssetForJob(job, assets)).length} / {batch.requested_outputs}<span className="admin-job-mobile-label"> outputs</span></span>
          <span className="admin-job-estimate">{formatUsdAmount(pricingSummary?.totalUsd) ?? "n/a"}<span className="admin-job-mobile-label"> estimated</span></span>
          <span className="admin-job-disclosure-action"><span>View outputs</span><ChevronDown aria-hidden="true" className="size-3.5" /></span>
        </summary>
        <div className="admin-data-body">
          <div className="admin-job-expanded">
            <div className="admin-job-output-grid" aria-label="Batch outputs">
              {jobs.map((job, index) => {
                const asset = batchAssetForJob(job, assets);
                const childPreview = previewThumbUrl(asset);
                const canOpenLightbox = Boolean(asset && lightboxVisual(asset));
                // Stored batch indices start at zero; output labels start at one.
                const outputNumber = (job.batch_index ?? index) + 1;
                const kind = asset?.generation_kind === "video" ? "Video" : asset?.generation_kind === "audio" ? "Audio" : "Image";
                return <figure key={job.job_id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => { if (asset) setLightboxAssetId(asset.asset_id); }}
                    disabled={!canOpenLightbox}
                    className="surface-preview-frame admin-job-output-preview"
                    title={canOpenLightbox ? `Open output ${outputNumber}` : `Output ${outputNumber}`}
                    aria-label={canOpenLightbox ? `Open output ${outputNumber}` : `Output ${outputNumber}: ${job.error ? "Failed" : "No preview available"}`}
                  >
                    {childPreview ? <img src={childPreview} alt={`Output ${outputNumber}`} loading="lazy" decoding="async" /> : <span className="admin-job-output-placeholder">
                      {asset?.generation_kind === "audio" ? <Music2 className="size-7" /> : <Clapperboard className="size-7" />}
                      {job.error ? "Output failed" : canOpenLightbox ? `Open ${kind.toLowerCase()}` : "No preview available"}
                    </span>}
                    {canOpenLightbox && asset?.generation_kind === "video" ? <span className="admin-job-video-mark"><Play className="size-5" aria-hidden="true" /></span> : null}
                  </button>
                  <figcaption className="admin-job-output-caption"><span>Output {outputNumber}{asset ? ` · ${kind}` : ""}</span>{canOpenLightbox ? <span>{kind === "Image" ? "Click to enlarge ↗" : `Open ${kind.toLowerCase()} ↗`}</span> : null}</figcaption>
                </figure>;
              })}
              {!jobs.length ? <p className="admin-job-output-placeholder">No outputs recorded for this batch.</p> : null}
            </div>
            <div className="admin-job-context">
              <div>
                <h4 className="admin-job-detail-label">Prompt summary</h4>
                <p className="admin-job-prompt">{batch.prompt_summary}</p>
              </div>
              {pricingSummary ? <dl className="admin-job-costs">
                <div><dt className="admin-job-detail-label">Estimated total</dt><dd>{formatUsdAmount(pricingSummary.totalUsd) ?? "n/a"}<span>{formatCreditsAmount(pricingSummary.totalCredits)} credits</span></dd></div>
                <div><dt className="admin-job-detail-label">Per output</dt><dd>{formatUsdAmount(pricingSummary.perOutputUsd) ?? "n/a"}<span>{formatCreditsAmount(pricingSummary.perOutputCredits)} credits</span></dd></div>
              </dl> : null}
              <div className="flex flex-wrap items-center gap-3">
                {firstOutputId != null ? <AdminButton size="compact" onClick={() => setLightboxAssetId(firstOutputId)}>{lightboxAssetIds.length > 1 ? "Open first output" : "Open output"}</AdminButton> : null}
                <MediaBatchActions batchId={batch.batch_id} canCancelQueued={batch.queued_count > 0 && (batch.status === "queued" || batch.status === "processing")} />
              </div>
            </div>
          </div>
          {jobs.some((job) => Boolean(job.error)) ? <div className="admin-job-errors">
            {jobs.filter((job) => Boolean(job.error)).map((job) => <CalloutPanel key={job.job_id} appearance="admin" tone="danger" className="px-3 py-3 text-sm">
              <h4 className="font-medium">Output {(job.batch_index ?? jobs.indexOf(job)) + 1} failed</h4>
              <p className="mt-1 whitespace-pre-wrap break-words">{job.error}</p>
              {job.updated_at ? <p className="mt-2 text-xs text-[var(--muted-strong)]">{formatDateTime(job.updated_at)}</p> : null}
            </CalloutPanel>)}
          </div> : null}
          <details className="admin-job-run-details">
            <summary>Run details<ChevronDown className="size-3.5" aria-hidden="true" /></summary>
            <dl className="admin-job-run-properties">
              <div><dt>Batch</dt><dd>{batch.batch_id}</dd></div>
              <div><dt>Model</dt><dd>{batch.model_key || "Unknown model"}</dd></div>
              <div><dt>Created</dt><dd>{formatDateTime(batch.created_at)}</dd></div>
              <div><dt>Progress</dt><dd>{batch.queued_count} queued · {batch.running_count} processing · {batch.failed_count} failed</dd></div>
              <div><dt>Requested outputs</dt><dd>{batch.requested_outputs}</dd></div>
            </dl>
            {pricingSummary ? <p className="admin-data-meta">Saved estimates may differ from the final provider charge.</p> : null}
          </details>
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
