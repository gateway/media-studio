import { useEffect, useRef } from "react";

import {
  isPollableJobStatus,
  isStudioPollingVisible,
  shouldWatchBatch,
  STUDIO_POLL_INTERVAL_MS,
} from "@/lib/studio-polling";
import type { MediaBatch, MediaJob } from "@/lib/types";

type StudioPollSchedulerOptions = {
  watchJobs: MediaJob[];
  watchBatches: MediaBatch[];
  onPollJob: (jobId: string) => void;
  onPollBatch: (batchId: string) => void;
};

export function useStudioPollScheduler({
  watchJobs,
  watchBatches,
  onPollJob,
  onPollBatch,
}: StudioPollSchedulerOptions) {
  const activeJobPollsRef = useRef<Set<string>>(new Set());
  const activeBatchPollsRef = useRef<Set<string>>(new Set());
  const inFlightJobPollsRef = useRef<Set<string>>(new Set());
  const inFlightBatchPollsRef = useRef<Set<string>>(new Set());
  const jobPollTimersRef = useRef<Map<string, number>>(new Map());
  const batchPollTimersRef = useRef<Map<string, number>>(new Map());
  const documentVisibleRef = useRef(isStudioPollingVisible(typeof document === "undefined" ? "visible" : document.visibilityState));
  const onPollJobRef = useRef(onPollJob);
  const onPollBatchRef = useRef(onPollBatch);

  onPollJobRef.current = onPollJob;
  onPollBatchRef.current = onPollBatch;

  function clearJobTimer(jobId: string) {
    const timer = jobPollTimersRef.current.get(jobId);
    if (timer != null) {
      window.clearTimeout(timer);
      jobPollTimersRef.current.delete(jobId);
    }
  }

  function clearBatchTimer(batchId: string) {
    const timer = batchPollTimersRef.current.get(batchId);
    if (timer != null) {
      window.clearTimeout(timer);
      batchPollTimersRef.current.delete(batchId);
    }
  }

  function scheduleJobPoll(jobId: string) {
    if (!documentVisibleRef.current || !activeJobPollsRef.current.has(jobId) || jobPollTimersRef.current.has(jobId)) {
      return;
    }
    const timer = window.setTimeout(() => {
      jobPollTimersRef.current.delete(jobId);
      onPollJobRef.current(jobId);
    }, STUDIO_POLL_INTERVAL_MS);
    jobPollTimersRef.current.set(jobId, timer);
  }

  function scheduleBatchPoll(batchId: string) {
    if (!documentVisibleRef.current || !activeBatchPollsRef.current.has(batchId) || batchPollTimersRef.current.has(batchId)) {
      return;
    }
    const timer = window.setTimeout(() => {
      batchPollTimersRef.current.delete(batchId);
      onPollBatchRef.current(batchId);
    }, STUDIO_POLL_INTERVAL_MS);
    batchPollTimersRef.current.set(batchId, timer);
  }

  function clearJobPoll(jobId: string) {
    activeJobPollsRef.current.delete(jobId);
    inFlightJobPollsRef.current.delete(jobId);
    clearJobTimer(jobId);
  }

  function clearBatchPoll(batchId: string) {
    activeBatchPollsRef.current.delete(batchId);
    inFlightBatchPollsRef.current.delete(batchId);
    clearBatchTimer(batchId);
  }

  function beginJobPoll(jobId: string) {
    activeJobPollsRef.current.add(jobId);
    clearJobTimer(jobId);
    if (inFlightJobPollsRef.current.has(jobId)) {
      return false;
    }
    inFlightJobPollsRef.current.add(jobId);
    return true;
  }

  function beginBatchPoll(batchId: string) {
    activeBatchPollsRef.current.add(batchId);
    clearBatchTimer(batchId);
    if (inFlightBatchPollsRef.current.has(batchId)) {
      return false;
    }
    inFlightBatchPollsRef.current.add(batchId);
    return true;
  }

  function finishJobPoll(jobId: string) {
    inFlightJobPollsRef.current.delete(jobId);
  }

  function finishBatchPoll(batchId: string) {
    inFlightBatchPollsRef.current.delete(batchId);
  }

  useEffect(() => {
    return () => {
      for (const timer of jobPollTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      jobPollTimersRef.current.clear();
      for (const timer of batchPollTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      batchPollTimersRef.current.clear();
      activeJobPollsRef.current.clear();
      activeBatchPollsRef.current.clear();
      inFlightJobPollsRef.current.clear();
      inFlightBatchPollsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      documentVisibleRef.current = isStudioPollingVisible(document.visibilityState);
      if (!documentVisibleRef.current) {
        for (const timer of jobPollTimersRef.current.values()) {
          window.clearTimeout(timer);
        }
        jobPollTimersRef.current.clear();
        for (const timer of batchPollTimersRef.current.values()) {
          window.clearTimeout(timer);
        }
        batchPollTimersRef.current.clear();
        return;
      }
      for (const jobId of activeJobPollsRef.current) {
        scheduleJobPoll(jobId);
      }
      for (const batchId of activeBatchPollsRef.current) {
        scheduleBatchPoll(batchId);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    for (const batch of watchBatches) {
      if (!shouldWatchBatch(batch)) {
        continue;
      }
      activeBatchPollsRef.current.add(batch.batch_id);
      scheduleBatchPoll(batch.batch_id);
    }
    for (const job of watchJobs) {
      if (job.batch_id || !isPollableJobStatus(job.status)) {
        continue;
      }
      activeJobPollsRef.current.add(job.job_id);
      scheduleJobPoll(job.job_id);
    }
  }, [watchBatches, watchJobs]);

  return {
    beginJobPoll,
    finishJobPoll,
    clearJobPoll,
    scheduleJobPoll,
    beginBatchPoll,
    finishBatchPoll,
    clearBatchPoll,
    scheduleBatchPoll,
    isDocumentVisible: () => documentVisibleRef.current,
  };
}
