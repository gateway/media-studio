import type { MediaBatch, MediaJob } from "@/lib/types";

export function jobStatusLabel(status: string | null | undefined) {
  if (status === "queued") return "Queued";
  if (status === "submitted" || status === "running" || status === "processing") return "Running";
  if (status === "completed") return "Ready";
  return "Failed";
}

export function jobPhaseMessage(job: MediaJob | null | undefined) {
  if (!job) {
    return null;
  }
  const finalState = String((job.final_status as Record<string, unknown> | null | undefined)?.state ?? "").toLowerCase();
  if ((job.status === "running" || job.status === "processing") && finalState === "succeeded") {
    return "Final output received. Publishing it into Studio.";
  }
  if (job.status === "submitted" || job.status === "running" || job.status === "processing") {
    return "Waiting for the provider to finish the generation.";
  }
  if (job.status === "queued") {
    return "The job is queued and waiting for an open runner slot.";
  }
  return null;
}

export function batchPhaseMessage(batch: MediaBatch | null | undefined) {
  if (!batch) {
    return null;
  }
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
}

export function toneForStatus(status?: string | null) {
  if (status === "completed" || status === "succeeded") return "healthy";
  if (status === "failed") return "danger";
  if (status === "running" || status === "submitted") return "warning";
  return "neutral";
}
