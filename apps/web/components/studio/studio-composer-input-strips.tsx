"use client";

import type { DragEvent } from "react";

import { ImagePlus } from "lucide-react";

import { StudioMediaSlotAddTile, studioMediaSlotAddTileIcon } from "@/components/studio/studio-media-slot-add-tile";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import { StudioStandardSlotRail } from "@/components/studio/studio-standard-slot-rail";
import type {
  AssetPreviewBuilder,
  AttachmentPreviewBuilder,
  StudioAddFilesHandler,
} from "@/components/studio/studio-composer-input-types";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import {
  mediaDisplayUrl,
  mediaThumbnailUrl,
  orderedImageInputKey,
  orderedImageInputVisual,
  type OrderedImageInput,
  type StudioComposerSlot,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

export { StudioMobileInputsContent } from "@/components/studio/studio-mobile-inputs-content";

type StudioMultiImageReferenceStripProps = {
  imageLimitLabel: string | null;
  orderedImageInputs: OrderedImageInput[];
  canAddMoreImages: boolean;
  isDragActive: boolean;
  buildOrderedImageInputPreview: (slot: OrderedImageInput | null, label: string, previewKey: string) => StudioReferencePreview | null;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  onClearOrderedImageInput: (slot: OrderedImageInput | null) => void;
  onSetDragActive: (value: boolean) => void;
  onDropIntoSlot: (event: DragEvent<HTMLLabelElement>, slotIndex: number) => void;
  onAddImageFilesToOrderedSlot: (fileList: FileList | null, slotIndex: number, input: HTMLInputElement) => void;
};

export function StudioMultiImageReferenceStrip({
  imageLimitLabel,
  orderedImageInputs,
  canAddMoreImages,
  isDragActive,
  buildOrderedImageInputPreview,
  onOpenPreview,
  onClearOrderedImageInput,
  onSetDragActive,
  onDropIntoSlot,
  onAddImageFilesToOrderedSlot,
}: StudioMultiImageReferenceStripProps) {
  return (
    <div className="studio-composer-input-panel overflow-hidden rounded-[26px] px-4 py-3 backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="studio-meta-label">Image references</div>
        {imageLimitLabel ? (
          <div className="studio-composer-muted-tile rounded-full px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em]">
            {imageLimitLabel}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 items-start gap-3 overflow-x-auto overflow-y-hidden pb-1">
        {orderedImageInputs.map((slot, slotIndex) => {
          const slotVisual = orderedImageInputVisual(slot);
          const slotLabel = `Image reference ${slotIndex + 1}`;
          const slotPreview = buildOrderedImageInputPreview(slot, slotLabel, `multi-image-${slotIndex + 1}`);
          return (
            <div key={orderedImageInputKey(slot, slotIndex)} className="flex shrink-0 flex-col gap-2">
              {slotPreview ? (
                <StudioStagedMediaTile
                  preview={slotPreview}
                  visualUrl={slotVisual}
                  onOpenPreview={onOpenPreview}
                  onRemove={() => onClearOrderedImageInput(slot)}
                  className="h-[82px] w-[82px]"
                  tileClassName="studio-composer-accent-border-soft"
                  testId={`studio-multi-image-slot-${slotIndex + 1}`}
                />
              ) : null}
            </div>
          );
        })}

        {canAddMoreImages ? (
          <StudioMediaSlotAddTile
            accept="image/*"
            multiple
            isDragActive={isDragActive}
            testId="studio-multi-image-input"
            onDragOver={(event) => {
              event.preventDefault();
              onSetDragActive(true);
            }}
            onDragLeave={() => onSetDragActive(false)}
            onDrop={(event) => onDropIntoSlot(event, orderedImageInputs.length)}
            onPickFiles={(fileList, input) => {
              onAddImageFilesToOrderedSlot(fileList, orderedImageInputs.length, input);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

type StudioSeedanceReferenceStripProps = {
  isDragActive: boolean;
  referenceImages: AttachmentRecord[];
  referenceVideos: AttachmentRecord[];
  referenceAudios: AttachmentRecord[];
  buildAttachmentPreview: AttachmentPreviewBuilder;
  onSetDragActive: (value: boolean) => void;
  onReferenceDrop: (event: DragEvent<HTMLDivElement>, kind: "images" | "videos" | "audios") => void;
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
      maxLabel: "9",
      tileClassName: "h-[82px] w-[82px]",
      addTileClassName: "h-[82px] w-[82px] rounded-[22px]",
      plusIconClassName: "size-4.5",
      maxVisibleTiles: 4,
    },
    {
      key: "videos" as const,
      label: "Video refs",
      tokenHint: "video@",
      attachments: referenceVideos,
      accept: "video/*",
      maxLabel: "3",
      tileClassName: "h-[82px] w-[82px]",
      addTileClassName: "h-[82px] w-[82px] rounded-[22px]",
      plusIconClassName: "size-4.5",
      maxVisibleTiles: 3,
    },
    {
      key: "audios" as const,
      label: "Audio refs",
      tokenHint: "audio@",
      attachments: referenceAudios,
      accept: "audio/*",
      maxLabel: "3",
      tileClassName: "h-[82px] w-[82px]",
      addTileClassName: "h-[82px] w-[82px] rounded-[22px]",
      plusIconClassName: "size-4.5",
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
                  {group.label} <span className="text-[var(--text-subtle)]">- {group.tokenHint}</span>
                </div>
              </div>
              <div className="studio-composer-count-badge shrink-0 rounded-full px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.12em]">
                {group.attachments.length}
                {` / ${group.maxLabel}`}
              </div>
            </div>
            <div className="scrollbar-none flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pb-0.5">
              {group.attachments.slice(0, group.maxVisibleTiles).map((attachment) => (
                <StudioStagedMediaTile
                  key={attachment.id}
                  preview={
                    buildAttachmentPreview(
                      attachment,
                      attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference",
                      `${group.key}-${attachment.id}`,
                    ) ?? {
                      key: `attachment:${attachment.id}`,
                      label: attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference",
                      url: attachment.previewUrl ?? attachment.referenceRecord?.stored_url ?? "",
                      kind: attachment.kind,
                      posterUrl: attachment.referenceRecord?.poster_url ?? null,
                    }
                  }
                  visualUrl={
                    attachment.kind === "audios"
                      ? null
                      : attachment.previewUrl ?? attachment.referenceRecord?.thumb_url ?? attachment.referenceRecord?.stored_url ?? null
                  }
                  onOpenPreview={onOpenPreview}
                  onRemove={() => onRemoveAttachment(attachment.id)}
                  className={cn("shrink-0", group.tileClassName)}
                  testId={`seedance-group-tile-${group.key}-${attachment.id}`}
                />
              ))}
              {group.attachments.length < Number(group.maxLabel) ? (
                <label className={cn("studio-composer-add-control flex shrink-0 cursor-pointer items-center justify-center transition", group.addTileClassName)}>
                  {(() => {
                    const AddIcon = studioMediaSlotAddTileIcon(
                      group.key === "videos" ? "video" : group.key === "audios" ? "audio" : "image",
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
                <div className={cn("studio-composer-muted-tile flex shrink-0 items-center justify-center text-[0.58rem] font-semibold uppercase tracking-[0.12em]", group.addTileClassName)}>
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
  seedanceComposer: boolean;
  standardComposerUsesExplicitSlots: boolean;
  genericSourceInputsAvailable: boolean;
  isDragActive: boolean;
  seedanceFirstFrameAttachment: AttachmentRecord | null;
  seedanceLastFrameAttachment: AttachmentRecord | null;
  standardComposerSlots: StudioComposerSlot[];
  orderedImageInputs: OrderedImageInput[];
  currentSourceAsset: MediaAsset | null;
  canUseSourceAsset: boolean;
  attachments: AttachmentRecord[];
  genericSourceAddTileVisible: boolean;
  imageLimitLabel: string | null;
  maxVideoInputs: number;
  maxAudioInputs: number;
  explicitVideoImageSlots: boolean;
  explicitMotionControlSlots: boolean;
  stagedVideoCount: number;
  stagedAudioCount: number;
  mobileAddTileClassName: string;
  mobileAddTilePlusIconClassName: string;
  buildAttachmentPreview: AttachmentPreviewBuilder;
  buildAssetReferencePreview: AssetPreviewBuilder;
  standardComposerSlotPreview: (slot: StudioComposerSlot, previewKey: string) => StudioReferencePreview | null;
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
  onClearSourceAsset: () => void;
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
  seedanceComposer,
  standardComposerUsesExplicitSlots,
  genericSourceInputsAvailable,
  isDragActive,
  seedanceFirstFrameAttachment,
  seedanceLastFrameAttachment,
  standardComposerSlots,
  orderedImageInputs,
  currentSourceAsset,
  canUseSourceAsset,
  attachments,
  genericSourceAddTileVisible,
  imageLimitLabel,
  maxVideoInputs,
  maxAudioInputs,
  explicitVideoImageSlots,
  explicitMotionControlSlots,
  stagedVideoCount,
  stagedAudioCount,
  mobileAddTileClassName,
  mobileAddTilePlusIconClassName,
  buildAttachmentPreview,
  buildAssetReferencePreview,
  standardComposerSlotPreview,
  standardComposerSlotVisual,
  onSetDragActive,
  onSetFormWarning,
  onDropIntoSourceSlot,
  onOpenPreview,
  onRemoveAttachment,
  onClearSourceAsset,
  onClearStandardComposerSlot,
  onPickStandardComposerSlotFiles,
  onAddFiles,
  onResetFileInput,
}: StudioSourceAttachmentStripProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {seedanceComposer ? (
        <>
          {[
            { label: "Start frame", role: "first_frame" as const, attachment: seedanceFirstFrameAttachment },
            { label: "End frame", role: "last_frame" as const, attachment: seedanceLastFrameAttachment },
          ].map((slot, slotIndex) => {
            const attachment = slot.attachment;
            const attachmentPreview = attachment ? buildAttachmentPreview(attachment, slot.label, `seedance-${slot.role}`) : null;
            return (
              <div key={`seedance-slot-${slot.role}`} className="flex flex-col gap-2">
                {!attachment ? (
                  <div className="studio-meta-label">{slot.label}</div>
                ) : null}
                <div data-testid={`seedance-slot-${slot.role}`} className="relative h-[82px] w-[82px]">
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
                          <label className="studio-composer-replace-control inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition">
                            <ImagePlus className="size-3.5" />
                            <input
                              type="file"
                              accept="image/*"
                              data-testid={`seedance-slot-input-${slot.role}`}
                              className="hidden"
                              onChange={(event) => {
                                if (slot.role === "last_frame" && !seedanceFirstFrameAttachment) {
                                  onSetFormWarning("Add a start frame before the end frame.");
                                  onResetFileInput(event.currentTarget);
                                  return;
                                }
                                onRemoveAttachment(attachment.id);
                                onAddFiles(event.target.files, {
                                  role: slot.role,
                                  allowedKinds: ["images"],
                                });
                                onResetFileInput(event.currentTarget);
                              }}
                            />
                          </label>
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
                        if (slot.role === "last_frame" && !seedanceFirstFrameAttachment) {
                          onSetFormWarning("Add a start frame before the end frame.");
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
      ) : standardComposerUsesExplicitSlots ? (
        <StudioStandardSlotRail
          slots={standardComposerSlots}
          isDragActive={isDragActive}
          mobileAddTileClassName={mobileAddTileClassName}
          mobileAddTilePlusIconClassName={mobileAddTilePlusIconClassName}
          buildPreview={standardComposerSlotPreview}
          resolveVisualUrl={standardComposerSlotVisual}
          isAssetBackedImageSlot={(slot) => slot.kind === "image" && orderedImageInputs[slot.slotIndex]?.source === "asset"}
          onSetDragActive={onSetDragActive}
          onSlotDrop={(event, slot) => onDropIntoSourceSlot(event, slot.slotIndex, slot)}
          onOpenPreview={onOpenPreview}
          onClearSlot={onClearStandardComposerSlot}
          onPickFiles={onPickStandardComposerSlotFiles}
        />
      ) : (
        <>
          {canUseSourceAsset && currentSourceAsset ? (
            <StudioStagedMediaTile
              preview={
                buildAssetReferencePreview(currentSourceAsset, currentSourceAsset.prompt_summary ?? "Source asset") ?? {
                  key: `asset:${currentSourceAsset.asset_id}`,
                  label: currentSourceAsset.prompt_summary ?? "Source asset",
                  url: mediaThumbnailUrl(currentSourceAsset) ?? "",
                  kind: currentSourceAsset.generation_kind === "video" ? "videos" : "images",
                  posterUrl: mediaThumbnailUrl(currentSourceAsset) ?? null,
                }
              }
              visualUrl={mediaThumbnailUrl(currentSourceAsset) ?? mediaDisplayUrl(currentSourceAsset)}
              onOpenPreview={onOpenPreview}
              onRemove={onClearSourceAsset}
              className="h-[82px] w-[82px]"
              tileClassName="studio-composer-accent-border"
              testId="studio-source-asset-tile"
            />
          ) : null}

          {attachments.slice(0, 4).map((attachment) => (
            <StudioStagedMediaTile
              key={attachment.id}
              preview={
                buildAttachmentPreview(
                  attachment,
                  attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference",
                  attachment.id,
                ) ?? {
                  key: `attachment:${attachment.id}`,
                  label: attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference",
                  url: attachment.previewUrl ?? attachment.referenceRecord?.stored_url ?? "",
                  kind: attachment.kind,
                  posterUrl: attachment.referenceRecord?.poster_url ?? null,
                }
              }
              visualUrl={
                attachment.kind === "audios"
                  ? null
                  : attachment.previewUrl ?? attachment.referenceRecord?.thumb_url ?? attachment.referenceRecord?.stored_url ?? null
              }
              footerLabel={attachment.kind === "images" ? "Image" : attachment.kind === "videos" ? "Video" : "Audio"}
              onOpenPreview={onOpenPreview}
              onRemove={() => onRemoveAttachment(attachment.id)}
              className="h-[82px] w-[82px]"
              testId={`studio-attachment-tile-${attachment.id}`}
            />
          ))}

          {attachments.length > 4 ? (
            <div className="studio-composer-muted-tile flex h-[82px] w-[82px] items-center justify-center rounded-[24px] text-center text-[0.62rem] font-semibold uppercase tracking-[0.14em]">
              +{attachments.length - 4} more
            </div>
          ) : null}

          {genericSourceAddTileVisible ? (
            <StudioMediaSlotAddTile
              accept="image/*,video/*,audio/*"
              multiple
              disabled={!genericSourceAddTileVisible}
              isDragActive={isDragActive}
              testId="studio-source-input"
              onDragOver={(event) => {
                event.preventDefault();
                onSetDragActive(true);
              }}
              onDragLeave={() => onSetDragActive(false)}
              onDrop={(event) => onDropIntoSourceSlot(event)}
              onPickFiles={(fileList, input) => {
                onAddFiles(fileList);
                onResetFileInput(input);
              }}
            />
          ) : null}
        </>
      )}
      {(imageLimitLabel || maxVideoInputs > 0 || maxAudioInputs > 0) &&
      !explicitVideoImageSlots &&
      !explicitMotionControlSlots &&
      !seedanceComposer ? (
        <div className="studio-composer-muted-tile flex min-h-[82px] min-w-[120px] flex-col justify-center rounded-[24px] px-3 py-2">
          {imageLimitLabel ? (
            <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em]">{imageLimitLabel}</div>
          ) : null}
          {maxVideoInputs > 0 ? (
            <div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
              {stagedVideoCount} / {maxVideoInputs} videos
            </div>
          ) : null}
          {maxAudioInputs > 0 ? (
            <div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
              {stagedAudioCount} / {maxAudioInputs} audio
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
