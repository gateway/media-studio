import { NextResponse } from "next/server";

import { postControlApiJson, mapBatchRecord, mapJobRecord, mapValidationResponseRecord } from "@/lib/control-api";
import type { MediaBatch, MediaJobResponse, MediaValidationResponse } from "@/lib/types";

import { buildMediaPayloadFromFormData, triggerDashboardIndexRefresh } from "./shared";

export async function POST(request: Request) {
  const formData = await request.formData();
  const { intent, payload, modelKey } = await buildMediaPayloadFromFormData(formData);

  if (!modelKey) {
    return NextResponse.json({ ok: false, error: "Choose a model before validating or generating." }, { status: 400 });
  }

  if (intent === "submit") {
    const result = await postControlApiJson<{ batch?: Record<string, unknown> | null; jobs?: Record<string, unknown>[] | null }>(
      "/media/jobs",
      payload,
      "admin",
    );

    if (!result.ok || !result.data) {
      return NextResponse.json({ ok: false, error: result.error ?? "Media request failed." }, { status: 502 });
    }

    const jobs = Array.isArray(result.data.jobs) ? result.data.jobs.map(mapJobRecord) : [];
    const batch =
      result.data.batch && typeof result.data.batch === "object"
        ? mapBatchRecord(result.data.batch, jobs)
        : null;
    const job = jobs[0] ?? null;

    triggerDashboardIndexRefresh();
    return NextResponse.json({
      ok: true,
      success: "Media job queued.",
      jobId: job?.job_id ?? null,
      batchId: batch?.batch_id ?? null,
      job,
      batch: batch as MediaBatch | null,
    });
  }

  const result = await postControlApiJson<Record<string, unknown>>("/media/validate", payload, "read");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Media request failed." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    success: "Media request validated.",
    validation: mapValidationResponseRecord(result.data),
  });
}
