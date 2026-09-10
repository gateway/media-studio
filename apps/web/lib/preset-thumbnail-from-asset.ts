import { getControlApiFile, getControlApiJson, mapAssetRecord } from "@/lib/control-api";
import { storePresetThumbnailBuffer } from "@/lib/preset-thumbnail-storage";

function normalizeAssetDataPath(pathValue: string | null | undefined) {
  const normalized = String(pathValue ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  return !parts.length || parts.some((part) => part === "..") ? null : parts.join("/");
}

export async function createPresetThumbnailFromAsset(assetId: string, presetLabel: string) {
  try {
    if (!assetId) {
      return { ok: false as const, status: 400, error: "Choose a generated image before applying a thumbnail." };
    }
    const assetResult = await getControlApiJson<Record<string, unknown>>(`/media/assets/${assetId}`, "admin");
    if (!assetResult.ok || !assetResult.data) {
      return { ok: false as const, status: 502, error: assetResult.error ?? "Unable to load the selected generated image." };
    }
    const asset = mapAssetRecord(assetResult.data);
    const sourcePath = normalizeAssetDataPath(asset.hero_original_path)
      ?? normalizeAssetDataPath(asset.hero_web_path)
      ?? normalizeAssetDataPath(asset.hero_thumb_path)
      ?? normalizeAssetDataPath(asset.hero_poster_path);
    if (!sourcePath) {
      return { ok: false as const, status: 400, error: "The selected generated image does not expose a usable local file." };
    }
    const fileResult = await getControlApiFile(sourcePath.split("/"));
    if (!fileResult.ok || !fileResult.response) {
      return { ok: false as const, status: 502, error: fileResult.error ?? "Unable to read the selected generated image." };
    }
    const contentType = fileResult.response.headers.get("content-type") ?? "";
    if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") {
      return { ok: false as const, status: 400, error: "Only generated image assets can be used as preset thumbnails." };
    }
    const stored = await storePresetThumbnailBuffer({
      sourceBuffer: Buffer.from(await fileResult.response.arrayBuffer()),
      presetLabel: presetLabel || asset.prompt_summary || asset.model_key || `preset-${assetId}`,
    });
    return { ok: true as const, thumbnail_path: stored.thumbnail_path, thumbnail_url: stored.thumbnail_url };
  } catch {
    return { ok: false as const, status: 500, error: "Unable to use that generated image as a preset thumbnail." };
  }
}
