import { NextResponse } from "next/server";

import {
  getControlApiJson,
  mapPromptRecipeDraftingConfigRecord,
  sendControlApiJson,
} from "@/lib/control-api";

export async function GET() {
  const result = await getControlApiJson<Record<string, unknown>>("/media/prompt-recipe-drafting-config");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to load the Prompt Recipe drafting config." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, config: mapPromptRecipeDraftingConfigRecord(result.data) });
}

export async function PATCH(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await sendControlApiJson<Record<string, unknown>>("/media/prompt-recipe-drafting-config", {
    method: "PATCH",
    payload,
    authMode: "admin",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to save the Prompt Recipe drafting config." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, config: mapPromptRecipeDraftingConfigRecord(result.data) });
}
