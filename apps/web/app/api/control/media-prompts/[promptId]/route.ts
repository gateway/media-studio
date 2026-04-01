import { NextResponse } from "next/server";

import { sendControlApiJson, mapPromptRecord } from "@/lib/control-api";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ promptId: string }> },
) {
  const { promptId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await sendControlApiJson<Record<string, unknown>>(`/media/system-prompts/${promptId}`, {
    method: "PATCH",
    payload,
    authMode: "admin",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to update the media system prompt." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, prompt: mapPromptRecord(result.data) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ promptId: string }> },
) {
  const { promptId } = await context.params;
  const result = await sendControlApiJson<Record<string, unknown>>(`/media/system-prompts/${promptId}`, {
    method: "DELETE",
    authMode: "admin",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to archive the media system prompt." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, prompt: null });
}
