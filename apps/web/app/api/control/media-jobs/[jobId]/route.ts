import { NextResponse } from "next/server";

import { getControlApiJson, postControlApiJson, sendControlApiJson, mapBatchRecord, mapJobRecord } from "@/lib/control-api";
import type { MediaJobResponse } from "@/lib/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const result = await postControlApiJson<MediaJobResponse>(
    `/media/jobs/${jobId}/poll`,
    { wait: false },
    "admin",
  );

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to read the current media job state.",
      },
      { status: 502 },
    );
  }

  const job = mapJobRecord(result.data as unknown as Record<string, unknown>);
  let batch = null;
  if (job.batch_id) {
    const batchResult = await getControlApiJson<Record<string, unknown>>(`/media/batches/${job.batch_id}`, "read");
    if (batchResult.ok && batchResult.data) {
      batch = mapBatchRecord(batchResult.data, [job]);
    }
  }

  return NextResponse.json({
    ok: true,
    job,
    batch,
  } as MediaJobResponse);
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const result = await postControlApiJson<{ batch?: Record<string, unknown> | null; jobs?: Record<string, unknown>[] | null }>(
    `/media/jobs/${jobId}/retry`,
    {},
    "admin",
  );

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to retry the selected media job.",
      },
      { status: 502 },
    );
  }

  const jobs = Array.isArray(result.data.jobs) ? result.data.jobs.map(mapJobRecord) : [];
  const job = jobs[0] ?? null;
  const batch =
    result.data.batch && typeof result.data.batch === "object"
      ? mapBatchRecord(result.data.batch, jobs)
      : null;

  return NextResponse.json({
    ok: true,
    job,
    batch,
  } as MediaJobResponse);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const result = await sendControlApiJson<Record<string, unknown>>(
    `/media/jobs/${jobId}/dismiss`,
    {
      method: "POST",
      authMode: "admin",
    },
  );

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to remove the selected media job from the dashboard.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    job: mapJobRecord(result.data),
  } as MediaJobResponse);
}
