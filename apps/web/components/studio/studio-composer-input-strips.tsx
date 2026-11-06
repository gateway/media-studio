"use client";

import type { DragEvent } from "react";

import {
  StudioMediaSlotAddTile,
  studioMediaSlotAddTileIcon,
} from "@/components/studio/studio-media-slot-add-tile";
import {
  StudioStagedMediaReplaceControl,
  StudioStagedMediaTile,
} from "@/components/studio/studio-staged-media-tile";
import { StudioStandardSlotRail } from "@/components/studio/studio-standard-slot-rail";
import type {
  AttachmentPreviewBuilder,
  StudioAddFilesHandler,
} from "@/components/studio/studio-composer-input-types";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import type {
  OrderedImageInput,
  StudioComposerSlot,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import {
  seedanceReferencePreview,
  seedanceReferenceVisual,
} from "@/lib/studio-reference-previews";
import { cn } from "@/lib/utils";

export { StudioMobileInputsContent } from "@/components/studio/studio-mobile-inputs-content";

const STUDIO_COMPOSER_TILE_CLASS_NAME = "h-[82px] w-[82px]";
const STUDIO_COMPOSER_ADD_TILE_CLASS_NAME = `${STUDIO_COMPOSER_TILE_CLASS_NAME} rounded-[22px]`;
const STUDIO_COMPOSER_PLUS_ICON_CLASS_NAME = "size-4.5";

type StudioSeedanceReferenceStripProps = {
  isDragActive: boolean;
  referenceImages: AttachmentRecord[];
  referenceVideos: AttachmentRecord[];
  referenceAudios: AttachmentRecord[];
  maxImageReferences: number;
  maxVideoReferences: number;
  maxAudioReferences: number;
  buildAttachmentPreview: AttachmentPreviewBuilder;
  onSetDragActive: (value: boolean) => void;
  onReferenceDrop: (
    event: DragEvent<HTMLDivElement>,
    kind: "images" | "videos" | "audios",
  ) => void;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onAddFiles: StudioAddFilesHandler;
  onResetFileInput: (input: HTMLInputElement | null) => void;
};

export function StudioSeedanceReferenceStrip({
  isDragActive,
  referenceImages,
  referenceVideos,
  referenceAudios,
  maxImageReferences,
  maxVideoReferences,
  maxAudioReferences,
  buildAttachmentPreview,
  onSetDragActive,
  onReferenceDrop,
  onOpenPreview,
  onRemoveAttachment,
  onAddFiles,
  onResetFileInput,
}: StudioSeedanceReferenceStripProps) {
  const groups = [
    {
      key: "images" as const,
      label: "Image refs",
      tokenHint: "image@",
      attachments: referenceImages,
      accept: "image/*",
      maxLabel: maxImageReferences,
      tileClassName: STUDIO_COMPOSER_TILE_CLASS_NAME,
      addTileClassName: STUDIO_COMPOSER_ADD_TILE_CLASS_NAME,
      plusIconClassName: STUDIO_COMPOSER_PLUS_ICON_CLASS_NAME,
      maxVisibleTiles: 4,
    },
    {
      key: "videos" as const,
      label: "Video refs",
      tokenHint: "video@",
      attachments: referenceVideos,
      accept: "video/*",
      maxLabel: maxVideoReferences,
      tileClassName: STUDIO_COMPOSER_TILE_CLASS_NAME,
      addTileClassName: STUDIO_COMPOSER_ADD_TILE_CLASS_NAME,
      plusIconClassName: STUDIO_COMPOSER_PLUS_ICON_CLASS_NAME,
      maxVisibleTiles: 3,
    },
    {
      key: "audios" as const,
      label: "Audio refs",
      tokenHint: "audio@",
      attachments: referenceAudios,
      accept: "audio/*",
      maxLabel: maxAudioReferences,
      tileClassName: STUDIO_COMPOSER_TILE_CLASS_NAME,
      addTileClassName: STUDIO_COMPOSER_ADD_TILE_CLASS_NAME,
      plusIconClassName: STUDIO_COMPOSER_PLUS_ICON_CLASS_NAME,
      maxVisibleTiles: 3,
    },
  ];

  return (
    <div className="studio-composer-input-panel rounded-[26px] px-4 py-3 backdrop-blur-2xl">
      <div className="studio-meta-label mb-3">Seedance References</div>
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.85fr)_minmax(260px,0.85fr)]">
        {groups.map((group) => (
          <div
            key={group.key}
            data-testid={`seedance-group-${group.key}`}
            onDragOver={(event) => {
              event.preventDefault();
              onSetDragActive(true);
            }}
            onDragLeave={() => onSetDragActive(false)}
            onDrop={(event) => onReferenceDrop(event, group.key)}
            className={cn(
              "studio-composer-reference-group relative rounded-[20px] px-3 py-2.5 transition",
              isDragActive ? "studio-composer-reference-group-active" : "",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {group.label}{" "}
                  <span className="text-[var(--text-subtle)]">
                    - {group.tokenHint}
                  </span>
                </div>
              </div>
              <div className="studio-composer-count-badge shrink-0 rounded-full px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.12em]">
                {group.attachments.length}
                {` / ${group.maxLabel}`}
              </div>
            </div>
            <div className="scrollbar-none flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pb-0.5">
              {group.attachments
                .slice(0, group.maxVisibleTiles)
                .map((attachment) => (
                  <StudioStagedMediaTile
                    key={attachment.id}
                    preview={seedanceReferencePreview(
                      attachment,
                      group.key,
                      buildAttachmentPreview,
                    )}
                    visualUrl={seedanceReferenceVisual(attachment)}
                    onOpenPreview={onOpenPreview}
                    onRemove={() => onRemoveAttachment(attachment.id)}
                    className={cn("shrink-0", group.tileClassName)}
                    testId={`seedance-group-tile-${group.key}-${attachment.id}`}
                  />
                ))}
              {group.attachments.length < group.maxLabel ? (
                <label
                  className={cn(
                    "studio-composer-add-control flex shrink-0 cursor-pointer items-center justify-center transition",
                    group.addTileClassName,
                  )}
                >
                  {(() => {
                    const AddIcon = studioMediaSlotAddTileIcon(
                      group.key === "videos"
                        ? "video"
                        : group.key === "audios"
                          ? "audio"
                          : "image",
                    );
                    return <AddIcon className={group.plusIconClassName} />;
                  })()}
                  <input
                    type="file"
                    multiple
                    accept={group.accept}
                    data-testid={`seedance-group-input-${group.key}`}
                    className="hidden"
                    onChange={(event) => {
                      onAddFiles(event.target.files, {
                        role: "reference",
                        allowedKinds: [group.key],
                      });
                      onResetFileInput(event.currentTarget);
                    }}
                  />
                </label>
              ) : null}
              {group.attachments.length > group.maxVisibleTiles ? (
                <div
                  className={cn(
                    "studio-composer-muted-tile flex shrink-0 items-center justify-center text-[0.58rem] font-semibold uppercase tracking-[0.12em]",
                    group.addTileClassName,
                  )}
                >
                  +{group.attachments.length - group.maxVisibleTiles}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
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
  onRemoveAttachment,
  onClearStandardComposerSlot,
  onPickStandardComposerSlotFiles,
  onAddFiles,
  onResetFileInput,
}: StudioSourceAttachmentStripProps) {
  return (
    <div className="flex flex-wrap gap-3">
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
                className="flex flex-col gap-2"
              >
                {!attachment ? (
                  <div className="studio-meta-label">{slot.label}</div>
                ) : null}
                <div
                  data-testid={`seedance-slot-${slot.role}`}
                  className={cn("relative", STUDIO_COMPOSER_TILE_CLASS_NAME)}
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
                        onOpenPreview={onOpenPreview}
                        onRemove={() => onRemoveAttachment(attachment.id)}
                        replaceControl={
                          <StudioStagedMediaReplaceControl
                            label={`Replace ${slot.label.toLowerCase()}`}
                            accept="image/*"
                            testId={`seedance-slot-input-${slot.role}`}
                            appearance="seedance-frame"
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
                              onRemoveAttachment(attachment.id);
                              onAddFiles(files, {
                                role: slot.role,
                                allowedKinds: ["images"],
                              });
                              onResetFileInput(input);
                            }}
                          />
                        }
                        className="h-full w-full"
                        testId={`seedance-slot-filled-${slot.role}`}
                      />
                    </div>
                  ) : (
                    <StudioMediaSlotAddTile
                      accept="image/*"
                      isDragActive={isDragActive}
                      testId={`seedance-slot-input-${slot.role}`}
                      required={slot.role === "first_frame"}
                      wrapperClassName="h-full w-full"
                      tileClassName="h-full w-full"
                      onDragOver={(event) => {
                        event.preventDefault();
                        onSetDragActive(true);
                      }}
                      onDragLeave={() => onSetDragActive(false)}
                      onDrop={(event) => onDropIntoSourceSlot(event, slotIndex)}
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
