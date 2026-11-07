"use client";

import type { DragEvent } from "react";

import {
  StudioReferenceManager,
  type StudioReferenceManagerProps,
} from "@/components/studio/studio-reference-manager";
import {
  orderedImageInputKey,
  orderedImageInputVisual,
  type OrderedImageInput,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";

type StudioMultiImageReferenceStripProps = StudioReferenceManagerProps & {
  imageLimit: number;
  onOpenLibrary: () => void;
  orderedImageInputs: OrderedImageInput[];
  buildOrderedImageInputPreview: (
    slot: OrderedImageInput | null,
    label: string,
    previewKey: string,
  ) => StudioReferencePreview | null;
  onClearOrderedImageInput: (slot: OrderedImageInput | null) => void;
  onDropIntoSlot: (event: DragEvent<HTMLElement>, slotIndex: number) => void;
  onAddImageFilesToOrderedSlot: (
    fileList: FileList | null,
    slotIndex: number,
    input: HTMLInputElement,
  ) => void;
  onReplaceImageFile: (
    fileList: FileList,
    slot: OrderedImageInput,
    input: HTMLInputElement,
  ) => void;
};

export function StudioMultiImageReferenceStrip({
  imageLimit,
  onOpenLibrary,
  orderedImageInputs,
  buildOrderedImageInputPreview,
  onClearOrderedImageInput,
  onDropIntoSlot,
  onAddImageFilesToOrderedSlot,
  onReplaceImageFile,
  ...managerProps
}: StudioMultiImageReferenceStripProps) {
  return (
    <StudioReferenceManager
      {...managerProps}
      compact={false}
      groups={[
        {
          kind: "images",
          limit: imageLimit,
          slots: orderedImageInputs.map((slot, index) => {
            const label = `Image reference ${index + 1}`;
            const key = orderedImageInputKey(slot, index);
            return {
              key,
              testId: `studio-multi-image-slot-${index + 1}`,
              preview: buildOrderedImageInputPreview(
                slot,
                label,
                `multi-image-${index + 1}`,
              ) ?? { key, label, kind: "images", url: "" },
              visualUrl: orderedImageInputVisual(slot),
              onRemove: () => onClearOrderedImageInput(slot),
              onReplace: (files, input) =>
                onReplaceImageFile(files, slot, input),
            };
          }),
          uploadTestId: "studio-multi-image-input",
          onAdd: (files, input) =>
            onAddImageFilesToOrderedSlot(
              files,
              orderedImageInputs.length,
              input,
            ),
          onDrop: (event) => onDropIntoSlot(event, orderedImageInputs.length),
          onOpenLibrary,
        },
      ]}
    />
  );
}
