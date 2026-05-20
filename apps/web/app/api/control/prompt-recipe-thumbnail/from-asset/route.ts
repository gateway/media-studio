import { NextResponse } from "next/server";

import { getControlApiFile, getControlApiJson, mapAssetRecord } from "@/lib/control-api";
import { storePromptRecipeThumbnailBuffer } from "@/lib/prompt-recipe-thumbnail-storage";

function normalizeAssetDataPath(pathValue: string | null | undefined) {
  const normalized = String(pathValue ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as {
      asset_id?: string | number | null;
      recipeLabel?: string | null;
    } | null;

    const assetId = String(payload?.asset_id ?? "").trim();
    const recipeLabel = String(payload?.recipeLabel ?? "").trim();

    if (!assetId) {
      return NextResponse.json(
        { ok: false, error: "Choose a generated image before applying a thumbnail." },
        { status: 400 },
      );
    }

    const assetResult = await getControlApiJson<Record<string, unknown>>(`/media/assets/${assetId}`, "admin");
    if (!assetResult.ok || !assetResult.data) {
      return NextResponse.json(
        { ok: false, error: assetResult.error ?? "Unable to load the selected generated image." },
        { status: 502 },
      );
    }

    const asset = mapAssetRecord(assetResult.data);
    const sourcePath =
      normalizeAssetDataPath(asset.hero_original_path) ??
      normalizeAssetDataPath(asset.hero_web_path) ??
      normalizeAssetDataPath(asset.hero_thumb_path) ??
      normalizeAssetDataPath(asset.hero_poster_path);

    if (!sourcePath) {
      return NextResponse.json(
        { ok: false, error: "The selected generated image does not expose a usable local file." },
        { status: 400 },
      );
    }

    const fileResult = await getControlApiFile(sourcePath.split("/").filter(Boolean));
    if (!fileResult.ok || !fileResult.response) {
      return NextResponse.json(
        { ok: false, error: fileResult.error ?? "Unable to read the selected generated image." },
        { status: 502 },
      );
    }

    const contentType = fileResult.response.headers.get("content-type") ?? "";
    if (
      contentType &&
      !contentType.startsWith("image/") &&
      contentType !== "application/octet-stream"
    ) {
      return NextResponse.json(
        { ok: false, error: "Only generated image assets can be used as prompt recipe thumbnails." },
        { status: 400 },
      );
    }

    const stored = await storePromptRecipeThumbnailBuffer({
      sourceBuffer: Buffer.from(await fileResult.response.arrayBuffer()),
      recipeLabel: recipeLabel || asset.prompt_summary || asset.model_key || `prompt-recipe-${assetId}`,
    });

    return NextResponse.json({
      ok: true,
      thumbnail_path: stored.thumbnail_path,
      thumbnail_url: stored.thumbnail_url,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unable to use that generated image as a prompt recipe thumbnail." },
      { status: 500 },
    );
  }
}
