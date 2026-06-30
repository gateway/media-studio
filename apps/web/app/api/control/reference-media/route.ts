import { NextRequest, NextResponse } from "next/server";

import { listReferenceMedia } from "@/lib/control-api";
import { boundedIntegerParam } from "../pagination";

const REFERENCE_MEDIA_MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const projectId = request.nextUrl.searchParams.get("project_id");
  const q = request.nextUrl.searchParams.get("q");
  const limit = boundedIntegerParam(
    request.nextUrl.searchParams.get("limit"),
    100,
    1,
    REFERENCE_MEDIA_MAX_LIMIT,
  );
  const offset = boundedIntegerParam(
    request.nextUrl.searchParams.get("offset"),
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const result = await listReferenceMedia({
    kind,
    projectId,
    limit,
    offset,
    ...(q?.trim() ? { q: q.trim() } : {}),
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Unable to load reference media." },
      { status: 500 },
    );
  }
  const items = result.data.items ?? [];
  const responseLimit = Number(result.data.limit ?? limit);
  const responseOffset = Number(result.data.offset ?? offset);
  return NextResponse.json({
    ok: true,
    items,
    limit: responseLimit,
    offset: responseOffset,
    next_offset:
      items.length >= responseLimit ? responseOffset + items.length : null,
  });
}
