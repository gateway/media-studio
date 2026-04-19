import { NextRequest, NextResponse } from "next/server";

import { listReferenceMedia } from "@/lib/control-api";

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const projectId = request.nextUrl.searchParams.get("project_id");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
  const result = await listReferenceMedia({
    kind,
    projectId,
    limit: Number.isFinite(limit) ? limit : 100,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to load reference media." }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    items: result.data.items,
    limit: result.data.limit,
    offset: result.data.offset,
  });
}
