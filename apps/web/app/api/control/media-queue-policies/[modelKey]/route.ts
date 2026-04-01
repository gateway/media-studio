import { NextResponse } from "next/server";

import { updateMediaQueuePolicy } from "@/lib/control-api";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ modelKey: string }> },
) {
  const { modelKey } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await updateMediaQueuePolicy(modelKey, payload);

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to update the model queue policy.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data);
}
