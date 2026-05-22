import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { MediaBatch, MediaJob } from "@/lib/types";

type PublishHandoffKind = "job" | "batch";

export type StudioPollingInFlightFeedback = {
  signature: string;
  activity: { tone: "warning" | "healthy"; message: string; spinning?: boolean };
  activityAutoHideMs?: number;
  formMessage: ComposerStatusMessage;
};

export const STUDIO_POLL_INTERVAL_MS = 5000;

export function isPollableJobStatus(status: string | null | undefined) {
  return ["queued", "submitted", "running", "processing"].includes(String(status ?? "").toLowerCase());
}

export function isStudioPollingVisible(visibilityState?: string | null) {
  return String(visibilityState ?? "visible").toLowerCase() === "visible";
}

export function shouldWatchBatch(batch: MediaBatch) {
  if (!batch.batch_id || ["completed", "failed", "partial_failure", "cancelled"].includes(String(batch.status ?? "").toLowerCase())) {
    return false;
  }
  if (batch.queued_count > 0 || batch.running_count > 0) {
    return true;
  }
  return (batch.jobs ?? []).some((job) => isPollableJobStatus(job.status));
}

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

export function resolveJobInFlightFeedback(job: MediaJob): StudioPollingInFlightFeedback | null {
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

export function resolveBatchInFlightFeedback(batch: MediaBatch): StudioPollingInFlightFeedback | null {
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
