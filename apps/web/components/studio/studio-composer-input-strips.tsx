"use client";

import type { DragEvent } from "react";
import { FolderOpen, Image as ImageIcon } from "lucide-react";

import { StudioMediaSlotAddTile } from "@/components/studio/studio-media-slot-add-tile";
import {
  StudioStagedMediaReplaceControl,
  StudioStagedMediaTile,
} from "@/components/studio/studio-staged-media-tile";
import {
  StudioReferenceManager,
  type StudioReferenceGroup,
  type StudioReferenceManagerProps,
} from "@/components/studio/studio-reference-manager";
import { IconButton } from "@/components/ui/icon-button";
import { StudioStandardSlotRail } from "@/components/studio/studio-standard-slot-rail";
import type { StudioAttachmentReplacement } from "@/hooks/studio/use-studio-attachments";
import type {
  AttachmentPreviewBuilder,
  StudioAddFilesHandler,
} from "@/components/studio/studio-composer-input-types";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { seedanceReferenceTokenGuide } from "@/lib/media-studio-helpers";
import type {
  OrderedImageInput,
  StudioComposerSlot,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import {
  seedanceReferencePreview,
  seedanceReferenceVisual,
} from "@/lib/studio-reference-previews";

export { StudioMobileInputsContent } from "@/components/studio/studio-mobile-inputs-content";

type StudioSeedanceReferenceStripProps = StudioReferenceManagerProps & {
  referenceImages: AttachmentRecord[];
  referenceVideos: AttachmentRecord[];
  referenceAudios: AttachmentRecord[];
  maxImageReferences: number;
  maxVideoReferences: number;
  maxAudioReferences: number;
  buildAttachmentPreview: AttachmentPreviewBuilder;
  onReferenceDrop: (
    event: DragEvent<HTMLElement>,
    kind: AttachmentRecord["kind"],
  ) => void;
  onOpenLibrary: (
    kind: AttachmentRecord["kind"],
    role: "reference",
    returnFocusTo: HTMLElement | null,
    replacement?: StudioAttachmentReplacement,
  ) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onAddFiles: StudioAddFilesHandler;
  onResetFileInput: (input: HTMLInputElement | null) => void;
};

export function StudioSeedanceReferenceStrip({
  referenceImages,
  referenceVideos,
  referenceAudios,
  maxImageReferences,
  maxVideoReferences,
  maxAudioReferences,
  buildAttachmentPreview,
  onReferenceDrop,
  onOpenLibrary,
  onRemoveAttachment,
  onAddFiles,
  onResetFileInput,
  ...managerProps
}: StudioSeedanceReferenceStripProps) {
  const groups = [
    { kind: "images", limit: maxImageReferences, attachments: referenceImages },
    { kind: "videos", limit: maxVideoReferences, attachments: referenceVideos },
    { kind: "audios", limit: maxAudioReferences, attachments: referenceAudios },
  ] as const;

  return (
    <StudioReferenceManager
      {...managerProps}
      compact
      groups={groups.map(
        ({ kind, limit, attachments }): StudioReferenceGroup => {
          const tokens = seedanceReferenceTokenGuide(attachments);
          return {
            kind,
            limit,
            slots: attachments.map((attachment, index) => ({
              key: attachment.id,
              token: tokens[index],
              testId: `seedance-group-tile-${kind}-${attachment.id}`,
              preview: seedanceReferencePreview(
                attachment,
                kind,
                buildAttachmentPreview,
              ),
              visualUrl: seedanceReferenceVisual(attachment),
              onRemove: () => onRemoveAttachment(attachment.id),
              onOpenReplacementLibrary: (returnFocusTo) =>
                onOpenLibrary(kind, "reference", returnFocusTo, {
                  replaceAttachmentId: attachment.id,
                }),
              onReplace: (files, input) => {
                onAddFiles(files, {
                  role: "reference",
                  allowedKinds: [kind],
                  replaceAttachmentId: attachment.id,
                });
                onResetFileInput(input);
              },
            })),
            uploadTestId: `seedance-group-input-${kind}`,
            onAdd: (files, input) => {
              onAddFiles(files, { role: "reference", allowedKinds: [kind] });
              onResetFileInput(input);
            },
            onDrop: (event) => onReferenceDrop(event, kind),
            onOpenLibrary: (returnFocusTo) =>
              onOpenLibrary(kind, "reference", returnFocusTo),
          };
        },
      )}
    />
  );
}

type StudioSourceAttachmentStripProps = {
  inputRail: "seedance" | "standard";
  isDragActive: boolean;
  seedanceFirstFrameAttachment: AttachmentRecord | null;
  seedanceLastFrameAttachment: AttachmentRecord | null;
  standardComposerSlots: StudioComposerSlot[];
  orderedImageInputs: OrderedImageInput[];
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
  onOpenFrameLibrary?: (
    role: "first_frame" | "last_frame",
    returnFocusTo: HTMLElement | null,
  ) => void;
};

export function StudioSourceAttachmentStrip({
  inputRail,
  isDragActive,
  seedanceFirstFrameAttachment,
  seedanceLastFrameAttachment,
  standardComposerSlots,
  orderedImageInputs,
  mobileAddTileClassName,
  mobileAddTilePlusIconClassName,
  buildAttachmentPreview,
  standardComposerSlotPreview,
  standardComposerSlotVisual,
  onSetDragActive,
  onSetFormWarning,
  onDropIntoSourceSlot,
  onOpenPreview,
  onOpenFrameLibrary,
  onRemoveAttachment,
  onClearStandardComposerSlot,
  onPickStandardComposerSlotFiles,
  onAddFiles,
  onResetFileInput,
}: StudioSourceAttachmentStripProps) {
  return (
    <div
      className={inputRail === "seedance" ? "studio-fixed-slot-rail" : "w-full"}
      data-frame-rail={inputRail === "seedance"}
    >
      {inputRail === "seedance" ? (
        <>
          {[
            {
              label: "Start frame",
              role: "first_frame" as const,
              attachment: seedanceFirstFrameAttachment,
            },
            {
              label: "End frame",
              role: "last_frame" as const,
              attachment: seedanceLastFrameAttachment,
            },
          ].map((slot, slotIndex) => {
            const attachment = slot.attachment;
            const attachmentPreview = attachment
              ? buildAttachmentPreview(
                  attachment,
                  slot.label,
                  `seedance-${slot.role}`,
                )
              : null;
            return (
              <div
                key={`seedance-slot-${slot.role}`}
                className="studio-fixed-slot studio-seedance-frame"
              >
                <span className="studio-seedance-frame-label">
                  {slot.label}
                </span>
                <div
                  data-testid={`seedance-slot-${slot.role}`}
                  className="studio-fixed-slot-media"
                  tabIndex={-1}
                >
                  {attachment && attachmentPreview ? (
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        onSetDragActive(true);
                      }}
                      onDragLeave={() => onSetDragActive(false)}
                      onDrop={(event) => onDropIntoSourceSlot(event, slotIndex)}
                      className="h-full w-full"
                    >
                      <StudioStagedMediaTile
                        preview={attachmentPreview}
                        visualUrl={attachment.previewUrl}
                        previewBadge={
                          <span className="studio-fixed-slot-caption">
                            <ImageIcon aria-hidden="true" />
                            {slot.label}
                          </span>
                        }
                        onOpenPreview={onOpenPreview}
                        onRemove={() => onRemoveAttachment(attachment.id)}
                        replaceControl={
                          <StudioStagedMediaReplaceControl
                            label={`Replace ${slot.label.toLowerCase()}`}
                            accept="image/*"
                            testId={`seedance-slot-input-${slot.role}`}
                            onPickFiles={(files, input) => {
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
                              onAddFiles(files, {
                                role: slot.role,
                                allowedKinds: ["images"],
                                replaceAttachmentId: attachment.id,
                              });
                              onResetFileInput(input);
                            }}
                          />
                        }
                        className="studio-fixed-slot-tile"
                        testId={`seedance-slot-filled-${slot.role}`}
                      />
                    </div>
                  ) : (
                    <>
                      <StudioMediaSlotAddTile
                        accept="image/*"
                        inputLabel={`Add ${slot.label.toLowerCase()}`}
                        isDragActive={isDragActive}
                        testId={`seedance-slot-input-${slot.role}`}
                        required={slot.role === "first_frame"}
                        wrapperClassName="h-full w-full"
                        tileClassName="studio-fixed-slot-add h-full w-full"
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
                      >
                        <span className="studio-fixed-slot-empty-label">
                          {slot.label}
                        </span>
                      </StudioMediaSlotAddTile>
                      {onOpenFrameLibrary && (
                        <IconButton
                          className="studio-frame-library"
                          icon={FolderOpen}
                          shape="soft"
                          aria-label={`Choose ${slot.label.toLowerCase()} from library`}
                          title={`Choose ${slot.label.toLowerCase()} from library`}
                          disabled={
                            slot.role === "last_frame" &&
                            !seedanceFirstFrameAttachment
                          }
                          onClick={(event) => {
                            event.currentTarget.focus();
                            onOpenFrameLibrary(
                              slot.role,
                              event.currentTarget.parentElement,
                            );
                          }}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <StudioStandardSlotRail
          slots={standardComposerSlots}
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
      )}
    </div>
  );
}
