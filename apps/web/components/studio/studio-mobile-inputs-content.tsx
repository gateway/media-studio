"use client";

import type { DragEvent } from "react";

import { StudioMediaSlotAddTile, studioMediaSlotAddTileIcon } from "@/components/studio/studio-media-slot-add-tile";
import { StudioMobileInputsGroup, StudioMobileInputsSection } from "@/components/studio/studio-mobile-inputs-section";
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

type StudioMobileInputsContentProps = {
  dedicatedImageReferenceRailActive: boolean;
  seedanceComposer: boolean;
  standardComposerUsesExplicitSlots: boolean;
  sourceAttachmentStripVisible: boolean;
  effectiveSeedanceMode: string;
  imageLimitLabel: string | null;
  orderedImageInputs: OrderedImageInput[];
  canAddMoreImages: boolean;
  isDragActive: boolean;
  seedanceFirstFrameAttachment: AttachmentRecord | null;
  seedanceLastFrameAttachment: AttachmentRecord | null;
  seedanceReferenceImages: AttachmentRecord[];
  seedanceReferenceVideos: AttachmentRecord[];
  seedanceReferenceAudios: AttachmentRecord[];
  standardComposerSectionTitle: string;
  standardComposerSummaryLabel: string | null;
  standardComposerSlots: StudioComposerSlot[];
  currentSourceAsset: MediaAsset | null;
  canUseSourceAsset: boolean;
  attachments: AttachmentRecord[];
  genericSourceAddTileVisible: boolean;
  stagedVideoCount: number;
  stagedAudioCount: number;
  mobileAddTileClassName: string;
  mobileAddTilePlusIconClassName: string;
  buildOrderedImageInputPreview: (slot: OrderedImageInput | null, label: string, previewKey: string) => StudioReferencePreview | null;
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
  onSeedanceReferenceDrop: (event: DragEvent<HTMLDivElement>, kind: "images" | "videos" | "audios") => void;
  onOpenPreview: (preview: StudioReferencePreview | null) => void;
  onClearOrderedImageInput: (slot: OrderedImageInput | null) => void;
  onClearSourceAsset: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onClearStandardComposerSlot: (slot: StudioComposerSlot) => void;
  onPickStandardComposerSlotFiles: (
    slot: StudioComposerSlot,
    fileList: FileList | File[] | null,
    input?: HTMLInputElement | null,
    replaceFilled?: boolean,
  ) => void;
  onAddFiles: StudioAddFilesHandler;
  onAddImageFilesToOrderedSlot: (fileList: FileList | null, slotIndex: number, input: HTMLInputElement) => void;
  onResetFileInput: (input: HTMLInputElement | null) => void;
};

