import { NextResponse } from "next/server";

import { controlErrorResponse } from "@/app/api/control/responses";
import {
  attachProjectReference,
  detachProjectReference,
} from "@/lib/control-api";

export async function POST(
  _: Request,
  context: { params: Promise<{ projectId: string; referenceId: string }> },
) {
  const { projectId, referenceId } = await context.params;
  const result = await attachProjectReference(projectId, referenceId);
  if (!result.ok || !result.data.item) {
    return controlErrorResponse(
      result.error,
      "Unable to attach the reference to this project.",
      500,
    );
  }
  return NextResponse.json({ ok: true, item: result.data.item });
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ projectId: string; referenceId: string }> },
) {
  const { projectId, referenceId } = await context.params;
  const result = await detachProjectReference(projectId, referenceId);
  if (!result.ok || !result.data.item) {
    return controlErrorResponse(
      result.error,
      "Unable to remove the reference from this project.",
      500,
    );
  }
  return NextResponse.json({ ok: true, item: result.data.item });
}
