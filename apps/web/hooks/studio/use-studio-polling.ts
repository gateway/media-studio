import { useState } from "react";

import { FLOATING_COMPOSER_STATUS_MS, type ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

type PublishHandoffKind = "job" | "batch";

export function resolvePublishHandoffFeedback(kind: PublishHandoffKind, publishedToGallery: boolean) {
  if (kind === "job") {
    return publishedToGallery
      ? {
          activity: { tone: "healthy" as const, message: "Media publish completed. The gallery is refreshing." },
          activityAutoHideMs: 2600,
          finalMessage: "Media job completed and the reel is refreshing.",
        }
      : {
          activity: {
            tone: "warning" as const,
            message: "The provider finished, but Studio is still waiting for the published media card.",
            spinning: true,
          },
          activityAutoHideMs: 4200,
          finalMessage: "Media job completed. Studio is still reconciling the published media card.",
        };
  }

  return publishedToGallery
    ? {
        activity: { tone: "healthy" as const, message: "Batch publish completed. The gallery is refreshing." },
        activityAutoHideMs: 2600,
        finalMessage: "Media batch completed and the reel is refreshing.",
      }
    : {
        activity: {
          tone: "warning" as const,
          message: "The provider finished, but Studio is still waiting for the published media cards.",
          spinning: true,
        },
        activityAutoHideMs: 4200,
        finalMessage: "Media batch completed. Studio is still reconciling the published media cards.",
      };
}

type UseStudioPollingParams = {
  showActivity: (payload: { tone: "healthy" | "warning" | "danger"; message: string; spinning?: boolean }, options?: { autoHideMs?: number }) => void;
  showFloatingComposerBanner: (message: ComposerStatusMessage, autoHideMs?: number) => void;
  setFormMessage: React.Dispatch<React.SetStateAction<ComposerStatusMessage | null>>;
  refreshStudioDataWithSettleDelay: () => void;
  refreshActiveGalleryAssets: (options?: { expectedJobIds?: string[]; silent?: boolean; attempts?: number }) => Promise<boolean>;
  setLocalJobs: React.Dispatch<React.SetStateAction<MediaJob[]>>;
  upsertBatch: (batch: MediaBatch) => void;
  setLocalAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
  setFavoriteAssets: React.Dispatch<React.SetStateAction<MediaAsset[] | null>>;
  setLocalLatestAsset: React.Dispatch<React.SetStateAction<MediaAsset | null>>;
  applyFavoriteAssetUpdate: (updatedAsset: MediaAsset) => void;
  setLocalBatches: React.Dispatch<React.SetStateAction<MediaBatch[]>>;
  selectedAssetId: string | number | null;
  selectedFailedJobId: string | null;
  sourceAssetId: string | number | null;
  setSelectedAssetId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setSelectedFailedJobId: React.Dispatch<React.SetStateAction<string | null>>;
  setSourceAssetId: React.Dispatch<React.SetStateAction<string | number | null>>;
  startRefresh: (callback: () => void) => void;
  refreshRoute: () => void;
};

type UseStudioPollingResult = {
  state: {
    favoriteAssetIdBusy: string | number | null;
  };
  actions: {
    pollJob: (jobId: string) => Promise<void>;
    pollBatch: (batchId: string) => Promise<void>;
    retryJob: (jobId: string, setBusyState: (value: "idle" | "validate" | "submit") => void) => Promise<void>;
    dismissJob: (jobId: string) => Promise<void>;
    dismissAsset: (assetId: string | number) => Promise<void>;
    toggleAssetFavorite: (asset: MediaAsset | null) => Promise<void>;
  };
};

export function useStudioPolling({
  showActivity,
  showFloatingComposerBanner,
  setFormMessage,
  refreshStudioDataWithSettleDelay,
  refreshActiveGalleryAssets,
  setLocalJobs,
  upsertBatch,
  setLocalAssets,
  setFavoriteAssets,
  setLocalLatestAsset,
  applyFavoriteAssetUpdate,
  setLocalBatches,
  selectedAssetId,
  selectedFailedJobId,
  sourceAssetId,
  setSelectedAssetId,
  setSelectedFailedJobId,
  setSourceAssetId,
  startRefresh,
  refreshRoute,
}: UseStudioPollingParams): UseStudioPollingResult {
  const [favoriteAssetIdBusy, setFavoriteAssetIdBusy] = useState<string | number | null>(null);

  async function pollJob(jobId: string) {
    try {
      const response = await fetch(`/api/control/media-jobs/${jobId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: MediaJob; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok || !payload.job) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to read the current media job state." });
        showFloatingComposerBanner({ tone: "danger", text: payload.error ?? "Unable to read the current media job state." }, 5200);
        return;
      }

      setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 12));
      if (payload.batch) {
        upsertBatch(payload.batch as MediaBatch);
      }

      const inFlightMessage = (() => {
        const finalState = String((payload.job?.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
        if ((payload.job?.status === "running" || payload.job?.status === "processing") && finalState === "succeeded") {
          return "Final output received. Publishing it into Studio.";
        }
        if (payload.job?.status === "submitted" || payload.job?.status === "running" || payload.job?.status === "processing") {
          return "Waiting for the provider to finish the generation.";
        }
        if (payload.job?.status === "queued") {
          return "The job is queued and waiting for an open runner slot.";
        }
        return null;
      })();
      if (inFlightMessage) {
        setFormMessage({ tone: "warning", text: inFlightMessage });
      }

      if (payload.job.status === "completed" || payload.job.status === "failed") {
        let publishedToGallery = true;
        if (payload.job.status === "completed") {
          publishedToGallery = await refreshActiveGalleryAssets({
            expectedJobIds: [payload.job.job_id],
            silent: true,
            attempts: 5,
          });
          const feedback = resolvePublishHandoffFeedback("job", publishedToGallery);
          showActivity(feedback.activity, { autoHideMs: feedback.activityAutoHideMs });
        }
        refreshStudioDataWithSettleDelay();
        const finalMessage =
          payload.job.status === "completed"
            ? resolvePublishHandoffFeedback("job", publishedToGallery).finalMessage
            : payload.job.error ?? "Media job failed.";
        setFormMessage({ tone: payload.job.status === "completed" ? "healthy" : "danger", text: finalMessage });
        showFloatingComposerBanner(
          { tone: payload.job.status === "completed" ? "healthy" : "danger", text: finalMessage },
          payload.job.status === "completed" ? FLOATING_COMPOSER_STATUS_MS : 5600,
        );
        return;
      }

      window.setTimeout(() => {
        void pollJob(jobId);
      }, 1800);
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard lost contact with the media job poller." });
      showFloatingComposerBanner({ tone: "danger", text: "The dashboard lost contact with the media job poller." }, 5600);
    }
  }

  async function pollBatch(batchId: string) {
    try {
      const response = await fetch(`/api/control/media-batches/${batchId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok || !payload.batch) {
        setFormMessage({ tone: "danger", text: payload.error ?? "Unable to read the current media batch state." });
        showFloatingComposerBanner({ tone: "danger", text: payload.error ?? "Unable to read the current media batch state." }, 5200);
        return;
      }

      const batch = payload.batch as MediaBatch;
      upsertBatch(batch);
      if (Array.isArray(batch.jobs) && batch.jobs.length) {
        setLocalJobs((current) => {
          const byId = new Map(current.map((job) => [job.job_id, job]));
          for (const job of batch.jobs ?? []) {
            byId.set(job.job_id, job);
          }
          return Array.from(byId.values()).sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 24);
        });
      }

      const inFlightMessage = (() => {
        const publishingJob = (batch.jobs ?? []).find((job) => {
          const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
          return (job.status === "running" || job.status === "processing") && finalState === "succeeded";
        });
        if (publishingJob) {
          return "Final output received. Publishing it into Studio.";
        }
        if (batch.running_count > 0) {
          return "Studio is polling the provider for this batch right now.";
        }
        if (batch.queued_count > 0) {
          return "This batch is queued and waiting for runner capacity.";
        }
        return null;
      })();
      if (inFlightMessage) {
        setFormMessage({ tone: "warning", text: inFlightMessage });
      }

      if (["completed", "failed", "partial_failure", "cancelled"].includes(payload.batch.status)) {
        const successfulJobIds = (batch.jobs ?? [])
          .filter((job) => {
            const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
            return finalState === "succeeded" || job.status === "completed";
          })
          .map((job) => job.job_id);
        let publishedToGallery = true;
        if (successfulJobIds.length > 0) {
          publishedToGallery = await refreshActiveGalleryAssets({
            expectedJobIds: successfulJobIds,
            silent: true,
            attempts: 5,
          });
          const feedback = resolvePublishHandoffFeedback("batch", publishedToGallery);
          showActivity(feedback.activity, { autoHideMs: feedback.activityAutoHideMs });
        }
        const failedJob = (batch.jobs ?? []).find((job) => job.status === "failed" && job.error);
        const batchFailureMessage =
          failedJob?.error ??
          (payload.batch.status === "cancelled" ? "Media batch was cancelled." : "Media batch finished with issues.");
        refreshStudioDataWithSettleDelay();
        const finalMessage =
          payload.batch.status === "completed"
            ? resolvePublishHandoffFeedback("batch", publishedToGallery).finalMessage
            : batchFailureMessage;
        setFormMessage({ tone: payload.batch.status === "completed" ? "healthy" : "danger", text: finalMessage });
        showFloatingComposerBanner(
          { tone: payload.batch.status === "completed" ? "healthy" : "danger", text: finalMessage },
          payload.batch.status === "completed" ? FLOATING_COMPOSER_STATUS_MS : 5600,
        );
        return;
      }

      window.setTimeout(() => {
        void pollBatch(batchId);
      }, 1800);
    } catch {
      setFormMessage({ tone: "danger", text: "The dashboard lost contact with the media queue watcher." });
      showFloatingComposerBanner({ tone: "danger", text: "The dashboard lost contact with the media queue watcher." }, 5600);
    }
  }

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
          const batchJobs = Array.isArray(batch.jobs) ? batch.jobs : [];
          if (!batchJobs.some((job) => job.job_id === jobId)) {
            return [batch];
          }
          const nextJobs = batchJobs.filter((job) => job.job_id !== jobId);
          if (!nextJobs.length) {
            return [];
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
          return [
            {
              ...batch,
              status: nextStatus,
              jobs: nextJobs,
              queued_count: queuedCount,
              running_count: runningCount,
              completed_count: completedCount,
              failed_count: failedCount,
              cancelled_count: cancelledCount,
            },
          ];
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
    state: {
      favoriteAssetIdBusy,
    },
    actions: {
      pollJob,
      pollBatch,
      retryJob,
      dismissJob,
      dismissAsset,
      toggleAssetFavorite,
    },
  };
}
