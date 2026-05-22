import { useState } from "react";

import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

type UseStudioMediaDashboardActionsOptions = {
  selectedAssetId: string | number | null;
  selectedFailedJobId: string | null;
  sourceAssetId: string | number | null;
  setFormMessage: React.Dispatch<React.SetStateAction<ComposerStatusMessage | null>>;
  setLocalJobs: React.Dispatch<React.SetStateAction<MediaJob[]>>;
  setLocalBatches: React.Dispatch<React.SetStateAction<MediaBatch[]>>;
  setLocalAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
  setFavoriteAssets: React.Dispatch<React.SetStateAction<MediaAsset[] | null>>;
  setLocalLatestAsset: React.Dispatch<React.SetStateAction<MediaAsset | null>>;
  setSelectedAssetId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setSelectedFailedJobId: React.Dispatch<React.SetStateAction<string | null>>;
  setSourceAssetId: React.Dispatch<React.SetStateAction<string | number | null>>;
  applyFavoriteAssetUpdate: (updatedAsset: MediaAsset) => void;
  upsertBatch: (batch: MediaBatch) => void;
  pollJob: (jobId: string) => Promise<void>;
  pollBatch: (batchId: string) => Promise<void>;
  startRefresh: (callback: () => void) => void;
  refreshRoute: () => void;
};

function removeJobFromBatch(batch: MediaBatch, jobId: string): MediaBatch | null {
  const batchJobs = Array.isArray(batch.jobs) ? batch.jobs : [];
  if (!batchJobs.some((job) => job.job_id === jobId)) {
    return batch;
  }
  const nextJobs = batchJobs.filter((job) => job.job_id !== jobId);
  if (!nextJobs.length) {
    return null;
  }
  const queuedCount = nextJobs.filter((job) => job.status === "queued").length;
  const runningCount = nextJobs.filter((job) => ["submitted", "running", "processing"].includes(job.status)).length;
  const completedCount = nextJobs.filter((job) => job.status === "completed").length;
  const failedCount = nextJobs.filter((job) => job.status === "failed").length;
  const cancelledCount = nextJobs.filter((job) => job.status === "cancelled").length;
  const nextStatus =
    failedCount === nextJobs.length
      ? "failed"
      : completedCount === nextJobs.length
        ? "completed"
        : runningCount > 0
          ? "processing"
          : queuedCount > 0
            ? "queued"
            : batch.status;
  return {
    ...batch,
    status: nextStatus,
    jobs: nextJobs,
    queued_count: queuedCount,
    running_count: runningCount,
    completed_count: completedCount,
    failed_count: failedCount,
    cancelled_count: cancelledCount,
  };
}

export function useStudioMediaDashboardActions({
  selectedAssetId,
  selectedFailedJobId,
  sourceAssetId,
  setFormMessage,
  setLocalJobs,
  setLocalBatches,
  setLocalAssets,
  setFavoriteAssets,
  setLocalLatestAsset,
  setSelectedAssetId,
  setSelectedFailedJobId,
  setSourceAssetId,
  applyFavoriteAssetUpdate,
  upsertBatch,
  pollJob,
  pollBatch,
  startRefresh,
  refreshRoute,
}: UseStudioMediaDashboardActionsOptions) {
  const [favoriteAssetIdBusy, setFavoriteAssetIdBusy] = useState<string | number | null>(null);

  async function retryJob(jobId: string, setBusyState: (value: "idle" | "validate" | "submit") => void) {
    setFormMessage(null);
    setBusyState("submit");
    try {
      const response = await fetch(`/api/control/media-jobs/${jobId}`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: MediaJob | null; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok || !payload.job) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to retry the selected media job." });
        return;
      }
      setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 12));
      if (payload.batch) {
        upsertBatch(payload.batch as MediaBatch);
      }
      setFormMessage({ tone: "warning", text: "Retry queued through the Control API." });
      if (payload.batch?.batch_id) {
        void pollBatch(payload.batch.batch_id);
      } else {
        void pollJob(payload.job.job_id);
      }
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the retry route." });
    } finally {
      setBusyState("idle");
    }
  }

  async function dismissJob(jobId: string) {
    setFormMessage(null);
    try {
      const response = await fetch(`/api/control/media-jobs/${jobId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: MediaJob | null };
      if (!response.ok || !payload.ok) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to remove the selected media job from the dashboard." });
        return;
      }
      setLocalJobs((current) => current.filter((job) => job.job_id !== jobId));
      setLocalBatches((current) =>
        current.flatMap((batch) => {
          const updatedBatch = removeJobFromBatch(batch, jobId);
          return updatedBatch ? [updatedBatch] : [];
        }),
      );
      if (selectedFailedJobId === jobId) {
        setSelectedFailedJobId(null);
      }
      setFormMessage({ tone: "healthy", text: "Removed the failed media card from the dashboard." });
      startRefresh(refreshRoute);
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the media remove route." });
    }
  }

  async function dismissAsset(assetId: string | number) {
    setFormMessage(null);
    try {
      const response = await fetch(`/api/control/media-assets/${assetId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; asset?: MediaAsset | null };
      if (!response.ok || !payload.ok) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to remove the selected media asset from the dashboard." });
        return;
      }
      setLocalAssets((current) => {
        const nextAssets = current.filter((asset) => asset.asset_id !== assetId);
        setFavoriteAssets((currentFavorites) =>
          currentFavorites ? currentFavorites.filter((asset) => asset.asset_id !== assetId) : currentFavorites,
        );
        setLocalLatestAsset((currentLatest) => (currentLatest?.asset_id === assetId ? nextAssets[0] ?? null : currentLatest));
        return nextAssets;
      });
      if (selectedAssetId === assetId) {
        setSelectedAssetId(null);
      }
      if (sourceAssetId === assetId) {
        setSourceAssetId(null);
      }
      setFormMessage({ tone: "healthy", text: "Removed the media card from the dashboard." });
      startRefresh(refreshRoute);
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the media asset remove route." });
    }
  }

  async function toggleAssetFavorite(asset: MediaAsset | null) {
    if (!asset || favoriteAssetIdBusy != null) {
      return;
    }
    setFavoriteAssetIdBusy(asset.asset_id);
    setFormMessage(null);
    try {
      const response = await fetch(`/api/control/media-assets/${asset.asset_id}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ favorited: !asset.favorited }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; asset?: MediaAsset | null };
      if (!response.ok || !payload.ok || !payload.asset) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to update the favorite state for the selected media asset." });
        return;
      }
      applyFavoriteAssetUpdate(payload.asset);
      setFormMessage({
        tone: "healthy",
        text: payload.asset.favorited ? "Saved the media asset to favorites." : "Removed the media asset from favorites.",
      });
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the favorite route." });
    } finally {
      setFavoriteAssetIdBusy(null);
    }
  }

  return {
    favoriteAssetIdBusy,
    retryJob,
    dismissJob,
    dismissAsset,
    toggleAssetFavorite,
  };
}
