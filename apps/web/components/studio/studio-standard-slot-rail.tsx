"use client";

import type { DragEvent } from "react";

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

function renderSlotLabel(slot: StudioComposerSlot) {
  const label = slot.role === "end_frame" ? "End frame" : slot.label;
  return <div className="studio-slot-label">{label}</div>;
}

export function StudioStandardSlotRail({
  slots,
  mobile = false,
  isDragActive,
  mobileAddTileClassName = "h-[58px] w-[58px] rounded-[18px]",
  mobileAddTilePlusIconClassName = "size-5",
  buildPreview,
  resolveVisualUrl,
  isAssetBackedImageSlot,
  onSetDragActive,
  onSlotDrop,
  onOpenPreview,
  onClearSlot,
  onPickFiles,
}: StudioStandardSlotRailProps) {
  const layout = mobile
    ? {
        testIdPrefix: "studio-mobile-standard-slot",
        outerClass: "shrink-0",
        frameClass: "h-[72px] w-[72px]",
        previewClass: "h-[72px] w-[72px]",
        addWrapperClass: "shrink-0",
        addTileClass: mobileAddTileClassName,
        addIconClass: mobileAddTilePlusIconClassName,
      }
    : {
        testIdPrefix: "studio-standard-slot",
        outerClass: "flex w-[96px] flex-col gap-2",
        frameClass: "relative h-[82px] w-[82px]",
        previewClass: "h-full w-full",
        addWrapperClass: "h-full w-full",
        addTileClass: "h-full w-full",
        addIconClass: undefined,
      };

  return (
    <>
      {slots.map((slot) => {
        const testId = `${layout.testIdPrefix}-${slot.id}`;
        const preview = buildPreview(slot, testId);
        const visualUrl = resolveVisualUrl(slot);

        return (
          <div key={slot.id} className={layout.outerClass}>
            {renderSlotLabel(slot)}
            <div className={layout.frameClass}>
              {preview ? (
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    onSetDragActive(true);
                  }}
                  onDragLeave={() => onSetDragActive(false)}
                  onDrop={(event) => void onSlotDrop(event, slot)}
                  className={layout.previewClass}
                >
                  <StudioStagedMediaTile
                    preview={preview}
                    visualUrl={visualUrl}
                    footerLabel={preview.metadataLabel ?? null}
                    onOpenPreview={(nextPreview) => onOpenPreview(nextPreview)}
                    onRemove={() => onClearSlot(slot)}
                    replaceControl={
                      !mobile && (
                        <StudioStagedMediaReplaceControl
                          label={`Replace ${slot.label}`}
                          accept={slot.accept}
                          testId={`${testId}-replace`}
                          onPickFiles={(files, input) =>
                            onPickFiles(slot, files, input, true)
                          }
                        />
                      )
                    }
                    className={layout.previewClass}
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
                  isDragActive={isDragActive}
                  testId={testId}
                  required={slot.required}
                  wrapperClassName={layout.addWrapperClass}
                  tileClassName={layout.addTileClass}
                  plusIconClassName={layout.addIconClass}
                  onDragOver={(event) => {
                    event.preventDefault();
                    onSetDragActive(true);
                  }}
                  onDragLeave={() => onSetDragActive(false)}
                  onDrop={(event) => void onSlotDrop(event, slot)}
                  onPickFiles={(fileList, input) => {
                    onPickFiles(slot, fileList, input);
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
