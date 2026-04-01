import { NextResponse } from "next/server";

import { getControlApiJson, mapQueuePolicyRecord } from "@/lib/control-api";
import type { MediaQueuePoliciesResponse } from "@/lib/types";

export async function GET() {
  const result = await getControlApiJson<Record<string, unknown>[]>("/media/queue/policies", "read");

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to load the media queue policies.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, policies: result.data.map(mapQueuePolicyRecord) } as MediaQueuePoliciesResponse);
}
