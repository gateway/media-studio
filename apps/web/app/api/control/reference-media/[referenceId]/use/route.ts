import { NextResponse } from "next/server";

import { markReferenceMediaUsed } from "@/lib/control-api";

export async function POST(_: Request, context: { params: Promise<{ referenceId: string }> }) {
  const { referenceId } = await context.params;
  const result = await markReferenceMediaUsed(referenceId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to mark the reference media item as used." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, item: result.data.item });
}
