import { NextRequest, NextResponse } from "next/server";

import { controlErrorResponse } from "@/app/api/control/responses";
import { listProjectReferences } from "@/lib/control-api";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const kind = request.nextUrl.searchParams.get("kind");
  const result = await listProjectReferences(projectId, kind);
  if (!result.ok) {
    return controlErrorResponse(
      result.error,
      "Unable to load project references.",
      500,
    );
  }
  return NextResponse.json({
    ok: true,
    items: result.data.items,
    limit: result.data.limit,
    offset: result.data.offset,
  });
}
