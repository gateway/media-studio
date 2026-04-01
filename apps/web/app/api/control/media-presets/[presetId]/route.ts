import { NextResponse } from "next/server";

import { sendControlApiJson, mapPresetRecord } from "@/lib/control-api";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ presetId: string }> },
) {
  const { presetId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await sendControlApiJson<Record<string, unknown>>(`/media/presets/${presetId}`, {
    method: "PATCH",
    payload,
    authMode: "admin",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to update the media preset." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, preset: mapPresetRecord(result.data) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ presetId: string }> },
) {
  const { presetId } = await context.params;
  const result = await sendControlApiJson<Record<string, unknown>>(`/media/presets/${presetId}`, {
    method: "DELETE",
    authMode: "admin",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to archive the media preset." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, preset: result.data ? mapPresetRecord(result.data) : null });
}
