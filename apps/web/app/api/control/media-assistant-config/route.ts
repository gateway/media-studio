import { NextResponse } from "next/server";

import {
  getControlApiJson,
  mapMediaAssistantConfigRecord,
  sendControlApiJson,
} from "@/lib/control-api";

export async function GET() {
  const result = await getControlApiJson<Record<string, unknown>>("/media/assistant-config");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to load the Media Assistant config." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, config: mapMediaAssistantConfigRecord(result.data) });
}

export async function PATCH(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await sendControlApiJson<Record<string, unknown>>("/media/assistant-config", {
    method: "PATCH",
    payload,
    authMode: "admin",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to save the Media Assistant config." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, config: mapMediaAssistantConfigRecord(result.data) });
}
