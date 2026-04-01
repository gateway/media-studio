import { NextResponse } from "next/server";

import { postControlApiJson, mapPresetRecord } from "@/lib/control-api";

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await postControlApiJson<Record<string, unknown>>("/media/presets", payload, "admin");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to create the media preset." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, preset: mapPresetRecord(result.data) });
}