export function StudioMobileInputsContent({
  dedicatedImageReferenceRailActive,
  seedanceComposer,
  standardComposerUsesExplicitSlots,
  sourceAttachmentStripVisible,
  effectiveSeedanceMode,
  imageLimitLabel,
  orderedImageInputs,
  canAddMoreImages,
  isDragActive,
  seedanceFirstFrameAttachment,
  seedanceLastFrameAttachment,
  seedanceReferenceImages,
  seedanceReferenceVideos,
  seedanceReferenceAudios,
  standardComposerSectionTitle,
  standardComposerSummaryLabel,
  standardComposerSlots,
  currentSourceAsset,
  canUseSourceAsset,
  attachments,
  genericSourceAddTileVisible,
  stagedVideoCount,
  stagedAudioCount,
  mobileAddTileClassName,
  mobileAddTilePlusIconClassName,
  buildOrderedImageInputPreview,
  buildAttachmentPreview,
  buildAssetReferencePreview,
  standardComposerSlotPreview,
  standardComposerSlotVisual,
  onSetDragActive,
  onSetFormWarning,
  onDropIntoSourceSlot,
  onSeedanceReferenceDrop,
  onOpenPreview,
  onClearOrderedImageInput,
  onClearSourceAsset,
  onRemoveAttachment,
  onClearStandardComposerSlot,
  onPickStandardComposerSlotFiles,
  onAddFiles,
  onAddImageFilesToOrderedSlot,
  onResetFileInput,
}: StudioMobileInputsContentProps) {
  if (dedicatedImageReferenceRailActive) {
    return (
      <StudioMobileInputsSection title="Image references" summary={imageLimitLabel}>
        <div className="flex min-w-0 items-start gap-2 overflow-x-auto overflow-y-hidden pb-1">
          {orderedImageInputs.map((slot, slotIndex) => {
            const slotVisual = orderedImageInputVisual(slot);
            const slotLabel = `Image reference ${slotIndex + 1}`;
            const slotPreview = buildOrderedImageInputPreview(slot, slotLabel, `mobile-multi-image-${slotIndex + 1}`);
            return slotPreview ? (
              <StudioStagedMediaTile
                key={orderedImageInputKey(slot, slotIndex)}
                preview={slotPreview}
                visualUrl={slotVisual}
                onOpenPreview={onOpenPreview}
                onRemove={() => onClearOrderedImageInput(slot)}
                className="h-[72px] w-[72px] shrink-0"
                tileClassName="border-[rgba(216,141,67,0.2)]"
                testId={`studio-mobile-multi-image-slot-${slotIndex + 1}`}
              />
            ) : null;
          })}
          {canAddMoreImages ? (
            <StudioMediaSlotAddTile
              accept="image/*"
              multiple
              isDragActive={isDragActive}
              testId="studio-mobile-multi-image-input"
              wrapperClassName="shrink-0"
              tileClassName={mobileAddTileClassName}
              plusIconClassName={mobileAddTilePlusIconClassName}
              onDragOver={(event) => {
                event.preventDefault();
                onSetDragActive(true);
              }}
              onDragLeave={() => onSetDragActive(false)}
              onDrop={(event) => onDropIntoSourceSlot(event, orderedImageInputs.length)}
              onPickFiles={(fileList, input) => {
                onAddImageFilesToOrderedSlot(fileList, orderedImageInputs.length, input);
              }}
            />
          ) : null}
        </div>
      </StudioMobileInputsSection>
    );
  }

  if (seedanceComposer) {
    const groups = [
      {
        key: "images" as const,
        label: "Image refs",
        tokenHint: "image@",
        attachments: seedanceReferenceImages,
        accept: "image/*",
        maxLabel: "9",
        tileClassName: "h-[72px] w-[72px]",
        addTileClassName: mobileAddTileClassName,
        plusIconClassName: mobileAddTilePlusIconClassName,
        maxVisibleTiles: 4,
      },
      {
        key: "videos" as const,
        label: "Video refs",
        tokenHint: "video@",
        attachments: seedanceReferenceVideos,
        accept: "video/*",
        maxLabel: "3",
        tileClassName: "h-[72px] w-[72px]",
        addTileClassName: mobileAddTileClassName,
        plusIconClassName: mobileAddTilePlusIconClassName,
        maxVisibleTiles: 3,
      },
      {
        key: "audios" as const,
        label: "Audio refs",
        tokenHint: "audio@",
        attachments: seedanceReferenceAudios,
        accept: "audio/*",
        maxLabel: "3",
        tileClassName: "h-[72px] w-[72px]",
        addTileClassName: mobileAddTileClassName,
        plusIconClassName: mobileAddTilePlusIconClassName,
        maxVisibleTiles: 3,
      },
    ];

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
            <div className="scrollbar-none flex min-w-0 items-start gap-2 overflow-x-auto overflow-y-hidden pb-1">
              {[
                { label: "Start frame", role: "first_frame" as const, attachment: seedanceFirstFrameAttachment },
                ...(effectiveSeedanceMode === "first_last_frames"
                  ? [{ label: "End frame", role: "last_frame" as const, attachment: seedanceLastFrameAttachment }]
                  : []),
              ].map((slot, slotIndex) => {
                const attachmentPreview = slot.attachment
                  ? buildAttachmentPreview(slot.attachment, slot.label, `mobile-seedance-${slot.role}`)
                  : null;
                return (
                  <div key={`mobile-seedance-${slot.role}`} className="shrink-0">
                    {slot.attachment && attachmentPreview ? (
                      <div
                        onDragOver={(event) => {
                          event.preventDefault();
                          onSetDragActive(true);
                        }}
                        onDragLeave={() => onSetDragActive(false)}
                        onDrop={(event) => onDropIntoSourceSlot(event, slotIndex)}
                        className="h-[72px] w-[72px]"
                      >
                        <StudioStagedMediaTile
                          preview={attachmentPreview}
                          visualUrl={slot.attachment.previewUrl}
                          onOpenPreview={onOpenPreview}
                          onRemove={() => onRemoveAttachment(slot.attachment?.id ?? "")}
                          className="h-[72px] w-[72px]"
                          testId={`studio-mobile-seedance-slot-${slot.role}`}
                        />
                      </div>
                    ) : (
                      <StudioMediaSlotAddTile
                        accept="image/*"
                        isDragActive={isDragActive}
                        testId={`studio-mobile-seedance-slot-input-${slot.role}`}
                        required={slot.role === "first_frame"}
                        wrapperClassName="shrink-0"
                        tileClassName={mobileAddTileClassName}
                        plusIconClassName={mobileAddTilePlusIconClassName}
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
                );
              })}
            </div>
          </StudioMobileInputsGroup>

          {groups.map((group) => (
            <StudioMobileInputsGroup
              key={`mobile-${group.key}`}
              label={`${group.label} - ${group.tokenHint}`}
              summary={`${group.attachments.length} / ${group.maxLabel}`}
            >
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  onSetDragActive(true);
                }}
                onDragLeave={() => onSetDragActive(false)}
                onDrop={(event) => onSeedanceReferenceDrop(event, group.key)}
                className={cn(
                  "rounded-[18px] border border-white/8 bg-white/[0.025] p-2 transition",
                  isDragActive ? "border-[rgba(216,141,67,0.3)] bg-[rgba(32,38,35,0.9)]" : "",
                )}
              >
                <div className="scrollbar-none flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden pb-1">
                  {group.attachments.slice(0, group.maxVisibleTiles).map((attachment) => (
                    <StudioStagedMediaTile
                      key={attachment.id}
                      preview={
                        buildAttachmentPreview(
                          attachment,
                          attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference",
                          `mobile-${group.key}-${attachment.id}`,
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
                      testId={`studio-mobile-seedance-group-tile-${group.key}-${attachment.id}`}
                    />
                  ))}
                  {group.attachments.length < Number(group.maxLabel) ? (
                    <label className={cn("flex shrink-0 cursor-pointer items-center justify-center border border-dashed border-white/12 bg-white/[0.05] text-white/82 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-white/[0.09]", group.addTileClassName)}>
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
                        data-testid={`studio-mobile-seedance-group-input-${group.key}`}
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
                    <div className={cn("flex shrink-0 items-center justify-center border border-white/8 bg-white/[0.04] text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-white/58", group.addTileClassName)}>
                      +{group.attachments.length - group.maxVisibleTiles}
                    </div>
                  ) : null}
                </div>
              </div>
            </StudioMobileInputsGroup>
          ))}
        </div>
      </StudioMobileInputsSection>
    );
  }

  if (standardComposerUsesExplicitSlots) {
    return (
      <StudioMobileInputsSection title={standardComposerSectionTitle} summary={standardComposerSummaryLabel}>
        <div className="flex min-w-0 items-start gap-2 overflow-x-auto overflow-y-hidden pb-1">
          <StudioStandardSlotRail
            slots={standardComposerSlots}
            mobile
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
        </div>
      </StudioMobileInputsSection>
    );
  }

  if (!sourceAttachmentStripVisible) {
    return null;
  }

  return (
    <StudioMobileInputsSection
      title="Inputs"
      summary={
        imageLimitLabel
          ? imageLimitLabel
          : stagedVideoCount || stagedAudioCount
            ? `${stagedVideoCount} videos · ${stagedAudioCount} audio`
            : null
      }
    >
      <div className="flex min-w-0 items-start gap-2 overflow-x-auto overflow-y-hidden pb-1">
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
            className="h-[72px] w-[72px] shrink-0"
            tileClassName="border-[rgba(216,141,67,0.24)]"
            testId="studio-mobile-source-asset-tile"
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
            className="h-[72px] w-[72px] shrink-0"
            testId={`studio-mobile-attachment-tile-${attachment.id}`}
          />
        ))}

        {attachments.length > 4 ? (
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.04] text-center text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/58">
            +{attachments.length - 4}
          </div>
        ) : null}

        {genericSourceAddTileVisible ? (
          <StudioMediaSlotAddTile
            accept="image/*,video/*,audio/*"
            multiple
            disabled={!genericSourceAddTileVisible}
            isDragActive={isDragActive}
            testId="studio-mobile-source-input"
            wrapperClassName="shrink-0"
            tileClassName={mobileAddTileClassName}
            plusIconClassName={mobileAddTilePlusIconClassName}
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
      </div>
    </StudioMobileInputsSection>
  );
}
