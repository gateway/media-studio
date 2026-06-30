import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();
const postControlApiJson = vi.fn();
const sendControlApiJson = vi.fn();

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  postControlApiJson,
  sendControlApiJson,
  mapBatchRecord: (batch: Record<string, unknown>) => batch,
  mapJobRecord: (job: Record<string, unknown>) => job,
}));

describe("control media-jobs route", () => {
  beforeEach(() => {
    getControlApiJson.mockReset();
    postControlApiJson.mockReset();
    sendControlApiJson.mockReset();
  });

  it("returns completed jobs without re-polling them", async () => {
    getControlApiJson
      .mockResolvedValueOnce({
        ok: true,
        data: {
          job_id: "job-completed",
          batch_id: "batch-1",
          status: "completed",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          batch_id: "batch-1",
          status: "completed",
        },
      });

    const { GET } = await import("@/app/api/control/media-jobs/[jobId]/route");
    const response = await GET(new Request("http://localhost/api/control/media-jobs/job-completed"), {
      params: Promise.resolve({ jobId: "job-completed" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(postControlApiJson).not.toHaveBeenCalled();
    expect(payload).toEqual({
      ok: true,
      job: {
        job_id: "job-completed",
        batch_id: "batch-1",
        status: "completed",
      },
      batch: {
        batch_id: "batch-1",
        status: "completed",
      },
    });
  });

  it("actively polls running jobs before returning the refreshed state", async () => {
    getControlApiJson
      .mockResolvedValueOnce({
        ok: true,
        data: {
          job_id: "job-running",
          batch_id: "batch-2",
          status: "running",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          batch_id: "batch-2",
          status: "completed",
        },
      });
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        job_id: "job-running",
        batch_id: "batch-2",
        status: "completed",
      },
    });

    const { GET } = await import("@/app/api/control/media-jobs/[jobId]/route");
    const response = await GET(new Request("http://localhost/api/control/media-jobs/job-running"), {
      params: Promise.resolve({ jobId: "job-running" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(postControlApiJson).toHaveBeenCalledTimes(1);
    expect(postControlApiJson).toHaveBeenCalledWith("/media/jobs/job-running/poll", { wait: false }, "admin");
    expect(payload).toEqual({
      ok: true,
      job: {
        job_id: "job-running",
        batch_id: "batch-2",
        status: "completed",
      },
      batch: {
        batch_id: "batch-2",
        status: "completed",
      },
    });
  });

  it("preserves the fallback error envelope when the current job cannot load", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
    });

    const { GET } = await import("@/app/api/control/media-jobs/[jobId]/route");
    const response = await GET(new Request("http://localhost/api/control/media-jobs/job-missing"), {
      params: Promise.resolve({ jobId: "job-missing" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      ok: false,
      error: "Unable to read the current media job state.",
    });
    expect(postControlApiJson).not.toHaveBeenCalled();
  });

  it("preserves upstream poll error messages for running jobs", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        job_id: "job-running",
        status: "processing",
      },
    });
    postControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "Provider timeout while polling.",
    });

    const { GET } = await import("@/app/api/control/media-jobs/[jobId]/route");
    const response = await GET(new Request("http://localhost/api/control/media-jobs/job-running"), {
      params: Promise.resolve({ jobId: "job-running" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      ok: false,
      error: "Provider timeout while polling.",
    });
    expect(postControlApiJson).toHaveBeenCalledWith("/media/jobs/job-running/poll", { wait: false }, "admin");
  });

  it("preserves the retry error envelope", async () => {
    postControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
    });

    const { POST } = await import("@/app/api/control/media-jobs/[jobId]/route");
    const response = await POST(new Request("http://localhost/api/control/media-jobs/job-failed"), {
      params: Promise.resolve({ jobId: "job-failed" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      ok: false,
      error: "Unable to retry the selected media job.",
    });
    expect(postControlApiJson).toHaveBeenCalledWith("/media/jobs/job-failed/retry", {}, "admin");
  });

  it("preserves the dismiss error envelope", async () => {
    sendControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "Dismiss failed.",
    });

    const { DELETE } = await import("@/app/api/control/media-jobs/[jobId]/route");
    const response = await DELETE(new Request("http://localhost/api/control/media-jobs/job-failed"), {
      params: Promise.resolve({ jobId: "job-failed" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      ok: false,
      error: "Dismiss failed.",
    });
    expect(sendControlApiJson).toHaveBeenCalledWith("/media/jobs/job-failed/dismiss", {
      method: "POST",
      authMode: "admin",
    });
  });
});
