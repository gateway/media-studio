import { NextResponse } from "next/server";

import { deleteReferenceMedia, getReferenceMedia } from "@/lib/control-api";

export async function GET(_: Request, context: { params: Promise<{ referenceId: string }> }) {
  const { referenceId } = await context.params;
  const result = await getReferenceMedia(referenceId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to load the reference media item." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item: result.data.item });
}

export async function DELETE(_: Request, context: { params: Promise<{ referenceId: string }> }) {
  const { referenceId } = await context.params;
  const result = await deleteReferenceMedia(referenceId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to delete the reference media item." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item: result.data.item });
}
