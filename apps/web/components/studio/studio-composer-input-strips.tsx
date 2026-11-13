"use client";

import type { DragEvent } from "react";
import { FolderOpen, Image as ImageIcon } from "lucide-react";

import { StudioMediaSlotAddTile } from "@/components/studio/studio-media-slot-add-tile";
import { StudioReferenceSourceMenu } from "@/components/studio/studio-reference-source-menu";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import {
  StudioReferenceManager,
  type StudioReferenceGroup,
  type StudioReferenceManagerProps,
} from "@/components/studio/studio-reference-manager";
import { IconButton } from "@/components/ui/icon-button";
import {
  StudioStandardSlotRail,
  type StudioStandardSlotRailProps,
} from "@/components/studio/studio-standard-slot-rail";
import type { StudioAttachmentReplacement } from "@/hooks/studio/use-studio-attachments";
import {
  seedanceFrameDragHandlers,
  type AttachmentPreviewBuilder,
  type StudioAddFilesHandler,
  type StudioFrameInputProps,
} from "@/components/studio/studio-composer-input-types";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { seedanceReferenceTokenGuide } from "@/lib/media-studio-helpers";
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
      dropOnStrip
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

type StudioSourceAttachmentStripProps = StudioFrameInputProps & {
  inputRail: "seedance" | "standard";
  standardSlotRailProps: StudioStandardSlotRailProps;
  onOpenFrameLibrary: (
    role: "first_frame" | "last_frame",
    returnFocusTo: HTMLElement | null,
    replacement?: StudioAttachmentReplacement,
  ) => void;
};

export function StudioSourceAttachmentStrip({
  inputRail,
  isDragActive,
  seedanceFirstFrameAttachment,
  seedanceLastFrameAttachment,
  standardSlotRailProps,
  buildAttachmentPreview,
  onSetDragActive,
  onSetFormWarning,
  onDropIntoSourceSlot,
  onOpenPreview,
  onOpenFrameLibrary,
  onRemoveAttachment,
  onAddFiles,
  onResetFileInput,
}: StudioSourceAttachmentStripProps) {
  return (
    <div
      className={
        inputRail === "seedance"
          ? "studio-fixed-slot-rail studio-media-slot-grid"
          : "w-full"
      }
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
            const dragHandlers = seedanceFrameDragHandlers(
              slotIndex,
              onSetDragActive,
              onDropIntoSourceSlot,
            );
            const attachment = slot.attachment;
            const attachmentPreview = attachment
              ? buildAttachmentPreview(
                  attachment,
                  slot.label,
                  `seedance-${slot.role}`,
                )
              : null;
            const startFrameWarning =
              slot.role === "last_frame" && !seedanceFirstFrameAttachment
                ? "Add a start frame before the end frame."
                : null;

            function pickFrameFiles(
              files: FileList | null,
              input: HTMLInputElement,
              replacement?: StudioAttachmentReplacement,
            ) {
              if (startFrameWarning) {
                onSetFormWarning(startFrameWarning);
              } else {
                onAddFiles(files, {
                  role: slot.role,
                  allowedKinds: ["images"],
                  ...replacement,
                });
              }
              onResetFileInput(input);
            }

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
                      {...dragHandlers}
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
                          <StudioReferenceSourceMenu
                            action="Replace"
                            label={`Replace ${slot.label.toLowerCase()}`}
                            accept="image/*"
                            testId={`seedance-slot-input-${slot.role}`}
                            onPickFiles={(files, input) => {
                              if (!files?.length) return;
                              pickFrameFiles(files, input, {
                                replaceAttachmentId: attachment.id,
                              });
                            }}
                            onOpenLibrary={(trigger) => {
                              if (startFrameWarning) {
                                onSetFormWarning(startFrameWarning);
                                return;
                              }
                              onOpenFrameLibrary(slot.role, trigger, {
                                replaceAttachmentId: attachment.id,
                              });
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
                        {...dragHandlers}
                        onPickFiles={pickFrameFiles}
                      >
                        <span className="studio-fixed-slot-empty-label">
                          {slot.label}
                        </span>
                      </StudioMediaSlotAddTile>
                      <IconButton
                        className="studio-frame-library"
                        icon={FolderOpen}
                        shape="soft"
                        aria-label={`Choose ${slot.label.toLowerCase()} from library`}
                        title={`Choose ${slot.label.toLowerCase()} from library`}
                        disabled={Boolean(startFrameWarning)}
                        onClick={(event) => {
                          event.currentTarget.focus();
                          onOpenFrameLibrary(
                            slot.role,
                            event.currentTarget.parentElement,
                          );
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <StudioStandardSlotRail {...standardSlotRailProps} />
      )}
    </div>
  );
}
