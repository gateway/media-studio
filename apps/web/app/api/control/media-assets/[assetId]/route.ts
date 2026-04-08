import { NextResponse } from "next/server";

import { getControlApiJson, sendControlApiJson, mapAssetRecord } from "@/lib/control-api";
import type { MediaAssetResponse } from "@/lib/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const result = await getControlApiJson<Record<string, unknown>>(`/media/assets/${assetId}`, "admin");

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to load the selected media asset.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    asset: mapAssetRecord(result.data),
  } as MediaAssetResponse);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const payload = (await request.json().catch(() => null)) as { favorited?: boolean } | null;

  if (typeof payload?.favorited !== "boolean") {
    return NextResponse.json(
      {
        ok: false,
        error: "A boolean favorited flag is required to update the selected media asset.",
      },
      { status: 400 },
    );
  }

  const result = await sendControlApiJson<Record<string, unknown>>(
    `/media/assets/${assetId}/favorite`,
    {
      method: "POST",
      payload: { favorited: payload.favorited },
      authMode: "admin",
    },
  );

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to update the favorite state for the selected media asset.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    asset: mapAssetRecord(result.data),
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const result = await sendControlApiJson<Record<string, unknown>>(
    `/media/assets/${assetId}/dismiss`,
    {
      method: "POST",
      authMode: "admin",
    },
  );

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to remove the selected media asset from the dashboard.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    asset: mapAssetRecord(result.data),
  } as MediaAssetResponse);
}
