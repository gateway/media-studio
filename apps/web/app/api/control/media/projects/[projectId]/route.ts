import { NextRequest, NextResponse } from "next/server";

import { controlErrorResponse } from "@/app/api/control/responses";
import { deleteMediaProject, updateMediaProject } from "@/lib/control-api";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await updateMediaProject(projectId, payload);
  if (!result.ok || !result.data.project) {
    return controlErrorResponse(
      result.error,
      "Unable to update the project.",
      500,
    );
  }
  return NextResponse.json({ ok: true, project: result.data.project });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const permanent = request.nextUrl.searchParams.get("permanent") === "true";
  const result = await deleteMediaProject(projectId, permanent);
  if (!result.ok) {
    return controlErrorResponse(
      result.error,
      "Unable to delete the project.",
      500,
    );
  }
  return NextResponse.json({ ok: true, project: result.data.project ?? null });
}
