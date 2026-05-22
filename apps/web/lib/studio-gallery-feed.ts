import type { AssetPagePayload, GalleryKindFilter } from "@/lib/media-studio-contract";
import type { MediaAsset } from "@/lib/types";

export function isDefaultStudioGalleryQuery({
  favoritesOnly,
  galleryKindFilter,
  galleryModelFilter,
}: {
  favoritesOnly: boolean;
  galleryKindFilter: GalleryKindFilter;
  galleryModelFilter: string;
}) {
  return !favoritesOnly && galleryKindFilter === "all" && galleryModelFilter === "all";
}

export function pageMatchesExpectedJobIds(page: AssetPagePayload, expectedJobIds: string[]) {
  return (
    expectedJobIds.length === 0 ||
    (page.assets ?? []).some((asset) => {
      const assetJobId = typeof asset.job_id === "string" ? asset.job_id : null;
      return assetJobId ? expectedJobIds.includes(assetJobId) : false;
    })
  );
}

export function mergeAssetIntoCollection(collection: MediaAsset[], updatedAsset: MediaAsset) {
  const existingIndex = collection.findIndex((asset) => asset.asset_id === updatedAsset.asset_id);
  if (existingIndex === -1) {
    return [updatedAsset, ...collection];
  }
  const nextCollection = [...collection];
  nextCollection[existingIndex] = updatedAsset;
  return nextCollection;
}
