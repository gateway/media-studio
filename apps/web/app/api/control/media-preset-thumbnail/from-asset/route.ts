import { NextResponse } from "next/server";

import { createPresetThumbnailFromAsset } from "@/lib/preset-thumbnail-from-asset";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as {
    asset_id?: string | number | null;
    presetLabel?: string | null;
  } | null;
  const result = await createPresetThumbnailFromAsset(
    String(payload?.asset_id ?? "").trim(),
    String(payload?.presetLabel ?? "").trim(),
  );
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
