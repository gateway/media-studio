import { useRef, useState } from "react";

import { FLOATING_COMPOSER_STATUS_MS, type ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

type PublishHandoffKind = "job" | "batch";

type InFlightFeedback = {
  signature: string;
  activity: { tone: "warning" | "healthy"; message: string; spinning?: boolean };
  activityAutoHideMs?: number;
  formMessage: ComposerStatusMessage;
};

export const STUDIO_POLL_INTERVAL_MS = 5000;

export function completedBatchJobIds(batch: MediaBatch) {
  return (batch.jobs ?? [])
    .filter((job) => {
      const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
      return finalState === "succeeded" || job.status === "completed";
    })
    .map((job) => job.job_id);
}

export function resolvePublishHandoffFeedback(kind: PublishHandoffKind, publishedToGallery: boolean) {
  if (kind === "job") {
    return publishedToGallery
      ? {
          activity: { tone: "healthy" as const, message: "Render published. The gallery is refreshing." },
          activityAutoHideMs: 2600,
          finalMessage: "Render completed and the gallery is refreshing.",
        }
      : {
          activity: {
            tone: "warning" as const,
            message: "Render finished, but Studio is still waiting for the media card to appear.",
            spinning: true,
          },
          activityAutoHideMs: 4200,
          finalMessage: "Render completed. Studio is still waiting for the media card to appear.",
        };
  }

  return publishedToGallery
    ? {
        activity: { tone: "healthy" as const, message: "Batch published. The gallery is refreshing." },
        activityAutoHideMs: 2600,
        finalMessage: "Batch completed and the gallery is refreshing.",
      }
    : {
        activity: {
          tone: "warning" as const,
          message: "Batch finished, but Studio is still waiting for the media cards to appear.",
          spinning: true,
        },
        activityAutoHideMs: 4200,
        finalMessage: "Batch completed. Studio is still waiting for the media cards to appear.",
      };
}

function resolveJobInFlightFeedback(job: MediaJob): InFlightFeedback | null {
  const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
  if ((job.status === "running" || job.status === "processing") && finalState === "succeeded") {
    return {
      signature: `${job.job_id}:publishing`,
      activity: { tone: "warning", message: "Render finished. Studio is publishing it into the gallery.", spinning: true },
      activityAutoHideMs: 2600,
      formMessage: { tone: "warning", text: "Render finished. Studio is publishing it into the gallery." },
    };
  }
  if (job.status === "submitted" || job.status === "running" || job.status === "processing") {
    return {
      signature: `${job.job_id}:rendering`,
      activity: { tone: "warning", message: "Studio is waiting for the render to finish.", spinning: true },
      activityAutoHideMs: 2400,
      formMessage: { tone: "warning", text: "Studio is waiting for the render to finish." },
    };
  }
  if (job.status === "queued") {
    return {
      signature: `${job.job_id}:queued`,
      activity: { tone: "warning", message: "Your render is queued and will start as soon as a runner is free." },
      activityAutoHideMs: 2400,
      formMessage: { tone: "warning", text: "Your render is queued and will start as soon as a runner is free." },
    };
  }
  return null;
}

function resolveBatchInFlightFeedback(batch: MediaBatch): InFlightFeedback | null {
  const publishingJob = (batch.jobs ?? []).find((job) => {
    const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
    return (job.status === "running" || job.status === "processing") && finalState === "succeeded";
  });
  if (publishingJob) {
    return {
      signature: `${batch.batch_id}:publishing`,
      activity: { tone: "warning", message: "Render finished. Studio is publishing it into the gallery.", spinning: true },
      activityAutoHideMs: 2600,
      formMessage: { tone: "warning", text: "Render finished. Studio is publishing it into the gallery." },
    };
  }
  if (batch.running_count > 0) {
    return {
      signature: `${batch.batch_id}:rendering`,
      activity: { tone: "warning", message: "Studio is waiting for this batch to finish rendering.", spinning: true },
      activityAutoHideMs: 2400,
      formMessage: { tone: "warning", text: "Studio is waiting for this batch to finish rendering." },
    };
  }
  if (batch.queued_count > 0) {
    return {
      signature: `${batch.batch_id}:queued`,
      activity: { tone: "warning", message: "This batch is queued and will start as soon as a runner is free." },
      activityAutoHideMs: 2400,
      formMessage: { tone: "warning", text: "This batch is queued and will start as soon as a runner is free." },
    };
  }
  return null;
}

type UseStudioPollingParams = {
  showActivity: (payload: { tone: "healthy" | "warning" | "danger"; message: string; spinning?: boolean }, options?: { autoHideMs?: number }) => void;
  showFloatingComposerBanner: (message: ComposerStatusMessage, autoHideMs?: number) => void;
  setFormMessage: React.Dispatch<React.SetStateAction<ComposerStatusMessage | null>>;
  refreshStudioDataWithSettleDelay: () => void;
  refreshCreditBalance: () => Promise<void>;
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
  refreshCreditBalance,
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
  const lastJobFeedbackSignatureRef = useRef<Map<string, string>>(new Map());
  const lastBatchFeedbackSignatureRef = useRef<Map<string, string>>(new Map());

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

      const inFlightFeedback = resolveJobInFlightFeedback(payload.job);
      if (inFlightFeedback) {
        const previousSignature = lastJobFeedbackSignatureRef.current.get(payload.job.job_id);
        if (previousSignature !== inFlightFeedback.signature) {
          lastJobFeedbackSignatureRef.current.set(payload.job.job_id, inFlightFeedback.signature);
          setFormMessage(inFlightFeedback.formMessage);
          showActivity(inFlightFeedback.activity, { autoHideMs: inFlightFeedback.activityAutoHideMs });
        }
      }

      if (payload.job.status === "completed" || payload.job.status === "failed") {
        lastJobFeedbackSignatureRef.current.delete(payload.job.job_id);
        void refreshCreditBalance();
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
      }, STUDIO_POLL_INTERVAL_MS);
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

      const inFlightFeedback = resolveBatchInFlightFeedback(batch);
      if (inFlightFeedback) {
        const previousSignature = lastBatchFeedbackSignatureRef.current.get(batch.batch_id);
        if (previousSignature !== inFlightFeedback.signature) {
          lastBatchFeedbackSignatureRef.current.set(batch.batch_id, inFlightFeedback.signature);
          setFormMessage(inFlightFeedback.formMessage);
          showActivity(inFlightFeedback.activity, { autoHideMs: inFlightFeedback.activityAutoHideMs });
        }
      }

      const successfulJobIds = completedBatchJobIds(batch);
      if (!["completed", "failed", "partial_failure", "cancelled"].includes(batch.status) && successfulJobIds.length > 0) {
        await refreshActiveGalleryAssets({
          expectedJobIds: successfulJobIds,
          silent: true,
          attempts: 1,
        });
      }

      if (["completed", "failed", "partial_failure", "cancelled"].includes(payload.batch.status)) {
        lastBatchFeedbackSignatureRef.current.delete(batch.batch_id);
        void refreshCreditBalance();
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
      }, STUDIO_POLL_INTERVAL_MS);
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
