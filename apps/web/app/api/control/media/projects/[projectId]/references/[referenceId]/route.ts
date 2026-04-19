import { NextResponse } from "next/server";

import { attachProjectReference, detachProjectReference } from "@/lib/control-api";

export async function POST(
  _: Request,
  context: { params: Promise<{ projectId: string; referenceId: string }> },
) {
  const { projectId, referenceId } = await context.params;
  const result = await attachProjectReference(projectId, referenceId);
  if (!result.ok || !result.data.item) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Unable to attach the reference to this project." },
      { status: 500 },
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
    return NextResponse.json(
      { ok: false, error: result.error ?? "Unable to remove the reference from this project." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, item: result.data.item });
}
