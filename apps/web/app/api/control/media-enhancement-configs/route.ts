import { NextResponse } from "next/server";

import { postControlApiJson } from "@/lib/control-api";
import type { MediaEnhancementConfigResponse } from "@/lib/types";

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await postControlApiJson<MediaEnhancementConfigResponse>("/media/enhancement-configs", payload, "admin");

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to create the media enhancement config." }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
