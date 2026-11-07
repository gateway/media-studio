"use client";

import type { DragEvent } from "react";
import { FolderOpen, Image as ImageIcon, Maximize2, X } from "lucide-react";
import { createPortal } from "react-dom";

import {
  StudioBrowserOverlay,
  StudioBrowserGrid,
} from "@/components/studio/studio-browser-surface";
import { StudioMediaSlotAddTile } from "@/components/studio/studio-media-slot-add-tile";
import {
  StudioStagedMediaReplaceControl,
  StudioStagedMediaTile,
} from "@/components/studio/studio-staged-media-tile";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  orderedImageInputKey,
  orderedImageInputVisual,
  type OrderedImageInput,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import { cn } from "@/lib/utils";

type StudioMultiImageReferenceStripProps = {
  imageLimitLabel: string | null;
  expanded: boolean;
  suspended: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onOpenLibrary: () => void;
  orderedImageInputs: OrderedImageInput[];
  canAddMoreImages: boolean;
  isDragActive: boolean;
  buildOrderedImageInputPreview: (
    slot: OrderedImageInput | null,
    label: string,
    previewKey: string,
  ) => StudioReferencePreview | null;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  onClearOrderedImageInput: (slot: OrderedImageInput | null) => void;
  onSetDragActive: (value: boolean) => void;
  onDropIntoSlot: (
    event: DragEvent<HTMLLabelElement>,
    slotIndex: number,
  ) => void;
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
  imageLimitLabel,
  expanded,
  suspended,
  onExpandedChange,
  onOpenLibrary,
  orderedImageInputs,
  canAddMoreImages,
  isDragActive,
  buildOrderedImageInputPreview,
  onOpenPreview,
  onClearOrderedImageInput,
  onSetDragActive,
  onDropIntoSlot,
  onAddImageFilesToOrderedSlot,
  onReplaceImageFile,
}: StudioMultiImageReferenceStripProps) {
  const tiles = orderedImageInputs.map((slot, slotIndex) => {
    const slotLabel = `Image reference ${slotIndex + 1}`;
    const preview = buildOrderedImageInputPreview(
      slot,
      slotLabel,
      `multi-image-${slotIndex + 1}`,
    );
    if (!preview) return null;

    const testId = `studio-multi-image-slot-${slotIndex + 1}`;
    return (
      <StudioStagedMediaTile
        key={orderedImageInputKey(slot, slotIndex)}
        preview={preview}
        positionBadge={
          <span aria-hidden="true" className="studio-staged-media-position">
            {slotIndex + 1}
          </span>
        }
        visualUrl={orderedImageInputVisual(slot)}
        onOpenPreview={onOpenPreview}
        onRemove={() => onClearOrderedImageInput(slot)}
        replaceControl={
          <StudioStagedMediaReplaceControl
            label={`Replace ${slotLabel.toLowerCase()}`}
            accept="image/*"
            testId={`${testId}-replace`}
            onPickFiles={(files, input) =>
              onReplaceImageFile(files, slot, input)
            }
          />
        }
        className={cn(
          "studio-ordered-reference-tile",
          expanded && "studio-ordered-reference-tile-expanded",
        )}
        testId={testId}
      />
    );
  });

  const upload = canAddMoreImages ? (
    <StudioMediaSlotAddTile
      accept="image/*"
      multiple
      inputLabel="Add image references"
      actionLabel={expanded ? "Upload" : undefined}
      mediaKind={expanded ? "mixed" : "image"}
      isDragActive={isDragActive}
      testId="studio-multi-image-input"
      onDragOver={() => onSetDragActive(true)}
      onDragLeave={() => onSetDragActive(false)}
      onDrop={(event) => onDropIntoSlot(event, orderedImageInputs.length)}
      onPickFiles={(files, input) =>
        onAddImageFilesToOrderedSlot(files, orderedImageInputs.length, input)
      }
    />
  ) : null;
  const count = imageLimitLabel ? (
    <span className="studio-ordered-reference-count">
      <ImageIcon aria-hidden="true" />
      {imageLimitLabel.replace(/\s*images$/, "").replaceAll(" ", "")}
    </span>
  ) : null;

  return (
    <div className="studio-composer-input-panel studio-ordered-references">
      <div className="studio-ordered-reference-heading">
        <div className="studio-meta-label">References</div>
        {count}
        <IconButton
          icon={Maximize2}
          aria-label="Expand image references"
          title="Expand image references"
          aria-haspopup="dialog"
          onClick={() => onExpandedChange(true)}
          size="compact"
          shape="soft"
        />
      </div>
      <div className="studio-reference-rail studio-ordered-reference-strip">
        {expanded ? null : (
          <>
            <div className="studio-reference-rail-items">{tiles}</div>
            {upload}
          </>
        )}
      </div>
      {expanded
        ? createPortal(
            <StudioBrowserOverlay
              testId="studio-expanded-references"
              zIndexClassName="z-[118] studio-expanded-references"
              title="References"
              onClose={() => onExpandedChange(false)}
              suspended={suspended}
              actions={
                <IconButton
                  icon={X}
                  appearance="admin"
                  quiet
                  aria-label="Close expanded references"
                  onClick={() => onExpandedChange(false)}
                />
              }
            >
              <div className="studio-expanded-reference-kind">{count}</div>
              <StudioBrowserGrid className="studio-expanded-reference-grid">
                {tiles}
              </StudioBrowserGrid>
              {canAddMoreImages ? (
                <div className="studio-expanded-reference-actions">
                  {upload}
                  <Button
                    appearance="admin"
                    variant="subtle"
                    onClick={onOpenLibrary}
                  >
                    <FolderOpen aria-hidden="true" /> Choose from library
                  </Button>
                </div>
              ) : null}
            </StudioBrowserOverlay>,
            document.body,
          )
        : null}
    </div>
  );
}
