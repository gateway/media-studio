"use client";

import { Check, Copy, Play, X } from "lucide-react";

import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { StatusPill } from "@/components/status-pill";
import { SelectedAssetPromptPanelContent } from "@/components/studio/selected-asset-prompt-panel-content";
import { StudioInspectorActions } from "@/components/studio/studio-inspector-actions";
import { StudioInspectorInfo } from "@/components/studio/studio-inspector-info";
import type { StructuredPresetImageSlot, StructuredPresetTextField, StudioReferencePreview } from "@/lib/media-studio-helpers";
import { mediaDownloadUrl, toneForStatus } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

type StudioAssetInspectorProps = {
  selectedAsset: MediaAsset;
  selectedAssetDisplayVisual: string | null;
  selectedAssetPlaybackVisual: string | null;
  selectedAssetPrompt: string | null;
  selectedAssetStructuredPresetActive: boolean;
  selectedAssetPresetLabel: string | null;
  selectedAssetPresetDescription: string | null;
  selectedAssetPresetSlots: StructuredPresetImageSlot[];
  selectedAssetPresetSlotValues: Record<string, unknown>;
  selectedAssetPresetFields: StructuredPresetTextField[];
  selectedAssetPresetInputValues: Record<string, string>;
  selectedAssetProjectLabel: string | null;
  selectedAssetReferencePreviews: StudioReferencePreview[];
  favoriteAssetIdBusy: string | number | null;
  copyPromptStatus: "idle" | "copied" | "error";
  mobileInspectorPromptOpen: boolean;
  mobileInspectorInfoOpen: boolean;
  downloadActionLabel: string;
  showReviseAction: boolean;
  onClose: () => void;
  onOpenLightbox: () => void;
  onCopyPrompt: () => void;
  onToggleFavorite: (asset: MediaAsset | null) => void;
  onOpenProject: (projectId: string | null) => void;
  onOpenReference: (reference: StudioReferencePreview | null) => void;
  onMobileInspectorPromptOpenChange: (open: boolean) => void;
  onMobileInspectorInfoOpenChange: (open: boolean) => void;
  onDownload: () => void;
  onDismiss: () => void;
  onAnimate: () => void;
  onUseImage: () => void;
  onRevise: () => void;
};

