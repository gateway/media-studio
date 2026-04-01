import { NextResponse } from "next/server";

import { postControlApiJson } from "@/lib/control-api";
import type { MediaEnhancementProviderProbeResponse } from "@/lib/types";

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await postControlApiJson<MediaEnhancementProviderProbeResponse>(
    "/media/enhancement/providers/probe",
    payload,
    "admin",
  );

  if (!result.ok || !result.data) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Unable to probe the enhancement provider." },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data);
}
