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
});
