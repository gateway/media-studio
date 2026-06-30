"use client";

import type { DragEvent } from "react";

import type { MediaImagePickerFit, MediaImagePickerItem, MediaImagePickerPurpose } from "./media-image-picker-types";
import { MediaImagePickerTile } from "./media-image-picker-tile";

type MediaImagePickerGridProps = {
  items: MediaImagePickerItem[];
  purpose: MediaImagePickerPurpose;
  imageFit?: MediaImagePickerFit;
  selectionId: string | null;
  onSelectItem: (itemId: string) => void;
  onPreviewItem: (itemId: string) => void;
  onDragItem?: (item: MediaImagePickerItem, event: DragEvent<HTMLButtonElement>) => void;
};

export function MediaImagePickerGrid({
  items,
  purpose,
  imageFit,
  selectionId,
  onSelectItem,
  onPreviewItem,
  onDragItem,
}: MediaImagePickerGridProps) {
  const gridClassName =
    purpose === "reference"
      ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`media-image-picker-grid ${gridClassName}`}>
      {items.map((item, index) => (
        <MediaImagePickerTile
          key={item.id}
          item={item}
          index={index}
          purpose={purpose}
          imageFit={imageFit}
          selecting={selectionId === item.id}
          onSelect={onSelectItem}
          onPreview={onPreviewItem}
          onDrag={onDragItem}
        />
      ))}
    </div>
  );
}
