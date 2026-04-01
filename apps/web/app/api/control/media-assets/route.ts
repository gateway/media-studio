import { NextResponse } from "next/server";

import { getControlApiJson, mapAssetRecord } from "@/lib/control-api";
import type { MediaAssetsResponse } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.max(1, Number(url.searchParams.get("limit") ?? "12") || 12);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
  const generationKind = url.searchParams.get("generation_kind");
  const modelKey = url.searchParams.get("model_key");
  const status = url.searchParams.get("status");
  const presetKey = url.searchParams.get("preset_key");
  const favorited = url.searchParams.get("favorited");
  const mediaType = generationKind === "video" || generationKind === "image" ? generationKind : null;

  const endpointParams = new URLSearchParams();
  endpointParams.set("limit", String(Math.max(offset + limit + 24, 100)));
  if (mediaType) {
    endpointParams.set("media_type", mediaType);
  }
  if (favorited === "true") {
    endpointParams.set("favorites", "true");
  }

  const result = await getControlApiJson<{ items?: Record<string, unknown>[]; next_cursor?: string | null }>(
    `/media/assets?${endpointParams.toString()}`,
    "read",
  );

  if (!result.ok || !result.data?.items) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Unable to load media assets from the Control API.",
      },
      { status: 502 },
    );
  }

  const assets = result.data.items.map(mapAssetRecord).filter((asset) => {
    if (modelKey && asset.model_key !== modelKey) return false;
    if (status && asset.status !== status) return false;
    if (generationKind && asset.generation_kind !== generationKind) return false;
    if (presetKey && asset.preset_key !== presetKey) return false;
    if (favorited === "true" && !asset.favorited) return false;
    return !asset.dismissed_at;
  });
  const page = assets.slice(offset, offset + limit);

  return NextResponse.json({
    ok: true,
    assets: page,
    limit,
    offset,
    has_more: offset + page.length < assets.length || Boolean(result.data.next_cursor),
    next_offset: offset + page.length < assets.length || Boolean(result.data.next_cursor) ? offset + page.length : null,
  } as MediaAssetsResponse);
}
