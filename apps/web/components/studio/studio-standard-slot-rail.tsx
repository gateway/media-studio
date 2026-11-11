"use client";

import type { DragEvent } from "react";
import { Film, Image as ImageIcon } from "lucide-react";

import { StudioMediaSlotAddTile } from "@/components/studio/studio-media-slot-add-tile";
import {
  StudioStagedMediaReplaceControl,
  StudioStagedMediaTile,
} from "@/components/studio/studio-staged-media-tile";
import type {
  StudioComposerSlot,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";

type StudioStandardSlotRailProps = {
  slots: StudioComposerSlot[];
  mobile?: boolean;
  isDragActive: boolean;
  mobileAddTileClassName?: string;
  mobileAddTilePlusIconClassName?: string;
  buildPreview: (
    slot: StudioComposerSlot,
    testIdPrefix: string,
  ) => StudioReferencePreview | null;
  resolveVisualUrl: (slot: StudioComposerSlot) => string | null;
  isAssetBackedImageSlot: (slot: StudioComposerSlot) => boolean;
  onSetDragActive: (value: boolean) => void;
  onSlotDrop: (
    event: DragEvent<HTMLDivElement | HTMLLabelElement>,
    slot: StudioComposerSlot,
  ) => void;
  onOpenPreview: (preview: StudioReferencePreview | null) => void;
  onClearSlot: (slot: StudioComposerSlot) => void;
  onPickFiles: (
    slot: StudioComposerSlot,
    fileList: FileList | File[] | null,
    input?: HTMLInputElement | null,
    replaceFilled?: boolean,
  ) => void;
};

export function StudioStandardSlotRail({
  slots,
  mobile = false,
  isDragActive,
  buildPreview,
  resolveVisualUrl,
  isAssetBackedImageSlot,
  onSetDragActive,
  onSlotDrop,
  onOpenPreview,
  onClearSlot,
  onPickFiles,
}: StudioStandardSlotRailProps) {
  const testIdPrefix = mobile
    ? "studio-mobile-standard-slot"
    : "studio-standard-slot";

  return (
    <div className="studio-fixed-slot-rail studio-media-slot-grid">
      {slots.map((slot) => {
        const testId = `${testIdPrefix}-${slot.id}`;
        const preview = buildPreview(slot, testId);
        const visualUrl = resolveVisualUrl(slot);

        const label = slot.role === "end_frame" ? "End frame" : slot.label;
        const Icon = slot.kind === "video" ? Film : ImageIcon;

        return (
          <div key={slot.id} className="studio-fixed-slot">
            <div className="studio-fixed-slot-media">
              {preview ? (
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    onSetDragActive(true);
                  }}
                  onDragLeave={() => onSetDragActive(false)}
                  onDrop={(event) => void onSlotDrop(event, slot)}
                  className="h-full w-full"
                >
                  <StudioStagedMediaTile
                    preview={preview}
                    visualUrl={visualUrl}
                    footerLabel={preview.metadataLabel ?? null}
                    previewBadge={
                      <span className="studio-fixed-slot-caption">
                        <Icon aria-hidden="true" />
                        <span className="studio-fixed-slot-label">{label}</span>
                      </span>
                    }
                    onOpenPreview={(nextPreview) => onOpenPreview(nextPreview)}
                    onRemove={() => onClearSlot(slot)}
                    replaceControl={
                      <StudioStagedMediaReplaceControl
                        label={`Replace ${slot.label}`}
                        accept={slot.accept}
                        testId={`${testId}-replace`}
                        onPickFiles={(files, input) =>
                          onPickFiles(slot, files, input, true)
                        }
                      />
                    }
                    className="studio-fixed-slot-tile studio-standard-slot-tile h-full w-full"
                    tileClassName={
                      slot.kind === "image" && isAssetBackedImageSlot(slot)
                        ? "border-[rgba(216,141,67,0.24)]"
                        : undefined
                    }
                    testId={`${testId}-filled`}
                  />
                </div>
              ) : (
                <StudioMediaSlotAddTile
                  accept={slot.accept}
                  inputLabel={`Add ${slot.label.toLowerCase()}`}
                  isDragActive={isDragActive}
                  testId={testId}
                  required={slot.required}
                  wrapperClassName="h-full w-full"
                  tileClassName="studio-fixed-slot-add"
                  onDragOver={(event) => {
                    event.preventDefault();
                    onSetDragActive(true);
                  }}
                  onDragLeave={() => onSetDragActive(false)}
                  onDrop={(event) => void onSlotDrop(event, slot)}
                  onPickFiles={(fileList, input) => {
                    onPickFiles(slot, fileList, input);
                  }}
                >
                  <span className="studio-fixed-slot-empty-label">{label}</span>
                </StudioMediaSlotAddTile>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
