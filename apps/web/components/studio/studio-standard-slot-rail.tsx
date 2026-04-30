"use client";

import type { DragEvent, ReactNode } from "react";

import { ImagePlus } from "lucide-react";

import { StudioMediaSlotAddTile } from "@/components/studio/studio-media-slot-add-tile";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import type { StudioComposerSlot, StudioReferencePreview } from "@/lib/media-studio-helpers";

type StudioStandardSlotRailProps = {
  slots: StudioComposerSlot[];
  mobile?: boolean;
  isDragActive: boolean;
  mobileAddTileClassName?: string;
  mobileAddTilePlusIconClassName?: string;
  buildPreview: (slot: StudioComposerSlot, testIdPrefix: string) => StudioReferencePreview | null;
  resolveVisualUrl: (slot: StudioComposerSlot) => string | null;
  isAssetBackedImageSlot: (slot: StudioComposerSlot) => boolean;
  onSetDragActive: (value: boolean) => void;
  onSlotDrop: (event: DragEvent<HTMLDivElement | HTMLLabelElement>, slot: StudioComposerSlot) => void;
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
  return (
    <div className="studio-slot-label">
      {label}
    </div>
  );
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
  function renderReplaceControl(slot: StudioComposerSlot, testId: string): ReactNode {
    return (
      <label className="studio-slot-utility-button inline-flex h-8 w-8 cursor-pointer">
        <ImagePlus className="size-3.5" />
        <input
          type="file"
          accept={slot.accept}
          data-testid={testId}
          className="hidden"
          onChange={(event) => {
            onPickFiles(slot, event.target.files, event.currentTarget, true);
          }}
        />
      </label>
    );
  }

  return (
    <>
      {slots.map((slot) => {
        const preview = buildPreview(slot, `${mobile ? "studio-mobile-standard-slot" : "studio-standard-slot"}-${slot.id}`);
        const visualUrl = resolveVisualUrl(slot);
        const previewClassName = mobile ? "h-[72px] w-[72px]" : "h-full w-full";
        const testIdPrefix = mobile ? "studio-mobile-standard-slot" : "studio-standard-slot";

        return (
          <div key={slot.id} className={mobile ? "shrink-0" : "flex w-[96px] flex-col gap-2"}>
            {renderSlotLabel(slot)}
            <div className={mobile ? "h-[72px] w-[72px]" : "relative h-[82px] w-[82px]"}>
              {preview ? (
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    onSetDragActive(true);
                  }}
                  onDragLeave={() => onSetDragActive(false)}
                  onDrop={(event) => void onSlotDrop(event, slot)}
                  className={previewClassName}
                >
                  <StudioStagedMediaTile
                    preview={preview}
                    visualUrl={visualUrl}
                    onOpenPreview={(nextPreview) => onOpenPreview(nextPreview)}
                    onRemove={() => onClearSlot(slot)}
                    replaceControl={mobile ? undefined : renderReplaceControl(slot, `${testIdPrefix}-${slot.id}-replace`)}
                    className={previewClassName}
                    tileClassName={slot.kind === "image" && isAssetBackedImageSlot(slot) ? "border-[rgba(216,141,67,0.24)]" : undefined}
                    testId={`${testIdPrefix}-${slot.id}-filled`}
                  />
                </div>
              ) : (
                <StudioMediaSlotAddTile
                  accept={slot.accept}
                  isDragActive={isDragActive}
                  testId={`${testIdPrefix}-${slot.id}`}
                  required={slot.required}
                  wrapperClassName={mobile ? "shrink-0" : "h-full w-full"}
                  tileClassName={mobile ? mobileAddTileClassName : "h-full w-full"}
                  plusIconClassName={mobile ? mobileAddTilePlusIconClassName : undefined}
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
