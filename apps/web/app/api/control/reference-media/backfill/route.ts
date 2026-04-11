import { NextResponse } from "next/server";

import { backfillReferenceMedia } from "@/lib/control-api";

export async function POST() {
  const result = await backfillReferenceMedia();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to scan existing uploads." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...result.data });
}
