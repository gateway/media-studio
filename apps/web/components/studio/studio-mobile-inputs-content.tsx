"use client";

import type { DragEvent } from "react";

import { StudioMediaSlotAddTile } from "@/components/studio/studio-media-slot-add-tile";
import {
  StudioMobileInputsGroup,
  StudioMobileInputsSection,
} from "@/components/studio/studio-mobile-inputs-section";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import { StudioStandardSlotRail } from "@/components/studio/studio-standard-slot-rail";
import type {
  AttachmentPreviewBuilder,
  StudioAddFilesHandler,
} from "@/components/studio/studio-composer-input-types";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import {
  type OrderedImageInput,
  type StudioComposerSlot,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { StudioComposerInputRail } from "@/lib/studio-model-support";

type StudioMobileInputsContentProps = {
  inputRail: StudioComposerInputRail;
  effectiveSeedanceMode: string;
  orderedImageInputs: OrderedImageInput[];
  isDragActive: boolean;
  seedanceFirstFrameAttachment: AttachmentRecord | null;
  seedanceLastFrameAttachment: AttachmentRecord | null;
  standardComposerSectionTitle: string;
  standardComposerSummaryLabel: string | null;
  standardComposerSlots: StudioComposerSlot[];
  mobileAddTileClassName: string;
  mobileAddTilePlusIconClassName: string;
  buildAttachmentPreview: AttachmentPreviewBuilder;
  standardComposerSlotPreview: (
    slot: StudioComposerSlot,
    previewKey: string,
  ) => StudioReferencePreview | null;
  standardComposerSlotVisual: (slot: StudioComposerSlot) => string | null;
  onSetDragActive: (value: boolean) => void;
  onSetFormWarning: (text: string) => void;
  onDropIntoSourceSlot: (
    event: DragEvent<HTMLDivElement | HTMLLabelElement>,
    slotIndex?: number,
    slot?: StudioComposerSlot,
  ) => void;
  onOpenPreview: (preview: StudioReferencePreview | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onClearStandardComposerSlot: (slot: StudioComposerSlot) => void;
  onPickStandardComposerSlotFiles: (
    slot: StudioComposerSlot,
    fileList: FileList | File[] | null,
    input?: HTMLInputElement | null,
    replaceFilled?: boolean,
  ) => void;
  onAddFiles: StudioAddFilesHandler;
  onResetFileInput: (input: HTMLInputElement | null) => void;
};

export function StudioMobileInputsContent({
  inputRail,
  effectiveSeedanceMode,
  orderedImageInputs,
  isDragActive,
  seedanceFirstFrameAttachment,
  seedanceLastFrameAttachment,
  standardComposerSectionTitle,
  standardComposerSummaryLabel,
  standardComposerSlots,
  mobileAddTileClassName,
  mobileAddTilePlusIconClassName,
  buildAttachmentPreview,
  standardComposerSlotPreview,
  standardComposerSlotVisual,
  onSetDragActive,
  onSetFormWarning,
  onDropIntoSourceSlot,
  onOpenPreview,
  onRemoveAttachment,
  onClearStandardComposerSlot,
  onPickStandardComposerSlotFiles,
  onAddFiles,
  onResetFileInput,
}: StudioMobileInputsContentProps) {
  if (inputRail === "seedance") {
    return (
      <StudioMobileInputsSection title="Inputs">
        <div className="grid gap-3">
          <StudioMobileInputsGroup
            label="Frames"
            summary={
              effectiveSeedanceMode === "first_last_frames"
                ? `${seedanceFirstFrameAttachment ? 1 : 0}/${seedanceLastFrameAttachment ? 2 : 1}`
                : seedanceFirstFrameAttachment
                  ? "1/1"
                  : "0/1"
            }
          >
            <div className="studio-media-slot-grid">
              {[
                {
                  label: "Start frame",
                  role: "first_frame" as const,
                  attachment: seedanceFirstFrameAttachment,
                },
                ...(effectiveSeedanceMode === "first_last_frames"
                  ? [
                      {
                        label: "End frame",
                        role: "last_frame" as const,
                        attachment: seedanceLastFrameAttachment,
                      },
                    ]
                  : []),
              ].map((slot, slotIndex) => {
                const attachmentPreview = slot.attachment
                  ? buildAttachmentPreview(
                      slot.attachment,
                      slot.label,
                      `mobile-seedance-${slot.role}`,
                    )
                  : null;
                return (
                  <div
                    key={`mobile-seedance-${slot.role}`}
                    className="studio-fixed-slot-media"
                  >
                    {slot.attachment && attachmentPreview ? (
                      <div
                        onDragOver={(event) => {
                          event.preventDefault();
                          onSetDragActive(true);
                        }}
                        onDragLeave={() => onSetDragActive(false)}
                        onDrop={(event) =>
                          onDropIntoSourceSlot(event, slotIndex)
                        }
                        className="h-full w-full"
                      >
                        <StudioStagedMediaTile
                          preview={attachmentPreview}
                          visualUrl={slot.attachment.previewUrl}
                          onOpenPreview={onOpenPreview}
                          onRemove={() =>
                            onRemoveAttachment(slot.attachment?.id ?? "")
                          }
                          className="h-full w-full"
                          testId={`studio-mobile-seedance-slot-${slot.role}`}
                        />
                      </div>
                    ) : (
                      <StudioMediaSlotAddTile
                        accept="image/*"
                        isDragActive={isDragActive}
                        testId={`studio-mobile-seedance-slot-input-${slot.role}`}
                        required={slot.role === "first_frame"}
                        wrapperClassName="h-full w-full"
                        tileClassName="studio-fixed-slot-add"
                        plusIconClassName={mobileAddTilePlusIconClassName}
                        onDragOver={(event) => {
                          event.preventDefault();
                          onSetDragActive(true);
                        }}
                        onDragLeave={() => onSetDragActive(false)}
                        onDrop={(event) =>
                          onDropIntoSourceSlot(event, slotIndex)
                        }
                        onPickFiles={(fileList, input) => {
                          if (
                            slot.role === "last_frame" &&
                            !seedanceFirstFrameAttachment
                          ) {
                            onSetFormWarning(
                              "Add a start frame before the end frame.",
                            );
                            onResetFileInput(input);
                            return;
                          }
                          onAddFiles(fileList, {
                            role: slot.role,
                            allowedKinds: ["images"],
                          });
                          onResetFileInput(input);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </StudioMobileInputsGroup>
        </div>
      </StudioMobileInputsSection>
    );
  }

  if (inputRail === "standard") {
    return (
      <StudioMobileInputsSection
        title={standardComposerSectionTitle}
        summary={standardComposerSummaryLabel}
      >
        <div>
          <StudioStandardSlotRail
            slots={standardComposerSlots}
            mobile
            isDragActive={isDragActive}
            mobileAddTileClassName={mobileAddTileClassName}
            mobileAddTilePlusIconClassName={mobileAddTilePlusIconClassName}
            buildPreview={standardComposerSlotPreview}
            resolveVisualUrl={standardComposerSlotVisual}
            isAssetBackedImageSlot={(slot) =>
              slot.kind === "image" &&
              orderedImageInputs[slot.slotIndex]?.source === "asset"
            }
            onSetDragActive={onSetDragActive}
            onSlotDrop={(event, slot) =>
              onDropIntoSourceSlot(event, slot.slotIndex, slot)
            }
            onOpenPreview={onOpenPreview}
            onClearSlot={onClearStandardComposerSlot}
            onPickFiles={onPickStandardComposerSlotFiles}
          />
        </div>
      </StudioMobileInputsSection>
    );
  }

  return null;
}
