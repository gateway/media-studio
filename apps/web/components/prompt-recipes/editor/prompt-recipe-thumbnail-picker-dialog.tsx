"use client";

import {
  GeneratedThumbnailPickerDialog,
  type GeneratedThumbnailPickerItem,
} from "@/components/media/generated-thumbnail-picker-dialog";
import { generatedImagePickerItem } from "@/components/media/media-image-picker-sources";
import type { MediaAssetPickerItem } from "@/lib/types";

export function PromptRecipeThumbnailPickerDialog({
  open,
  assets,
  assetsLoading,
  assetsLoadingMore,
  nextOffset,
  selectionId,
  onClose,
  onLoadMore,
  onSelectAsset,
}: {
  open: boolean;
  assets: MediaAssetPickerItem[];
  assetsLoading: boolean;
  assetsLoadingMore: boolean;
  nextOffset: number | null;
  selectionId: string | null;
  onClose: () => void;
  onLoadMore: () => void;
  onSelectAsset: (assetId: string | number) => void;
}) {
  const items: GeneratedThumbnailPickerItem[] = assets
    .map((asset) => {
      const item = generatedImagePickerItem(asset);
      return item ? { ...item, ariaLabel: `Use generated image ${item.id} as thumbnail` } : null;
    })
    .filter((item): item is GeneratedThumbnailPickerItem => Boolean(item));

  return (
    <GeneratedThumbnailPickerDialog
      open={open}
      dialogLabel="Generated image thumbnails"
      title="Choose a thumbnail"
      description="Pick a recent generated image to use as this recipe thumbnail."
      items={items}
      loading={assetsLoading}
      loadingMore={assetsLoadingMore}
      nextOffset={nextOffset}
      selectionId={selectionId}
      onClose={onClose}
      onLoadMore={onLoadMore}
      onSelectItem={onSelectAsset}
    />
  );
}
