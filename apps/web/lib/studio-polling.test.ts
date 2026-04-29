import { describe, expect, it } from "vitest";

import {
  completedBatchJobIds,
  isPollableJobStatus,
  resolvePublishHandoffFeedback,
  shouldWatchBatch,
  STUDIO_POLL_INTERVAL_MS,
} from "@/hooks/studio/use-studio-polling";

describe("studio polling cadence", () => {
  it("uses the slower five-second poll interval", () => {
    expect(STUDIO_POLL_INTERVAL_MS).toBe(5000);
  });
});

describe("resolvePublishHandoffFeedback", () => {
  it("returns healthy job publish messaging when the asset is already in the gallery", () => {
    const feedback = resolvePublishHandoffFeedback("job", true);

    expect(feedback.activity).toEqual({
      tone: "healthy",
      message: "Render published. The gallery is refreshing.",
    });
    expect(feedback.activityAutoHideMs).toBe(2600);
    expect(feedback.finalMessage).toBe("Render completed and the gallery is refreshing.");
  });

  it("returns warning batch publish messaging when the gallery is still reconciling", () => {
    const feedback = resolvePublishHandoffFeedback("batch", false);

    expect(feedback.activity).toEqual({
      tone: "warning",
      message: "Batch finished, but Studio is still waiting for the media cards to appear.",
      spinning: true,
    });
    expect(feedback.activityAutoHideMs).toBe(4200);
    expect(feedback.finalMessage).toBe("Batch completed. Studio is still waiting for the media cards to appear.");
  });
});

describe("completedBatchJobIds", () => {
  it("returns completed job ids even while the overall batch is still processing", () => {
    expect(
      completedBatchJobIds({
        batch_id: "batch-1",
        status: "processing",
        jobs: [
          { job_id: "job-1", status: "completed" },
          { job_id: "job-2", status: "running", final_status: { state: "succeeded" } },
          { job_id: "job-3", status: "running" },
        ],
      } as never),
    ).toEqual(["job-1", "job-2"]);
  });
});

describe("poll watcher classification", () => {
  it("treats queued, submitted, running, and processing jobs as pollable", () => {
    expect(["queued", "submitted", "running", "processing"].map(isPollableJobStatus)).toEqual([true, true, true, true]);
    expect(isPollableJobStatus("failed")).toBe(false);
    expect(isPollableJobStatus("completed")).toBe(false);
  });

  it("watches hydrated open batches but skips terminal batches", () => {
    expect(
      shouldWatchBatch({
        batch_id: "batch-open",
        status: "processing",
        queued_count: 1,
        running_count: 0,
        jobs: [{ job_id: "job-queued", status: "queued" }],
      } as never),
    ).toBe(true);
    expect(
      shouldWatchBatch({
        batch_id: "batch-failed",
        status: "failed",
        queued_count: 0,
        running_count: 0,
        jobs: [{ job_id: "job-failed", status: "failed" }],
      } as never),
    ).toBe(false);
  });
});
