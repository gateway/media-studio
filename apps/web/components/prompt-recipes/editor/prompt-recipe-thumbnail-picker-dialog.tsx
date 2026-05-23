"use client";

import {
  GeneratedThumbnailPickerDialog,
  type GeneratedThumbnailPickerItem,
} from "@/components/media/generated-thumbnail-picker-dialog";
import { generatedThumbnailPreviewUrl } from "@/components/prompt-recipes/editor/prompt-recipe-thumbnail-utils";
import type { MediaAsset } from "@/lib/types";

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
  assets: MediaAsset[];
  assetsLoading: boolean;
  assetsLoadingMore: boolean;
  nextOffset: number | null;
  selectionId: string | null;
  onClose: () => void;
  onLoadMore: () => void;
  onSelectAsset: (assetId: string | number) => void;
}) {
  const items: GeneratedThumbnailPickerItem[] = assets.map((asset) => {
    const id = String(asset.asset_id);
    return {
      id,
      previewUrl: generatedThumbnailPreviewUrl(asset),
      ariaLabel: `Use generated image ${id} as thumbnail`,
    };
  });

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
