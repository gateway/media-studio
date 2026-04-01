import { NextResponse } from "next/server";

import { sendControlApiJson } from "@/lib/control-api";
import type { MediaEnhancementConfigResponse } from "@/lib/types";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ modelKey: string }> },
) {
  const { modelKey } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await sendControlApiJson<MediaEnhancementConfigResponse>(`/media/enhancement-configs/${modelKey}`, {
    method: "PATCH",
    payload,
    authMode: "admin",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to update the media enhancement config." }, { status: 502 });
  }

  return NextResponse.json(result.data);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ modelKey: string }> },
) {
  const { modelKey } = await context.params;
  const result = await sendControlApiJson<Record<string, unknown>>(`/media/enhancement-configs/${modelKey}`, {
    method: "DELETE",
    authMode: "admin",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to archive the media enhancement config." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