export function StudioAssetInspector({
  selectedAsset,
  selectedAssetDisplayVisual,
  selectedAssetPlaybackVisual,
  selectedAssetPrompt,
  selectedAssetStructuredPresetActive,
  selectedAssetPresetLabel,
  selectedAssetPresetDescription,
  selectedAssetPresetSlots,
  selectedAssetPresetSlotValues,
  selectedAssetPresetFields,
  selectedAssetPresetInputValues,
  selectedAssetProjectLabel,
  selectedAssetReferencePreviews,
  favoriteAssetIdBusy,
  copyPromptStatus,
  mobileInspectorPromptOpen,
  mobileInspectorInfoOpen,
  downloadActionLabel,
  showReviseAction,
  onClose,
  onOpenLightbox,
  onCopyPrompt,
  onToggleFavorite,
  onOpenProject,
  onOpenReference,
  onMobileInspectorPromptOpenChange,
  onMobileInspectorInfoOpenChange,
  onDownload,
  onDismiss,
  onAnimate,
  onUseImage,
  onRevise,
}: StudioAssetInspectorProps) {
  return (
    <div data-testid="studio-inspector" className="studio-inspector-backdrop fixed inset-0 z-[120] overflow-y-auto overscroll-contain backdrop-blur-md [webkit-overflow-scrolling:touch]">
      <div className="min-h-dvh p-0 lg:p-6">
        <div className="studio-inspector-shell grid min-h-dvh content-start gap-4 px-3 pb-6 pt-3 [touch-action:pan-y] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:rounded-[34px] lg:border lg:px-6 lg:pb-6 lg:pt-6">
          <div className="grid min-h-0 content-start gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
            <div className="studio-inspector-workspace relative overflow-hidden rounded-[30px]">
              <button
                type="button"
                onClick={onClose}
                className="studio-inspector-close-button absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full transition"
              >
                <X className="size-5" />
              </button>
              <div className="flex min-h-[52vh] items-center justify-center p-4 sm:p-6 lg:h-full">
                {selectedAsset.generation_kind === "video" ? (
                  selectedAssetPlaybackVisual ? (
                    selectedAssetDisplayVisual ? (
                      <button
                        type="button"
                        data-testid="studio-open-lightbox"
                        onClick={onOpenLightbox}
                        className={cn(
                          "studio-inspector-preview-frame relative flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-[28px]",
                        )}
                        aria-label="Open selected video"
                      >
                        <img
                          src={selectedAssetDisplayVisual}
                          alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
                          loading="eager"
                          fetchPriority="high"
                          decoding="async"
                          className="block h-full w-full rounded-[28px] object-contain"
                        />
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="studio-inspector-play-button inline-flex h-20 w-20 items-center justify-center rounded-full backdrop-blur-xl transition hover:scale-[1.02]">
                            <Play className="ml-1 size-8" />
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="studio-inspector-preview-frame relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px]">
                        <video
                          src={selectedAssetPlaybackVisual}
                          aria-label={selectedAsset.prompt_summary ?? "Selected video artifact"}
                          controls
                          playsInline
                          preload="metadata"
                          className="block h-full w-full rounded-[28px] object-contain"
                        />
                      </div>
                    )
                  ) : null
                ) : selectedAsset.generation_kind === "audio" ? (
                  selectedAssetPlaybackVisual ? (
                    <div className="studio-inspector-preview-frame relative flex h-full w-full flex-col items-center justify-center gap-5 overflow-hidden rounded-[28px] p-5">
                      {selectedAssetDisplayVisual ? (
                        <img
                          src={selectedAssetDisplayVisual}
                          alt={selectedAsset.prompt_summary ?? "Selected audio artwork"}
                          loading="eager"
                          fetchPriority="high"
                          decoding="async"
                          className="max-h-[min(62vh,620px)] w-auto max-w-full rounded-[24px] object-contain shadow-[0_24px_70px_rgba(0,0,0,0.36)]"
                        />
                      ) : null}
                      <audio
                        src={selectedAssetPlaybackVisual}
                        controls
                        preload="metadata"
                        className="w-full max-w-[760px]"
                        aria-label={selectedAsset.prompt_summary ?? "Selected audio artifact"}
                      />
                    </div>
                  ) : null
                ) : selectedAssetDisplayVisual ? (
                  <button
                    type="button"
                    data-testid="studio-open-lightbox"
                    onClick={onOpenLightbox}
                    className={cn(
                      "studio-inspector-preview-frame flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-[28px]",
                    )}
                    aria-label="Open selected image"
                  >
                    <img
                      src={selectedAssetDisplayVisual}
                      alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      className="block h-full w-full rounded-[28px] object-contain"
                    />
                  </button>
                ) : null}
              </div>
              <StudioInspectorActions
                canDownload={Boolean(mediaDownloadUrl(selectedAsset))}
                downloadActionLabel={downloadActionLabel}
                showImageActions={selectedAsset.generation_kind === "image"}
                showReviseAction={showReviseAction}
                showDesktopActions={false}
                onDownload={onDownload}
                onDismiss={onDismiss}
                onAnimate={onAnimate}
                onUseImage={onUseImage}
                onRevise={onRevise}
              />
            </div>

            <div className="studio-inspector-panel hidden rounded-[24px] p-4 lg:block">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="studio-inspector-subtitle text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
                  {selectedAssetStructuredPresetActive ? "Preset Details" : "Prompt"}
                </div>
                {!selectedAssetStructuredPresetActive ? (
                  <button
                    type="button"
                    onClick={onCopyPrompt}
                    className="studio-inspector-chip-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
                  >
                    {copyPromptStatus === "copied" ? (
                      <Check className="studio-inspector-success-icon size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copyPromptStatus === "copied" ? "Copied" : copyPromptStatus === "error" ? "Copy failed" : "Copy"}
                  </button>
                ) : null}
              </div>
              <SelectedAssetPromptPanelContent
                structuredPresetActive={selectedAssetStructuredPresetActive}
                presetLabel={selectedAssetPresetLabel || "Preset"}
                presetDescription={selectedAssetPresetDescription}
                presetSlots={selectedAssetPresetSlots}
                presetSlotValues={selectedAssetPresetSlotValues}
                presetFields={selectedAssetPresetFields}
                presetInputValues={selectedAssetPresetInputValues}
                prompt={selectedAssetPrompt}
                promptContainerClassName="studio-inspector-prompt-scroll max-h-[14rem] overflow-y-auto rounded-[18px] px-4 py-3 pr-2"
              />
            </div>

            <div className="lg:hidden">
              <CollapsibleSubsection
                title={selectedAssetStructuredPresetActive ? "Preset Details" : "Prompt"}
                description={selectedAssetStructuredPresetActive ? "Open the preset source images and text values for this asset." : "Open the saved prompt for this asset."}
                tone="media"
                badge={
                  !selectedAssetStructuredPresetActive ? (
                    <button
                      type="button"
                      onClick={onCopyPrompt}
                      className="studio-inspector-chip-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em]"
                    >
                      {copyPromptStatus === "copied" ? (
                        <Check className="studio-inspector-success-icon size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {copyPromptStatus === "copied" ? "Copied" : copyPromptStatus === "error" ? "Copy failed" : "Copy"}
                    </button>
                  ) : undefined
                }
                open={mobileInspectorPromptOpen}
                onOpenChange={onMobileInspectorPromptOpenChange}
                className="studio-inspector-mobile-panel rounded-[24px] px-4 py-4"
                titleClassName="studio-inspector-mobile-title text-[0.72rem] font-semibold uppercase tracking-[0.16em]"
                descriptionClassName="studio-inspector-mobile-description mt-1 text-sm"
                iconClassName="studio-inspector-mobile-icon"
                bodyClassName="mt-3"
              >
                <SelectedAssetPromptPanelContent
                  structuredPresetActive={selectedAssetStructuredPresetActive}
                  presetLabel={selectedAssetPresetLabel || "Preset"}
                  presetDescription={selectedAssetPresetDescription}
                  presetSlots={selectedAssetPresetSlots}
                  presetSlotValues={selectedAssetPresetSlotValues}
                  presetFields={selectedAssetPresetFields}
                  presetInputValues={selectedAssetPresetInputValues}
                  prompt={selectedAssetPrompt}
                />
              </CollapsibleSubsection>
            </div>
          </div>

          <div className="studio-inspector-panel hidden min-h-0 content-start gap-4 rounded-[28px] p-4 lg:grid lg:overflow-y-auto lg:p-5">
            <StudioInspectorInfo
              selectedAsset={selectedAsset}
              favoriteAssetIdBusy={favoriteAssetIdBusy}
              onToggleFavorite={onToggleFavorite}
              projectLabel={selectedAssetProjectLabel}
              onOpenProject={onOpenProject}
              referencePreviews={selectedAssetReferencePreviews}
              onOpenReference={onOpenReference}
            />

            <StudioInspectorActions
              canDownload={false}
              downloadActionLabel={downloadActionLabel}
              showImageActions={selectedAsset.generation_kind === "image"}
              showReviseAction={showReviseAction}
              showMobileActions={false}
              onDownload={onDownload}
              onDismiss={onDismiss}
              onAnimate={onAnimate}
              onUseImage={onUseImage}
              onRevise={onRevise}
            />
          </div>

          <div className="lg:hidden">
            <CollapsibleSubsection
              title="Selected asset"
              description="Open the metadata and actions for this asset."
              tone="media"
              badge={<StatusPill label={selectedAsset.status ?? "stored"} tone={toneForStatus(selectedAsset.status)} />}
              open={mobileInspectorInfoOpen}
              onOpenChange={onMobileInspectorInfoOpenChange}
              className="studio-inspector-mobile-panel rounded-[24px] px-4 py-4"
              titleClassName="studio-inspector-mobile-title text-[0.72rem] font-semibold uppercase tracking-[0.18em]"
              descriptionClassName="studio-inspector-mobile-description mt-1 text-sm"
              iconClassName="studio-inspector-mobile-icon"
              bodyClassName="mt-3"
            >
              <div className="grid gap-4">
                <StudioInspectorInfo
                  selectedAsset={selectedAsset}
                  favoriteAssetIdBusy={favoriteAssetIdBusy}
                  onToggleFavorite={onToggleFavorite}
                  projectLabel={selectedAssetProjectLabel}
                  onOpenProject={onOpenProject}
                  referencePreviews={selectedAssetReferencePreviews}
                  onOpenReference={onOpenReference}
                />
              </div>
            </CollapsibleSubsection>
          </div>
        </div>
      </div>
    </div>
  );
}
