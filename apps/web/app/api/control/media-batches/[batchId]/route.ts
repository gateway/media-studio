import { NextResponse } from "next/server";

import { getControlApiJson, getMediaBatch, postControlApiJson, sendControlApiJson, mapBatchRecord, mapJobRecord } from "@/lib/control-api";
import type { MediaBatchResponse } from "@/lib/types";

const ACTIVE_BATCH_JOB_STATUSES = new Set(["queued", "submitted", "running", "processing"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await context.params;
  const batchSnapshot = await getControlApiJson<Record<string, unknown>>(`/media/batches/${batchId}`, "read");
  if (!batchSnapshot.ok || !batchSnapshot.data) {
    return NextResponse.json(
      {
        ok: false,
        error: batchSnapshot.error ?? "Unable to read the current media batch state.",
      },
      { status: 502 },
    );
  }
  const activeJobs = Array.isArray(batchSnapshot.data?.jobs)
    ? (batchSnapshot.data.jobs as Record<string, unknown>[]).filter((job) => {
        const status = String(job.status ?? "").toLowerCase();
        return ACTIVE_BATCH_JOB_STATUSES.has(status);
      })
    : [];

  if (!activeJobs.length) {
    const jobs = (batchSnapshot.data.jobs as Record<string, unknown>[]).map(mapJobRecord);
    return NextResponse.json({
      ok: true,
      batch: mapBatchRecord(batchSnapshot.data, jobs),
    });
  }

  await Promise.all(
    activeJobs.map((job) =>
      postControlApiJson<Record<string, unknown>>(`/media/jobs/${String(job.job_id ?? "")}/poll`, { wait: false }, "admin").catch(
        () => null,
      ),
    ),
  );

  const result = await getMediaBatch(batchId);

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to read the current media batch state.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    batch: result.data.batch ?? null,
  });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await context.params;
  const result = await sendControlApiJson<Record<string, unknown>>(`/media/batches/${batchId}/cancel`, {
    method: "POST",
    payload: null,
    authMode: "admin",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to cancel queued media jobs for this batch.",
      },
      { status: 502 },
    );
  }

  const jobsResult = await getControlApiJson<{ items?: Record<string, unknown>[] }>("/media/jobs?limit=200", "read").catch(() => null);
  const jobs = Array.isArray(jobsResult?.data?.items) ? jobsResult?.data?.items.map(mapJobRecord) : [];
  const batch = mapBatchRecord(result.data, jobs);

  return NextResponse.json({
    ok: true,
    batch,
  } as MediaBatchResponse);
}
