import { mediaDisplayUrl, mediaThumbnailUrl } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";

export function generatedThumbnailPreviewUrl(asset: MediaAsset | null | undefined) {
  return mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset) ?? asset?.hero_original_url ?? asset?.hero_web_url ?? null;
}
