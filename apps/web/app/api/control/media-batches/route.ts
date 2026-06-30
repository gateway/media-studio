import { NextResponse } from "next/server";

import { controlErrorResponse } from "@/app/api/control/responses";
import { getControlApiJson } from "@/lib/control-api";
import type { MediaBatchesResponse } from "@/lib/types";
import { boundedIntegerParam } from "../pagination";

const MEDIA_BATCHES_MAX_LIMIT = 200;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const projectId = url.searchParams.get("project_id");
  if (rawLimit !== null) {
    params.set(
      "limit",
      String(boundedIntegerParam(rawLimit, 50, 1, MEDIA_BATCHES_MAX_LIMIT)),
    );
  }
  if (rawOffset !== null) {
    params.set(
      "offset",
      String(boundedIntegerParam(rawOffset, 0, 0, Number.MAX_SAFE_INTEGER)),
    );
  }
  if (projectId) {
    params.set("project_id", projectId);
  }
  const endpoint = params.size
    ? `/media/batches?${params.toString()}`
    : "/media/batches";
  const result = await getControlApiJson<MediaBatchesResponse>(
    endpoint,
    "read",
  );

  if (!result.ok || !result.data) {
    return controlErrorResponse(
      result.error,
      "Unable to load media batches from the Control API.",
      502,
    );
  }

  return NextResponse.json({
    ok: true,
    batches:
      (result.data as { items?: unknown[] }).items ?? result.data.batches ?? [],
    total:
      result.data.total ??
      (
        (result.data as { items?: unknown[] }).items ??
        result.data.batches ??
        []
      ).length,
    limit: result.data.limit ?? null,
    offset: result.data.offset ?? 0,
  });
}
