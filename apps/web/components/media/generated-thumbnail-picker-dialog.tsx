"use client";

import { MediaImagePickerDialog } from "@/components/media/media-image-picker-dialog";
import type { MediaImagePickerItem } from "@/components/media/media-image-picker-types";

export type GeneratedThumbnailPickerItem = MediaImagePickerItem;

type GeneratedThumbnailPickerDialogProps = {
  open: boolean;
  eyebrow?: string;
  title: string;
  description?: string;
  dialogLabel: string;
  items: GeneratedThumbnailPickerItem[];
  loading: boolean;
  loadingMore: boolean;
  nextOffset: number | null;
  selectionId: string | null;
  zIndexClassName?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  itemLabel?: string;
  onClose: () => void;
  onLoadMore: () => void;
  onSelectItem: (itemId: string) => void;
};

export function GeneratedThumbnailPickerDialog({
  open,
  eyebrow = "Generated Images",
  title,
  description,
  dialogLabel,
  items,
  loading,
  loadingMore,
  nextOffset,
  selectionId,
  zIndexClassName = "z-[130]",
  emptyMessage = "No generated images are available yet.",
  loadingMessage = "Loading generated images...",
  itemLabel = "generated image",
  onClose,
  onLoadMore,
  onSelectItem,
}: GeneratedThumbnailPickerDialogProps) {
  return (
    <MediaImagePickerDialog
      open={open}
      eyebrow={eyebrow}
      title={title}
      description={description}
      dialogLabel={dialogLabel}
      items={items}
      loading={loading}
      loadingMore={loadingMore}
      nextOffset={nextOffset}
      selectionId={selectionId}
      purpose="thumbnail"
      imageFit="contain"
      zIndexClassName={zIndexClassName}
      emptyMessage={emptyMessage}
      loadingMessage={loadingMessage}
      itemLabel={itemLabel}
      onClose={onClose}
      onLoadMore={onLoadMore}
      onSelectItem={onSelectItem}
    />
  );
}
