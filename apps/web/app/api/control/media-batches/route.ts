import { NextResponse } from "next/server";

import { getControlApiJson } from "@/lib/control-api";
import type { MediaBatchesResponse } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const limit = url.searchParams.get("limit");
  if (limit) {
    params.set("limit", limit);
  }
  const endpoint = params.size ? `/media/batches?${params.toString()}` : "/media/batches";
  const result = await getControlApiJson<MediaBatchesResponse>(endpoint, "read");

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to load media batches from the Control API.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    batches: result.data.batches ?? [],
  });
}
