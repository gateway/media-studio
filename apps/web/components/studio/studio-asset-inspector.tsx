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
    <div data-testid="studio-inspector" className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.86)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
      <div className="min-h-dvh p-0 lg:p-6">
        <div className="grid min-h-dvh content-start gap-4 bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] px-3 pb-6 pt-3 shadow-[0_40px_100px_rgba(0,0,0,0.5)] [touch-action:pan-y] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8 lg:px-6 lg:pb-6 lg:pt-6">
          <div className="grid min-h-0 content-start gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
            <div className="relative overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)]">
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/24 text-white/78 transition hover:text-white"
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
                          "relative flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(7,9,8,0.48)] shadow-[0_22px_60px_rgba(0,0,0,0.4)]",
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
                          <span className="inline-flex h-20 w-20 items-center justify-center rounded-full border border-white/12 bg-[rgba(10,12,11,0.72)] text-white shadow-[0_24px_48px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:scale-[1.02] hover:bg-[rgba(16,19,18,0.82)]">
                            <Play className="ml-1 size-8" />
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(7,9,8,0.48)] shadow-[0_22px_60px_rgba(0,0,0,0.4)]">
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
                ) : selectedAssetDisplayVisual ? (
                  <button
                    type="button"
                    data-testid="studio-open-lightbox"
                    onClick={onOpenLightbox}
                    className={cn(
                      "flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(7,9,8,0.48)] shadow-[0_22px_60px_rgba(0,0,0,0.4)]",
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

            <div className="hidden rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.04)] p-4 text-white lg:block">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                  {selectedAssetStructuredPresetActive ? "Preset Details" : "Prompt"}
                </div>
                {!selectedAssetStructuredPresetActive ? (
                  <button
                    type="button"
                    onClick={onCopyPrompt}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/76"
                  >
                    {copyPromptStatus === "copied" ? (
                      <Check className="size-3.5 text-[#b8ff9f]" />
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
                promptContainerClassName="max-h-[14rem] overflow-y-auto rounded-[18px] border border-white/7 bg-black/16 px-4 py-3 pr-2"
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
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-white/76"
                    >
                      {copyPromptStatus === "copied" ? (
                        <Check className="size-3.5 text-[#b8ff9f]" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {copyPromptStatus === "copied" ? "Copied" : copyPromptStatus === "error" ? "Copy failed" : "Copy"}
                    </button>
                  ) : undefined
                }
                open={mobileInspectorPromptOpen}
                onOpenChange={onMobileInspectorPromptOpenChange}
                className="rounded-[24px] !border-white/10 !bg-[rgba(16,19,18,0.98)] px-4 py-4 text-white shadow-[0_18px_38px_rgba(0,0,0,0.26)]"
                titleClassName="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/72"
                descriptionClassName="mt-1 text-sm text-white/74"
                iconClassName="text-white/64"
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

          <div className="hidden min-h-0 content-start gap-4 rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:grid lg:overflow-y-auto lg:p-5">
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
              className="rounded-[24px] !border-white/10 !bg-[rgba(16,19,18,0.98)] px-4 py-4 text-white shadow-[0_18px_38px_rgba(0,0,0,0.26)]"
              titleClassName="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/72"
              descriptionClassName="mt-1 text-sm text-white/74"
              iconClassName="text-white/64"
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
