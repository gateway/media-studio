import { NextResponse } from "next/server";

import { getMediaQueueSettings, updateMediaQueueSettings } from "@/lib/control-api";

export async function GET() {
  const result = await getMediaQueueSettings();

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to load the media queue settings.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data);
}

export async function PATCH(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await updateMediaQueueSettings(payload);

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to update the media queue settings.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data);
}
