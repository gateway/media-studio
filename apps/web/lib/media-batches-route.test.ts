import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();
const getMediaBatch = vi.fn();
const postControlApiJson = vi.fn();
const sendControlApiJson = vi.fn();

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  getMediaBatch,
  postControlApiJson,
  sendControlApiJson,
  mapBatchRecord: (batch: Record<string, unknown>) => batch,
  mapJobRecord: (job: Record<string, unknown>) => job,
}));

describe("control media-batches route", () => {
  beforeEach(() => {
    getControlApiJson.mockReset();
    getMediaBatch.mockReset();
    postControlApiJson.mockReset();
    sendControlApiJson.mockReset();
  });

  it("actively polls running batch jobs before returning the refreshed batch", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        batch_id: "batch-1",
        jobs: [
          { job_id: "job-running", status: "running" },
          { job_id: "job-queued", status: "queued" },
          { job_id: "job-completed", status: "completed" },
        ],
      },
    });
    postControlApiJson.mockResolvedValue({
      ok: true,
      data: { job_id: "job-running", status: "completed" },
    });
    getMediaBatch.mockResolvedValueOnce({
      ok: true,
      data: {
        batch: {
          batch_id: "batch-1",
          status: "completed",
          jobs: [{ job_id: "job-running", status: "completed" }],
        },
      },
    });

    const { GET } =
      await import("@/app/api/control/media-batches/[batchId]/route");
    const response = await GET(
      new Request("http://localhost/api/control/media-batches/batch-1"),
      {
        params: Promise.resolve({ batchId: "batch-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(postControlApiJson).toHaveBeenCalledTimes(2);
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/media/jobs/job-running/poll",
      { wait: false },
      "admin",
    );
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/media/jobs/job-queued/poll",
      { wait: false },
      "admin",
    );
    expect(getMediaBatch).toHaveBeenCalledWith("batch-1");
    expect(payload).toEqual({
      ok: true,
      batch: {
        batch_id: "batch-1",
        status: "completed",
        jobs: [{ job_id: "job-running", status: "completed" }],
      },
    });
  });

  it("bounds list pagination without changing the response envelope", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [{ batch_id: "batch-1" }],
        total: 1,
        limit: 200,
        offset: 0,
      },
    });

    const { GET } = await import("@/app/api/control/media-batches/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-batches?limit=999999&offset=-25",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/batches?limit=200&offset=0",
      "read",
    );
    expect(payload).toEqual({
      ok: true,
      batches: [{ batch_id: "batch-1" }],
      total: 1,
      limit: 200,
      offset: 0,
    });
  });

  it("preserves the no-query media batches endpoint and shared error shape", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "Batch backend unavailable.",
    });

    const { GET } = await import("@/app/api/control/media-batches/route");
    const response = await GET(
      new Request("http://localhost/api/control/media-batches"),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(getControlApiJson).toHaveBeenCalledWith("/media/batches", "read");
    expect(payload).toEqual({
      ok: false,
      error: "Batch backend unavailable.",
    });
  });

  it("returns the batch directly when there are no active jobs to poll", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        batch_id: "batch-2",
        jobs: [{ job_id: "job-completed", status: "completed" }],
      },
    });
    getMediaBatch.mockResolvedValueOnce({
      ok: true,
      data: {
        batch: {
          batch_id: "batch-2",
          status: "completed",
          jobs: [{ job_id: "job-completed", status: "completed" }],
        },
      },
    });

    const { GET } =
      await import("@/app/api/control/media-batches/[batchId]/route");
    const response = await GET(
      new Request("http://localhost/api/control/media-batches/batch-2"),
      {
        params: Promise.resolve({ batchId: "batch-2" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(postControlApiJson).not.toHaveBeenCalled();
    expect(payload.ok).toBe(true);
    expect(payload.batch.batch_id).toBe("batch-2");
  });
});
