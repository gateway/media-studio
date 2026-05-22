import { NextResponse } from "next/server";

import { postControlApiJson } from "@/lib/control-api";

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await postControlApiJson<Record<string, unknown>>(
    "/media/prompt-recipe-drafting-config/probe",
    {
      provider_kind: payload.provider_kind ?? null,
      selected_model_id: payload.provider_model_id ?? null,
      base_url: payload.provider_base_url ?? null,
      require_images: Boolean(payload.require_images),
    },
    "admin",
  );

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to probe the Prompt Recipe drafting provider." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ...result.data });
}
