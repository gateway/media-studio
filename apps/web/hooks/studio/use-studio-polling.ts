import { useRef } from "react";

import { FLOATING_COMPOSER_STATUS_MS, type ComposerStatusMessage } from "@/lib/media-studio-contract";
import {
  completedBatchJobIds,
  isStudioPollingVisible,
  resolveBatchInFlightFeedback,
  resolveJobInFlightFeedback,
  resolvePublishHandoffFeedback,
  shouldWatchBatch,
  STUDIO_POLL_INTERVAL_MS,
} from "@/lib/studio-polling";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";
import { useStudioMediaDashboardActions } from "@/hooks/studio/use-studio-media-dashboard-actions";
import { useStudioPollScheduler } from "@/hooks/studio/use-studio-poll-scheduler";

export {
  completedBatchJobIds,
  isPollableJobStatus,
  isStudioPollingVisible,
  resolvePublishHandoffFeedback,
  shouldWatchBatch,
  STUDIO_POLL_INTERVAL_MS,
} from "@/lib/studio-polling";

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
  watchJobs?: MediaJob[];
  watchBatches?: MediaBatch[];
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
  watchJobs = [],
  watchBatches = [],
}: UseStudioPollingParams): UseStudioPollingResult {
  const lastJobFeedbackSignatureRef = useRef<Map<string, string>>(new Map());
  const lastBatchFeedbackSignatureRef = useRef<Map<string, string>>(new Map());
  const pollScheduler = useStudioPollScheduler({
    watchJobs,
    watchBatches,
    onPollJob: (jobId) => void pollJob(jobId),
    onPollBatch: (batchId) => void pollBatch(batchId),
  });

  async function pollJob(jobId: string) {
    if (!pollScheduler.beginJobPoll(jobId)) {
      return;
    }
    try {
      const response = await fetch(`/api/control/media-jobs/${jobId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: MediaJob; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok || !payload.job) {
        pollScheduler.clearJobPoll(jobId);
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
        pollScheduler.clearJobPoll(jobId);
        return;
      }
    } catch {
      pollScheduler.clearJobPoll(jobId);
      setFormMessage({ tone: "danger", text: "The dashboard lost contact with the media job poller." });
      showFloatingComposerBanner({ tone: "danger", text: "The dashboard lost contact with the media job poller." }, 5600);
      return;
    } finally {
      pollScheduler.finishJobPoll(jobId);
    }
    if (!pollScheduler.isDocumentVisible()) {
      return;
    }
    pollScheduler.scheduleJobPoll(jobId);
  }

  async function pollBatch(batchId: string) {
    if (!pollScheduler.beginBatchPoll(batchId)) {
      return;
    }
    try {
      const response = await fetch(`/api/control/media-batches/${batchId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok || !payload.batch) {
        pollScheduler.clearBatchPoll(batchId);
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
        pollScheduler.clearBatchPoll(batchId);
        return;
      }
    } catch {
      pollScheduler.clearBatchPoll(batchId);
      setFormMessage({ tone: "danger", text: "The dashboard lost contact with the media queue watcher." });
      showFloatingComposerBanner({ tone: "danger", text: "The dashboard lost contact with the media queue watcher." }, 5600);
      return;
    } finally {
      pollScheduler.finishBatchPoll(batchId);
    }
    if (!pollScheduler.isDocumentVisible()) {
      return;
    }
    pollScheduler.scheduleBatchPoll(batchId);
  }

  const mediaActions = useStudioMediaDashboardActions({
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
  });

  return {
    state: {
      favoriteAssetIdBusy: mediaActions.favoriteAssetIdBusy,
    },
    actions: {
      pollJob,
      pollBatch,
      retryJob: mediaActions.retryJob,
      dismissJob: mediaActions.dismissJob,
      dismissAsset: mediaActions.dismissAsset,
      toggleAssetFavorite: mediaActions.toggleAssetFavorite,
    },
  };
}
