"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CircleDollarSign,
  ChevronDown,
  Coins,
  Clapperboard,
  Copy,
  Download,
  Heart,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Monitor,
  Play,
  Plus,
  Sparkles,
  Settings2,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { useGlobalActivity } from "@/components/global-activity";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { MediaModelsConsole } from "@/components/media-models-console";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { StudioGallery } from "@/components/studio/studio-gallery";
import { StudioHeaderChrome } from "@/components/studio/studio-header-chrome";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { StudioComposer } from "@/components/studio/studio-composer";
import { useStudioComposer } from "@/hooks/studio/use-studio-composer";
import { useStudioGalleryFeed } from "@/hooks/studio/use-studio-gallery-feed";
import { useStudioPolling } from "@/hooks/studio/use-studio-polling";
import { useStudioSelection } from "@/hooks/studio/use-studio-selection";
import {
  type AssetPagePayload,
  type AttachmentRecord,
  FLOATING_COMPOSER_STATUS_FADE_MS,
  FLOATING_COMPOSER_STATUS_MS,
  type ComposerStatusMessage,
  type FloatingComposerStatus,
  type GalleryKindFilter,
  INITIAL_ASSET_PAGE_SIZE,
  type MediaStudioProps,
} from "@/lib/media-studio-contract";
import {
  createOptimisticBatch,
  findMediaAssetById,
  presetRequirementMessage,
  selectedPromptObjects,
} from "@/lib/studio-gallery";
import {
  batchPhaseMessage,
  buildChoiceList,
  buildNormalizedStudioOptions,
  classifyFile,
  displayChoiceLabel,
  formatOptionValue,
  getMobileShareBlob,
  HIDDEN_STUDIO_OPTION_KEYS,
  inferBlobMimeType,
  inferInputPattern,
  isCoarsePointerDevice,
  isImageMimeType,
  isLikelyMobileSaveDevice,
  isMobileDownloadDevice,
  isNanoPresetModel,
  isRecord,
  jobPreviewUrl,
  mediaDisplayUrl,
  mediaDownloadName,
  mediaDownloadUrl,
  mediaInlineUrl,
  mediaPlaybackUrl,
  mediaPreviewUrl,
  mediaThumbnailUrl,
  mediaVariantUrl,
  mobileSaveActionLabel,
  modelInputLimit,
  MULTI_SHOT_MODEL_KEYS,
  normalizeStructuredPresetImageSlots,
  normalizeStructuredPresetTextFields,
  optionBooleanValue,
  optionChoices,
  optionEntries,
  optionIcon,
  optionShortLabel,
  parseMultiShotScript,
  parseOptionChoice,
  pickerWidth,
  prefetchAssetThumbs,
  PresetSlotState,
  presetThumbnailVisual,
  prettifyModelLabel,
  renderStructuredPresetPrompt,
  replaceFileExtension,
  sanitizeStudioOptions,
  serializeOptionChoice,
  studioValidationReady,
  StructuredPresetImageSlot,
  StructuredPresetTextField,
  structuredPresetSlotPreviewUrl,
  StudioChoice,
  studioOptionChoices,
  stripUnsupportedStudioOptions,
  toWholeNumber,
  toneForStatus,
  jobStatusLabel,
  jobPhaseMessage,
  type MultiShotParseResult,
} from "@/lib/media-studio-helpers";
import type { MediaAsset, MediaBatch, MediaEnhancePreviewResponse, MediaJob, MediaValidationResponse } from "@/lib/types";
import { estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";
import { cn, formatDateTime, truncate } from "@/lib/utils";

function StudioMetricPill({
  icon: Icon,
  value,
  accent = "default",
}: {
  icon: typeof Coins;
  value: string;
  accent?: "default" | "highlight";
}) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[14px] border px-3 text-[0.72rem] font-semibold",
        accent === "highlight"
          ? "border-[rgba(216,255,46,0.22)] bg-[rgba(14,18,15,0.99)] text-[#f4ffd3] shadow-[0_14px_24px_rgba(0,0,0,0.24)]"
          : "border-white/14 bg-[rgba(14,18,15,0.99)] text-white/92 shadow-[0_14px_24px_rgba(0,0,0,0.26)]",
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full",
          accent === "highlight" ? "bg-[rgba(216,255,46,0.22)] text-[#d8ff2e]" : "bg-[rgba(216,255,46,0.18)] text-[#d8ff2e]",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span>{value}</span>
    </div>
  );
}

function StudioActionIconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  tone = "secondary",
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-[16px] border transition disabled:cursor-not-allowed disabled:opacity-60",
        tone === "primary"
          ? "border-[rgba(216,255,46,0.24)] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] text-[#172200] shadow-[0_16px_28px_rgba(176,235,44,0.18)] hover:-translate-y-0.5"
          : tone === "danger"
            ? "border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] text-[#ffb5a6] hover:border-[rgba(201,102,82,0.34)] hover:bg-[rgba(201,102,82,0.12)]"
            : "border-white/10 bg-white/[0.06] text-white/78 hover:border-[rgba(216,141,67,0.32)] hover:bg-[rgba(216,141,67,0.14)] hover:text-white",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function StudioPillSelect({
  pickerId,
  openPicker,
  setOpenPicker,
  widthClass,
  icon: Icon,
  label,
  choices,
  onSelect,
}: {
  pickerId: string;
  openPicker: string | null;
  setOpenPicker: (value: string | null) => void;
  widthClass: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  choices: StudioChoice[];
  onSelect: (value: string) => void;
}) {
  const isOpen = openPicker === pickerId;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"up" | "down">("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState(280);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    function updateMenuPlacement() {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const gutter = 20;
      const gap = 12;
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gutter - gap);
      const spaceAbove = Math.max(0, rect.top - gutter - gap);
      const preferDown = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const nextPlacement = preferDown ? "down" : "up";
      const availableSpace = nextPlacement === "down" ? spaceBelow : spaceAbove;
      setMenuPlacement(nextPlacement);
      setMenuMaxHeight(Math.max(160, Math.min(availableSpace, 320)));
    }

    updateMenuPlacement();
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);
    window.visualViewport?.addEventListener("resize", updateMenuPlacement);
    window.visualViewport?.addEventListener("scroll", updateMenuPlacement);

    return () => {
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
      window.visualViewport?.removeEventListener("resize", updateMenuPlacement);
      window.visualViewport?.removeEventListener("scroll", updateMenuPlacement);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      data-studio-picker
      data-picker-id={pickerId}
      className={cn("relative", widthClass, isOpen ? "z-40" : "z-10")}
    >
      <button
        type="button"
        data-testid={`studio-picker-${pickerId}`}
        onClick={() => setOpenPicker(isOpen ? null : pickerId)}
        className="flex h-12 w-full items-center gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] pl-3.5 pr-3.5 text-left text-[0.82rem] font-semibold text-white transition hover:border-[rgba(216,141,67,0.22)]"
      >
        <Icon className="size-4.5 shrink-0 text-[rgba(208,255,72,0.92)]" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-white/42 transition", isOpen ? "rotate-180" : "")} />
      </button>

      {isOpen ? (
        <div
          style={{ maxHeight: `${menuMaxHeight}px` }}
          className={cn(
            "absolute left-0 z-30 w-full overflow-auto rounded-[20px] border border-white/10 bg-[rgba(17,20,19,0.98)] p-2 shadow-[0_24px_52px_rgba(0,0,0,0.44)] backdrop-blur-xl",
            menuPlacement === "down" ? "top-[calc(100%+0.65rem)]" : "bottom-[calc(100%+0.65rem)]",
          )}
        >
          <div className="grid gap-1">
            {choices.map((choice) => (
              <button
                key={`${pickerId}:${choice.value}`}
                type="button"
                data-testid={`studio-picker-option-${pickerId}-${choice.value || "empty"}`}
                onClick={() => {
                  onSelect(choice.value);
                  setOpenPicker(null);
                }}
                className="rounded-[14px] px-3 py-2.5 text-left text-[0.82rem] font-medium text-white/84 transition hover:bg-white/[0.08] hover:text-white"
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MediaStudio({
  apiHealthy,
  models,
  presets,
  prompts,
  enhancementConfigs,
  llmPresets,
  queueSettings,
  queuePolicies,
  batches,
  jobs,
  assets,
  initialAssetLimit = INITIAL_ASSET_PAGE_SIZE,
  initialAssetOffset = 0,
  initialAssetsHasMore = false,
  initialAssetsNextOffset = null,
  latestAsset,
  remainingCredits,
  pricingSnapshot,
  initialSelectedAssetId = null,
  immersive = false,
  closeHref = "/media",
}: MediaStudioProps) {
  const router = useRouter();
  const { showActivity } = useGlobalActivity();
  const [isRefreshing, startRefresh] = useTransition();
  const [hasMounted, setHasMounted] = useState(false);
  const [studioSettingsOpen, setStudioSettingsOpen] = useState(false);
  const [formMessage, setFormMessage] = useState<ComposerStatusMessage | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(null);
  const pollJobProxyRef = useRef<(jobId: string) => Promise<void>>(async () => {});
  const pollBatchProxyRef = useRef<(batchId: string) => Promise<void>>(async () => {});
  const refreshStudioDataWithSettleDelay = () => {
    startRefresh(() => router.refresh());
    window.setTimeout(() => {
      startRefresh(() => router.refresh());
    }, 1400);
  };
  const gallery = useStudioGalleryFeed({
    batches,
    jobs,
    assets,
    initialAssetLimit,
    initialAssetsHasMore,
    initialAssetsNextOffset,
    latestAsset,
    onMessage: setFormMessage,
  });
  const selection = useStudioSelection({
    initialSelectedAssetId,
    localAssets: gallery.state.localAssets,
    favoriteAssets: gallery.state.favoriteAssets,
    localJobs: gallery.state.localJobs,
    presets,
    onHydratedJob: (job) => {
      gallery.actions.setLocalJobs((current) =>
        [job, ...current.filter((entry) => entry.job_id !== job.job_id)].slice(0, 24),
      );
    },
  });

  const {
    localBatches,
    optimisticBatches,
    localJobs,
    localAssets,
    localLatestAsset,
    galleryModelFilter,
    galleryKindFilter,
    favoritesOnly,
    favoriteAssets,
  } = gallery.state;
  const { activeGalleryHasMore, activeGalleryLoadingMore, galleryTiles } = gallery.derived;
  const { galleryLoadMoreRef } = gallery.refs;
  const {
    setLocalJobs,
    setOptimisticBatches,
    setLocalAssets,
    setLocalLatestAsset,
    setGalleryModelFilter,
    setFavoriteAssets,
    applyFavoriteAssetUpdate,
    activateGalleryKindFilter,
    toggleFavoritesFilter,
    loadMoreActiveGalleryAssets,
    refreshActiveGalleryAssets,
    upsertBatch,
  } = gallery.actions;
  const {
    selectedAssetId,
    selectedMediaLightboxOpen,
    mobileInspectorPromptOpen,
    mobileInspectorInfoOpen,
  } = selection.state;
  const {
    selectedAsset,
    selectedAssetJob,
    selectedAssetPrompt,
    selectedAssetPreset,
    selectedAssetPresetFields,
    selectedAssetPresetSlots,
    selectedAssetPresetInputValues,
    selectedAssetPresetSlotValues,
    selectedAssetStructuredPresetActive,
    selectedAssetDisplayVisual,
    selectedAssetPlaybackVisual,
    selectedAssetLightboxVisual,
  } = selection.derived;
  const { lightboxVideoRef } = selection.refs;
  const {
    setSelectedAssetId,
    setSelectedMediaLightboxOpen,
    setMobileInspectorPromptOpen,
    setMobileInspectorInfoOpen,
    resetInspector,
    openSelectedMediaLightbox,
    closeSelectedMediaLightbox,
  } = selection.actions;
  const composer = useStudioComposer({
    models,
    presets,
    prompts,
    enhancementConfigs,
    queueSettings,
    queuePolicies,
    pricingSnapshot,
    remainingCredits,
    localBatches: gallery.state.localBatches,
    localAssets: gallery.state.localAssets,
    favoriteAssets: gallery.state.favoriteAssets,
    sourceAssetId,
    setSourceAssetId,
    setOptimisticBatches,
    setLocalJobs,
    upsertBatch,
    pollJob: (jobId) => pollJobProxyRef.current(jobId),
    pollBatch: (batchId) => pollBatchProxyRef.current(batchId),
    formMessage,
    setFormMessage,
    showActivity,
  });
  const {
    modelKey,
    selectedPresetId,
    selectedPromptIds,
    prompt,
    presetInputValues,
    presetSlotStates,
    optionValues,
    enhanceDialogOpen,
    enhanceBusy,
    enhancePreview,
    enhanceError,
    attachments,
    isDragActive,
    validation,
    busyState,
    floatingComposerStatus,
    mobileComposerCollapsed,
    outputCount,
    openPicker,
  } = composer.state;
  const {
    currentModel,
    currentPreset,
    currentSourceAsset,
    enhanceEnabledForModel,
    enhanceProviderLabel,
    enhanceProviderModelId,
    enhanceImageAnalysisText,
    enhanceImageAnalysisStatus,
    structuredPresetTextFields,
    structuredPresetImageSlots,
    structuredPresetActive,
    explicitVideoImageSlots,
    orderedImageInputs,
    multiShotsEnabled,
    multiShotScript,
    multiShotScriptError,
    selectedPromptList,
    modelPresets,
    structuredPresetPromptPreview,
    presetRequirementError,
    enhancementPreviewVisual,
    compactOptionEntries,
    estimatedCredits,
    estimatedCostUsd,
    formattedRemainingCredits,
    generateButtonLabel,
    modelMaxOutputs,
    validationReady,
    inferredInputPattern,
    canSubmit,
    composerStatusMessage,
    imageSlotLabels,
    imageLimitLabel,
    canAddMoreImages,
    canAddMoreVideos,
    canAddMoreAudios,
    maxImageInputs,
    maxVideoInputs,
    maxAudioInputs,
    stagedImageCount,
    stagedVideoCount,
    stagedAudioCount,
  } = composer.derived;
  const {
    promptInputRef,
  } = composer.refs;
  const {
    setModelKey,
    setSelectedPresetId,
    setSelectedPromptIds,
    setPrompt,
    setPresetInputValues,
    setPresetSlotStates,
    setOptionValues,
    setEnhanceDialogOpen,
    setEnhancePreview,
    setEnhanceError,
    setAttachments,
    setIsDragActive,
    setValidation,
    setBusyState,
    setMobileComposerCollapsed,
    setOutputCount,
    setOpenPicker,
    updateOption,
    addFiles,
    addGalleryAssetAsAttachment,
    assignPresetSlotFile,
    assignPresetSlotAsset,
    clearPresetSlot,
    removeAttachment,
    clearComposer,
    togglePrompt,
    requestEnhancementPreview,
    openEnhanceDialog,
    showFloatingComposerBanner,
    submitMedia,
    pickerWidth,
    buildChoiceList,
    displayChoiceLabel,
    parseOptionChoice,
    serializeOptionChoice,
  } = composer.actions;
  const polling = useStudioPolling({
    showActivity,
    showFloatingComposerBanner,
    setFormMessage,
    refreshStudioDataWithSettleDelay,
    refreshActiveGalleryAssets,
    setLocalJobs,
    upsertBatch,
    setLocalAssets,
    setFavoriteAssets,
    setLocalLatestAsset,
    applyFavoriteAssetUpdate,
    selectedAssetId,
    sourceAssetId,
    setSelectedAssetId,
    setSourceAssetId,
    startRefresh,
    refreshRoute: () => router.refresh(),
  });
  const { favoriteAssetIdBusy } = polling.state;
  const { pollJob, pollBatch, retryJob, dismissJob, dismissAsset, toggleAssetFavorite } = polling.actions;
  const downloadActionLabel = hasMounted ? mobileSaveActionLabel() : "Download";
  const mobileComposerExpanded = !mobileComposerCollapsed;
  const studioSettingsButton = (
    <button
      type="button"
      onClick={() => router.push("/settings")}
      aria-label="Open studio settings"
      title="Open studio settings"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.05] text-white/76 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
    >
      <Settings2 className="size-4" />
    </button>
  );
  useEffect(() => {
    pollJobProxyRef.current = pollJob;
    pollBatchProxyRef.current = pollBatch;
  }, [pollBatch, pollJob]);
  const sourceAttachmentStrip = !structuredPresetActive ? (
    <div className="flex flex-wrap gap-3">
      {explicitVideoImageSlots ? (
        <>
          {Array.from({ length: maxImageInputs }, (_, slotIndex) => {
            const slot = orderedImageInputs[slotIndex] ?? null;
            const slotVisual =
              slot?.source === "asset"
                ? mediaThumbnailUrl(slot.asset)
                : slot?.attachment?.previewUrl ?? null;
            const slotLabel = imageSlotLabels[slotIndex] ?? `Image ${slotIndex + 1}`;
            const slotFilled = Boolean(slot);
            return (
              <div key={`video-image-slot-${slotIndex}`} className="flex flex-col gap-2">
                <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">{slotLabel}</div>
                <div className="relative h-[82px] w-[82px]">
                  {slotFilled ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (slot?.source === "asset") {
                          setSourceAssetId(null);
                        } else if (slot?.source === "attachment") {
                          removeAttachment(slot.attachment.id);
                        }
                      }}
                      className={cn(
                        "group relative h-full w-full overflow-hidden rounded-[24px] border bg-white/8",
                        slot?.source === "asset" ? "border-[rgba(216,141,67,0.24)]" : "border-white/8",
                      )}
                    >
                      {slotVisual ? (
                        <img
                          src={slotVisual}
                          alt={slotLabel}
                          loading="eager"
                          fetchPriority="high"
                          decoding="async"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : null}
                    </button>
                  ) : (
                    <label
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsDragActive(true);
                      }}
                      onDragLeave={() => setIsDragActive(false)}
                      onDrop={(event) => void handleSourceTileDrop(event, slotIndex)}
                      className={cn(
                        "flex h-full w-full cursor-pointer items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.06] text-white/82 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-white/[0.09]",
                        isDragActive ? "border-[rgba(216,141,67,0.42)] bg-[rgba(24,28,26,0.95)]" : "",
                      )}
                    >
                      <Plus className="size-6" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          if (slotIndex > orderedImageInputs.length) {
                            setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
                            return;
                          }
                          addFiles(event.target.files);
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {currentSourceAsset ? (
            <button
              type="button"
              onClick={() => setSourceAssetId(null)}
              className="group relative h-[82px] w-[82px] overflow-hidden rounded-[24px] border border-[rgba(216,141,67,0.24)] bg-white/8"
            >
              {mediaThumbnailUrl(currentSourceAsset) ? (
                <img
                  src={mediaThumbnailUrl(currentSourceAsset) ?? ""}
                  alt={currentSourceAsset.prompt_summary ?? "Source asset"}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : null}
            </button>
          ) : null}

          {attachments.slice(0, 4).map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => removeAttachment(attachment.id)}
              className="group relative h-[82px] w-[82px] overflow-hidden rounded-[24px] border border-white/8 bg-white/8"
            >
              {attachment.previewUrl ? (
                attachment.kind === "videos" ? (
                  <video src={attachment.previewUrl} className="h-full w-full object-cover" />
                ) : (
                  <img src={attachment.previewUrl} alt={attachment.file.name} className="h-full w-full object-cover" />
                )
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-white/92">
                {attachment.kind === "images" ? "Image" : attachment.kind === "videos" ? "Video" : "Audio"}
              </div>
            </button>
          ))}

          {attachments.length > 4 ? (
            <div className="flex h-[82px] w-[82px] items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.04] text-center text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/58">
              +{attachments.length - 4} more
            </div>
          ) : null}

          <label
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(event) => void handleSourceTileDrop(event)}
            className={cn(
              "flex h-[82px] w-[82px] cursor-pointer items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.06] text-white/82 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-white/[0.09]",
              isDragActive ? "border-[rgba(216,141,67,0.42)] bg-[rgba(24,28,26,0.95)]" : "",
              !canAddMoreImages && !canAddMoreVideos && !canAddMoreAudios ? "cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-white/[0.06]" : "",
            )}
          >
            <Plus className="size-6" />
            <input
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className="hidden"
              disabled={!canAddMoreImages && !canAddMoreVideos && !canAddMoreAudios}
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
        </>
      )}
      {(imageLimitLabel || maxVideoInputs > 0 || maxAudioInputs > 0) && !explicitVideoImageSlots ? (
        <div className="flex min-h-[82px] min-w-[120px] flex-col justify-center rounded-[24px] border border-white/10 bg-white/[0.04] px-3 py-2">
          {imageLimitLabel ? (
            <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/62">{imageLimitLabel}</div>
          ) : null}
          {maxVideoInputs > 0 ? (
            <div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/44">
              {stagedVideoCount} / {maxVideoInputs} videos
            </div>
          ) : null}
          {maxAudioInputs > 0 ? (
            <div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/44">
              {stagedAudioCount} / {maxAudioInputs} audio
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    setOutputCount((current) => Math.min(Math.max(1, current), modelMaxOutputs));
  }, [modelMaxOutputs]);

  const lockingOverlayOpen = Boolean(selectedAssetId) || studioSettingsOpen || selectedMediaLightboxOpen;

  useEffect(() => {
    if (!lockingOverlayOpen) {
      return;
    }
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [lockingOverlayOpen]);

  function handleSourceTileDrop(event: React.DragEvent<HTMLLabelElement>, slotIndex = 0) {
    event.preventDefault();
    setIsDragActive(false);
    const galleryAssetId = event.dataTransfer.getData("application/x-bumblebee-media-asset-id");
    if (galleryAssetId) {
      const asset = findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      if (!asset) {
        setFormMessage({ tone: "danger", text: "The dragged gallery asset could not be found." });
        return;
      }
      if (asset.generation_kind !== "image") {
        setFormMessage({ tone: "danger", text: "Only image cards can be staged as source media." });
        return;
      }
      if (slotIndex > orderedImageInputs.length) {
        setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
        return;
      }
      if (slotIndex === 0) {
        useAssetAsSource(asset, false);
        return;
      }
      void addGalleryAssetAsAttachment(asset);
      return;
    }
    addFiles(event.dataTransfer.files);
  }

  function handlePresetSlotDrop(event: React.DragEvent<HTMLLabelElement>, slotKey: string) {
    event.preventDefault();
    const galleryAssetId = event.dataTransfer.getData("application/x-bumblebee-media-asset-id");
    if (galleryAssetId) {
      const asset = findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      assignPresetSlotAsset(slotKey, asset);
      return;
    }
    const droppedFile = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/")) ?? null;
    assignPresetSlotFile(slotKey, droppedFile);
  }

  function handleGalleryAssetDragStart(event: React.DragEvent<HTMLDivElement>, asset: MediaAsset | null) {
    if (!asset || asset.generation_kind !== "image") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("application/x-bumblebee-media-asset-id", String(asset.asset_id));
    event.dataTransfer.effectAllowed = "copy";
    const preview = mediaThumbnailUrl(asset);
    if (preview && typeof document !== "undefined") {
      const dragImage = document.createElement("div");
      dragImage.style.width = "72px";
      dragImage.style.height = "72px";
      dragImage.style.borderRadius = "18px";
      dragImage.style.border = "1px solid rgba(255,255,255,0.14)";
      dragImage.style.background = `center / cover no-repeat url("${preview}")`;
      dragImage.style.boxShadow = "0 14px 30px rgba(0,0,0,0.28)";
      dragImage.style.position = "fixed";
      dragImage.style.top = "-9999px";
      dragImage.style.left = "-9999px";
      dragImage.style.pointerEvents = "none";
      document.body.appendChild(dragImage);
      event.dataTransfer.setDragImage(dragImage, 36, 36);
      window.setTimeout(() => {
        dragImage.remove();
      }, 0);
    }
  }


  async function copyPromptFromAsset(promptText: string | null) {
    if (!promptText || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(promptText);
    setFormMessage({ tone: "healthy", text: "Copied the selected asset prompt." });
  }

  function useAssetAsSource(asset: MediaAsset | null, animate = false) {
    if (!asset) {
      return;
    }
    if (structuredPresetActive && !animate && asset.generation_kind === "image" && structuredPresetImageSlots.length) {
      const nextSlot =
        structuredPresetImageSlots.find((slot) => {
          const slotState = presetSlotStates[slot.key];
          return !slotState?.assetId && !slotState?.file;
        }) ?? structuredPresetImageSlots[0];
      assignPresetSlotAsset(nextSlot.key, asset);
      setSelectedMediaLightboxOpen(false);
      setSelectedAssetId(null);
      setFormMessage({ tone: "warning", text: `${asset.prompt_summary ? "Image" : "Selected asset"} assigned to ${nextSlot.label}.` });
      return;
    }
    setSourceAssetId(asset.asset_id);
    if (animate && asset.generation_kind !== "video") {
      const currentModelSupportsAnimate = Boolean(
        currentModel?.generation_kind === "video" &&
          (currentModel?.task_modes?.includes("image_to_video") ||
            currentModel?.input_patterns?.includes("single_image") ||
            currentModel?.input_patterns?.includes("first_last_frames")),
      );
      if (!currentModelSupportsAnimate) {
        setModelKey("kling-2.6-i2v");
      }
    }
    setSelectedMediaLightboxOpen(false);
    // Desktop keeps the docked composer anchored to the viewport.
    setMobileComposerCollapsed(!isCoarsePointerDevice());
    setSelectedAssetId(null);
    setFormMessage({
      tone: "warning",
      text: animate
        ? "The selected image is now staged for the animate flow."
        : "The selected asset is now attached as a source reference.",
    });
  }

  async function handleAssetDownload(asset: MediaAsset | null) {
    if (!asset) {
      return;
    }

    const inlineUrl = mediaInlineUrl(asset);
    const downloadUrl = mediaDownloadUrl(asset) ?? inlineUrl;
    if (!downloadUrl) {
      return;
    }

    if (isLikelyMobileSaveDevice()) {
      const sourceUrl = new URL(inlineUrl ?? downloadUrl, window.location.origin).toString();
      const attachmentUrl = new URL(downloadUrl, window.location.origin).toString();
      try {
        const response = await fetch(attachmentUrl, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error("Download failed");
        }
        const originalBlob = await response.blob();
        const mimeType = inferBlobMimeType(asset, originalBlob);
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          const shareFileName = mediaDownloadName(asset);
          try {
            const shareBlob = await getMobileShareBlob(new Blob([originalBlob], { type: mimeType }));
            const normalizedShareFileName =
              shareBlob.type === "image/jpeg" ? replaceFileExtension(shareFileName, "jpg") : shareFileName;
            const file = new File([shareBlob], normalizedShareFileName, {
              type: shareBlob.type || mimeType || "application/octet-stream",
            });
            const shareData: ShareData = { files: [file], title: normalizedShareFileName };
            if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
              await navigator.share(shareData);
              showActivity(
                { tone: "healthy", message: "Opened your device share sheet." },
                { autoHideMs: 2200 },
              );
              return;
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
          }
        }

        try {
          if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            const urlShareData: ShareData = {
              title: mediaDownloadName(asset),
              url: isImageMimeType(mimeType) ? sourceUrl : attachmentUrl,
            };
            if (typeof navigator.canShare !== "function" || navigator.canShare(urlShareData)) {
              await navigator.share(urlShareData);
              showActivity(
                { tone: "healthy", message: "Opened your device share sheet." },
                { autoHideMs: 2200 },
              );
              return;
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }

        const objectUrl = URL.createObjectURL(new Blob([originalBlob], { type: mimeType }));
        try {
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = mediaDownloadName(asset);
          anchor.rel = "noopener";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          showActivity(
            { tone: "healthy", message: "Opened the media save flow for your device." },
            { autoHideMs: 2600 },
          );
          return;
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
        }
      } catch {
        // Fall through to the generic mobile open behavior below.
      }

      const fallbackLooksLikeImage = /\.(png|jpe?g|webp|gif)$/i.test(mediaDownloadName(asset));
      const opened = window.open(fallbackLooksLikeImage ? sourceUrl : attachmentUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.assign(attachmentUrl);
      }
      showActivity(
        { tone: "healthy", message: "Opened the original media so your device can save or share it." },
        { autoHideMs: 2600 },
      );
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = mediaDownloadName(asset);
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <div className={immersive ? "min-h-dvh" : "space-y-7"}>
      <div
        id="create"
        className={cn(
          "overflow-hidden bg-[#121413] px-0 py-0 text-white",
          immersive
            ? "min-h-dvh"
            : "rounded-[34px] border border-[rgba(22,26,24,0.9)] shadow-[0_38px_90px_rgba(19,24,21,0.3)]",
        )}
      >
        <div className={cn("relative overflow-hidden", immersive ? "min-h-dvh" : "min-h-[920px]")}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(216,141,67,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(82,110,106,0.2),transparent_28%),linear-gradient(180deg,#181c1a,#111412_52%,#171917)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,8,0.12),rgba(7,9,8,0.52)),radial-gradient(circle_at_center,transparent_40%,rgba(4,4,4,0.42)_100%)]" />

          <StudioHeaderChrome
            immersive={immersive}
            apiHealthy={apiHealthy}
            galleryModelFilter={galleryModelFilter}
            models={models}
            favoritesOnly={favoritesOnly}
            galleryKindFilter={galleryKindFilter}
            metrics={
              !selectedAsset ? (
                <div className="hidden items-center gap-2 md:flex">
                  {formattedRemainingCredits ? <StudioMetricPill icon={Coins} value={formattedRemainingCredits} /> : null}
                  {estimatedCredits ? <StudioMetricPill icon={Coins} value={estimatedCredits} accent="highlight" /> : null}
                  {estimatedCostUsd ? <StudioMetricPill icon={CircleDollarSign} value={estimatedCostUsd} accent="highlight" /> : null}
                </div>
              ) : null
            }
            onGalleryModelFilterChange={setGalleryModelFilter}
            onActivateGalleryKindFilter={activateGalleryKindFilter}
            onToggleFavoritesFilter={toggleFavoritesFilter}
          />

          <StudioGallery
            immersive={immersive}
            galleryTiles={galleryTiles}
            activeGalleryHasMore={activeGalleryHasMore}
            activeGalleryLoadingMore={activeGalleryLoadingMore}
            selectedAssetId={selectedAssetId}
            favoriteAssetIdBusy={favoriteAssetIdBusy}
            galleryLoadMoreRef={galleryLoadMoreRef}
            onLoadMore={loadMoreActiveGalleryAssets}
            onSelectAsset={setSelectedAssetId}
            onDragAsset={handleGalleryAssetDragStart}
            onToggleFavorite={(asset) => void toggleAssetFavorite(asset)}
          />

          {!selectedAsset ? (
            <StudioComposer
              immersive={immersive}
              mobileComposerCollapsed={mobileComposerCollapsed}
              mobileComposerExpanded={mobileComposerExpanded}
              currentModelLabel={currentModel?.label ?? "Select a model"}
              formattedRemainingCredits={formattedRemainingCredits}
              estimatedCredits={estimatedCredits}
              estimatedCostUsd={estimatedCostUsd}
              structuredPresetActive={structuredPresetActive}
              presetLabel={currentPreset?.label ?? null}
              sourceAttachmentStrip={sourceAttachmentStrip}
              studioSettingsButton={studioSettingsButton}
              floatingComposerStatus={floatingComposerStatus}
              onToggleCollapsed={() => setMobileComposerCollapsed((current) => !current)}
            >
                  {structuredPresetActive ? (
                    <div className="relative grid gap-3 rounded-[26px] border border-white/8 bg-white/[0.04] px-4 py-4">
                      <div className={cn("grid gap-3", structuredPresetImageSlots.length ? "lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-start" : "")}>
                        <div className="rounded-[20px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-4">
                          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/48">Preset</div>
                          <div className="mt-2 text-base font-semibold tracking-[-0.03em] text-white/92">{currentPreset?.label}</div>
                          {currentPreset?.description ? (
                            <p className="mt-3 text-sm leading-7 text-white/68">{currentPreset.description}</p>
                          ) : null}
                        </div>
                        {structuredPresetImageSlots.length ? (
                          <div className="grid gap-3">
                            {structuredPresetImageSlots.map((slot) => {
                              const slotState = presetSlotStates[slot.key];
                              const slotPreview = slotState?.assetId
                                ? mediaThumbnailUrl(findMediaAssetById(slotState.assetId, localAssets, favoriteAssets) ?? null) ?? slotState.previewUrl
                                : slotState?.previewUrl;
                              return (
                                <div key={slot.key} className="rounded-[20px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-white/88">{slot.label}</div>
                                      <div className="mt-1 text-xs leading-6 text-white/56">{slot.helpText || "Upload or drag an image into this slot."}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex items-center gap-3">
                                    <div className="relative h-[86px] w-[86px] shrink-0">
                                      <label
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => handlePresetSlotDrop(event, slot.key)}
                                        className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.05] text-white/74"
                                      >
                                        {slotPreview ? <img src={slotPreview} alt={slot.label} className="h-full w-full object-cover" /> : <ImagePlus className="size-5" />}
                                        <input type="file" accept="image/*" className="hidden" onChange={(event) => assignPresetSlotFile(slot.key, event.target.files?.[0] ?? null)} />
                                      </label>
                                      {slotState?.assetId || slotState?.file ? (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            clearPresetSlot(slot.key);
                                          }}
                                          className="absolute bottom-1.5 right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(255,181,166,0.22)] bg-[rgba(18,11,10,0.82)] text-[#ffb5a6] shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:border-[rgba(255,181,166,0.34)] hover:text-white"
                                          aria-label={`Clear ${slot.label}`}
                                          title={`Clear ${slot.label}`}
                                        >
                                          <Trash2 className="size-3.5" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      {structuredPresetTextFields.length ? (
                        <div className="grid gap-3 pt-1 sm:grid-cols-2">
                          {structuredPresetTextFields.map((field) => (
                            <label key={field.key} className="grid gap-2">
                              <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">{field.label}</span>
                              <input
                                value={presetInputValues[field.key] ?? field.defaultValue ?? ""}
                                onChange={(event) => setPresetInputValues((current) => ({ ...current, [field.key]: event.target.value }))}
                                placeholder={field.placeholder || field.label}
                                className="h-12 rounded-[18px] border border-white/10 bg-[rgba(11,14,13,0.88)] px-4 text-sm text-white outline-none placeholder:text-white/32"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="relative">
                      <textarea
                        data-testid="studio-prompt-input"
                        ref={promptInputRef}
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder={
                          multiShotsEnabled
                            ? "3 | Wide shot of the skyline\n2 | Hero steps into frame on the rooftop"
                            : "Describe the scene you imagine"
                        }
                        className="min-h-[132px] w-full resize-none rounded-[26px] border border-white/8 bg-white/[0.04] px-4 py-4 text-[0.86rem] leading-6 text-white outline-none placeholder:text-white/38 focus:border-[rgba(216,141,67,0.3)] md:min-h-[98px]"
                      />
                      {enhanceEnabledForModel ? (
                        <button
                          type="button"
                          onClick={openEnhanceDialog}
                          aria-label="Open enhance dialog"
                          title="Open enhance dialog"
                          className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:border-[rgba(216,141,67,0.32)] hover:bg-[rgba(216,141,67,0.14)] hover:text-white"
                        >
                          <Sparkles className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  )}
                  <div className="relative z-30 flex flex-wrap items-center gap-2 pb-1 text-[0.77rem]">
                    <StudioPillSelect
                      pickerId="model"
                      openPicker={openPicker}
                      setOpenPicker={setOpenPicker}
                      widthClass={pickerWidth("model")}
                      icon={Clapperboard}
                      label={currentModel?.label ?? "Model"}
                      choices={models.map((model) => ({
                        value: model.key,
                        label: model.label,
                      }))}
                      onSelect={(value) => {
                        setModelKey(value);
                        setSelectedPresetId("");
                        setSelectedPromptIds([]);
                        setValidation(null);
                        setPresetInputValues({});
                        setPresetSlotStates({});
                      }}
                    />

                  {selectedPresetId || modelPresets.length ? (
                    <StudioPillSelect
                      pickerId="preset"
                      openPicker={openPicker}
                      setOpenPicker={setOpenPicker}
                      widthClass={pickerWidth("preset")}
                      icon={Sparkles}
                      label={
                        modelPresets.find((preset) => preset.preset_id === selectedPresetId)?.label ??
                        modelPresets.find((preset) => preset.key === selectedPresetId)?.label ??
                        "Preset"
                      }
                      choices={[
                        { value: "", label: "Preset" },
                        ...modelPresets.map((preset) => ({
                          value: preset.preset_id,
                          label: preset.label,
                        })),
                      ]}
                      onSelect={(value) => {
                        setSelectedPresetId(value);
                        setValidation(null);
                        setFormMessage(null);
                        if (!value) {
                          setPresetInputValues({});
                          setPresetSlotStates({});
                          return;
                        }
                        const preset = modelPresets.find((entry) => entry.preset_id === value || entry.key === value) ?? null;
                        if (!preset) {
                          return;
                        }
                        const hasStructuredInputs =
                          ((preset.input_schema_json as Array<Record<string, unknown>> | undefined)?.length ?? 0) > 0 ||
                          ((preset.input_slots_json as Array<Record<string, unknown>> | undefined)?.length ?? 0) > 0;
                        if (hasStructuredInputs) {
                          for (const attachment of attachments) {
                            if (attachment.previewUrl) {
                              URL.revokeObjectURL(attachment.previewUrl);
                            }
                          }
                          setAttachments([]);
                          setSourceAssetId(null);
                        }
                        if (!hasStructuredInputs && preset.prompt_template?.trim()) {
                          setPrompt(preset.prompt_template);
                        }
                        if (preset.default_options_json && Object.keys(preset.default_options_json).length) {
                          setOptionValues((current) => ({ ...current, ...preset.default_options_json }));
                        }
                      }}
                    />
                  ) : null}

                    {modelMaxOutputs > 1 ? (
                      <StudioPillSelect
                        pickerId="output-count"
                        openPicker={openPicker}
                        setOpenPicker={setOpenPicker}
                        widthClass={pickerWidth("output-count")}
                        icon={Copy}
                        label={`${outputCount}`}
                        choices={Array.from({ length: modelMaxOutputs }, (_, index) => ({
                          value: String(index + 1),
                          label: String(index + 1),
                        }))}
                        onSelect={(value) => setOutputCount(Math.max(1, Number(value) || 1))}
                      />
                    ) : null}

                    {compactOptionEntries
                      .filter(([optionKey]) => !(modelKey === "kling-3.0-i2v" && inferredInputPattern === "first_last_frames" && optionKey === "aspect_ratio"))
                      .map(([optionKey, schema]) => {
                      const Icon = optionIcon(optionKey);
                      const currentValue = optionValues[optionKey];
                      const choices = buildChoiceList(modelKey, optionKey, schema, currentValue);
                      const resolvedValue = currentValue ?? schema.default ?? null;
                      const resolvedLabel =
                        resolvedValue == null || resolvedValue === ""
                          ? choices[0]?.label ?? "Select"
                          : displayChoiceLabel(optionKey, schema, resolvedValue);
                      return (
                        <StudioPillSelect
                          key={optionKey}
                          pickerId={optionKey}
                          openPicker={openPicker}
                          setOpenPicker={setOpenPicker}
                          widthClass={pickerWidth(optionKey)}
                          icon={Icon}
                          label={resolvedLabel}
                          choices={
                            choices.length
                              ? choices
                              : [
                                  {
                                    value: serializeOptionChoice(resolvedValue ?? ""),
                                    label: resolvedLabel,
                                  },
                                ]
                          }
                          onSelect={(value) => updateOption(optionKey, parseOptionChoice(schema, value))}
                        />
                      );
                    })}

                    <div className="flex w-full items-center gap-2 sm:w-auto sm:ml-auto">
                      <div className="shrink-0 md:hidden">
                        {studioSettingsButton}
                      </div>
                      <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={clearComposer}
                        className="inline-flex h-12 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#b4d58b,#87a86a)] px-5 text-[0.76rem] font-semibold text-[#132108] shadow-[0_18px_38px_rgba(113,147,86,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_42px_rgba(113,147,86,0.24)]"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        data-testid="studio-generate-button"
                        onClick={() => void submitMedia("submit")}
                        disabled={!canSubmit}
                        className="inline-flex h-12 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 text-[0.76rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5 disabled:opacity-60"
                      >
                        {generateButtonLabel}
                      </button>
                      </div>
                    </div>
                  </div>
	              {(composerStatusMessage || selectedPromptList.length || multiShotsEnabled) ? (
                <div className="mt-4 grid gap-3 border-t border-white/8 pt-4">
                  <div className="grid gap-2">
                    {multiShotsEnabled ? (
                      <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/74">
                        {multiShotScriptError ? (
                          <span className="text-[#ffb5a6]">{multiShotScriptError}</span>
                        ) : (
                          <span>
                            Multi-shot script ready: {multiShotScript.shots.length} shot
                            {multiShotScript.shots.length === 1 ? "" : "s"} · {multiShotScript.totalDuration}s total
                          </span>
                        )}
                      </div>
                    ) : null}
                    {composerStatusMessage ? (
                      <div
                        className={cn(
                          "rounded-[20px] border px-4 py-3 text-sm",
                          composerStatusMessage.tone === "danger"
                            ? "border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] text-[#ffb5a6]"
                            : composerStatusMessage.tone === "healthy"
                              ? "border-[rgba(176,235,44,0.22)] bg-[rgba(176,235,44,0.08)] text-[#d8ff82]"
                              : "border-white/8 bg-white/[0.03] text-white/78",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {busyState !== "idle" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          <span>{composerStatusMessage.text}</span>
                        </div>
                      </div>
                    ) : null}
                    {selectedPromptList.length ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedPromptList.map((promptItem) => (
                          <button
                            key={promptItem.prompt_id}
                            type="button"
                            onClick={() => togglePrompt(promptItem.prompt_id)}
                            className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/78"
                          >
                            @{promptItem.key}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </StudioComposer>
          ) : null}
        </div>
      </div>

      {enhanceDialogOpen ? (
        <div className="fixed inset-0 z-[125] bg-[rgba(6,8,7,0.7)] backdrop-blur-md">
          <div className="absolute inset-0 p-3 md:p-6">
            <div className="grid h-full gap-4 rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,20,18,0.96),rgba(10,13,12,0.96))] p-4 shadow-[0_40px_100px_rgba(0,0,0,0.5)] lg:grid-cols-[minmax(0,1fr)_320px] lg:p-6">
              <div className="grid min-h-0 gap-4 overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)] p-4 lg:p-6">
                <div className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01)),radial-gradient(circle_at_top,rgba(216,141,67,0.12),transparent_36%),rgba(5,7,6,0.86)]">
                  {enhancementPreviewVisual ? (
                    <div className="flex min-h-[260px] items-center justify-center p-4 sm:min-h-[340px] sm:p-5">
                      <img
                        src={enhancementPreviewVisual}
                        alt="Enhancement reference"
                        className="max-h-[50vh] w-auto max-w-full rounded-[24px] object-contain shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-[260px] items-center justify-center px-6 text-center text-sm text-white/56 sm:min-h-[340px]">
                      No image reference is staged for this enhancement preview.
                    </div>
                  )}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">User prompt</div>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/78">
                      {(structuredPresetActive ? structuredPresetPromptPreview : prompt) || "No prompt entered yet."}
                    </pre>
                  </div>
                  <div className="rounded-[22px] border border-[rgba(216,141,67,0.14)] bg-[rgba(216,141,67,0.05)] p-4">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#ffd7af]">Enhanced prompt</div>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/88">
                      {enhancePreview?.final_prompt_used || enhancePreview?.enhanced_prompt || (enhanceBusy ? "Enhancing prompt..." : "Run enhance to preview the rewritten prompt.")}
                    </pre>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 xl:col-span-2">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Image analysis</div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/76">
                      {enhanceImageAnalysisText ? (
                        enhanceImageAnalysisText
                      ) : enhancementPreviewVisual ? (
                        "No image analysis output is available for this preview yet."
                      ) : (
                        "No image reference is staged, so there is nothing to analyze."
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid auto-rows-max gap-4 overflow-y-auto rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/54">Enhance prompt</div>
                    <div className="mt-1 text-base font-semibold text-white">{currentModel?.label ?? "Unknown model"}</div>
                    <div className="mt-1 text-sm text-white/66">Preview the rewrite, then send it back to the composer.</div>
                  </div>
                  <button type="button" onClick={() => setEnhanceDialogOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/24 text-white/78 transition hover:text-white">
                    <X className="size-5" />
                  </button>
                </div>

                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Preview summary</div>
                    <div className="mt-3 grid gap-3 text-sm leading-6 text-white/74">
                      <div>
                        <span className="text-white/48">Model:</span> {currentModel?.label ?? "Unknown model"}
                      </div>
                      <div>
                        <span className="text-white/48">Enhancement provider:</span> {enhanceProviderLabel}
                      </div>
                      <div>
                        <span className="text-white/48">Enhancement model:</span> {enhanceProviderModelId ?? "Not selected"}
                      </div>
                      <div>
                        <span className="text-white/48">Preset:</span> {currentPreset?.label ?? "No preset selected"}
                      </div>
                    <div>
                      <span className="text-white/48">Image reference:</span> {enhancementPreviewVisual ? "Attached" : "None"}
                    </div>
                    <div>
                      <span className="text-white/48">Image analysis:</span>{" "}
                      {enhanceImageAnalysisStatus}
                    </div>
                  </div>
                </div>

                {enhanceError ? (
                  <div className="rounded-[20px] border border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] px-4 py-3 text-sm text-[#ffb5a6]">
                    {enhanceError}
                  </div>
                ) : null}
                {enhancePreview?.warnings?.length ? (
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/72">
                    {enhancePreview.warnings.join(" ")}
                  </div>
                ) : null}

                <div className="grid gap-3">
                  <button type="button" onClick={() => void requestEnhancementPreview()} disabled={enhanceBusy} className="inline-flex w-full items-center justify-center gap-3 rounded-[22px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 py-4 text-[0.98rem] font-semibold text-[#162300] shadow-[0_18px_34px_rgba(156,204,33,0.22)] disabled:opacity-60">
                    {enhanceBusy ? <LoaderCircle className="size-4.5 animate-spin" /> : <Sparkles className="size-4.5" />}
                    {enhanceBusy ? "Enhancing..." : "Enhance"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextPrompt = enhancePreview?.final_prompt_used || enhancePreview?.enhanced_prompt;
                      if (!nextPrompt) {
                        return;
                      }
                      setPrompt(nextPrompt);
                      setEnhanceDialogOpen(false);
                      setFormMessage({ tone: "healthy", text: "Loaded the enhanced prompt into the composer." });
                    }}
                    disabled={!enhancePreview?.final_prompt_used && !enhancePreview?.enhanced_prompt}
                    className="inline-flex w-full items-center justify-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm font-semibold text-white/86 disabled:opacity-60"
                  >
                    Use Prompt
                  </button>
                  <button type="button" onClick={() => setEnhanceDialogOpen(false)} className="inline-flex w-full items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/76">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {studioSettingsOpen ? (
        <div className="fixed inset-0 z-[118] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.78)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
          <div className="min-h-dvh p-0 lg:p-6">
            <div className="flex min-h-dvh min-w-0 flex-col bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] shadow-[0_40px_100px_rgba(0,0,0,0.5)] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8">
              <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-6">
                <div>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[rgba(208,255,72,0.94)]">
                    Studio Settings
                  </div>
                  <div className="mt-1 text-sm text-white/68">
                    Configure the current model, system prompt, and presets without leaving Studio.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStudioSettingsOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/78 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
                  aria-label="Close studio settings"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
                <MediaModelsConsole
                  models={models}
                  presets={presets}
                  enhancementConfigs={enhancementConfigs}
                  llmPresets={llmPresets}
                  initialSelectedModelKey={modelKey}
                  variant="studio"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedAsset ? (
        <div data-testid="studio-inspector" className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.86)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
          <div className="min-h-dvh p-0 lg:p-6">
            <div className="grid min-h-dvh content-start gap-4 bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] px-3 pb-6 pt-3 shadow-[0_40px_100px_rgba(0,0,0,0.5)] [touch-action:pan-y] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8 lg:px-6 lg:pb-6 lg:pt-6">
              <div className="grid min-h-0 content-start gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
                <div className="relative overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)]">
                  <button
                    type="button"
                    onClick={resetInspector}
                    className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/24 text-white/78 transition hover:text-white"
                  >
                    <X className="size-5" />
                  </button>
                  <div className="flex min-h-[48vh] items-center justify-center p-4 sm:p-6 lg:h-full">
                    {selectedAssetDisplayVisual ? (
                      selectedAsset.generation_kind === "video" ? (
                        <button
                          type="button"
                          data-testid="studio-open-lightbox"
                          onClick={openSelectedMediaLightbox}
                          className="relative cursor-zoom-in"
                          aria-label="Open selected video"
                        >
                          <img
                            src={selectedAssetDisplayVisual}
                            alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
                            loading="eager"
                            fetchPriority="high"
                            decoding="async"
                            className="max-h-[58vh] w-auto max-w-full rounded-[28px] object-contain shadow-[0_22px_60px_rgba(0,0,0,0.4)] lg:max-h-[68vh]"
                          />
                          {selectedAssetPlaybackVisual ? (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="inline-flex h-20 w-20 items-center justify-center rounded-full border border-white/12 bg-[rgba(10,12,11,0.72)] text-white shadow-[0_24px_48px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:scale-[1.02] hover:bg-[rgba(16,19,18,0.82)]">
                                <Play className="ml-1 size-8" />
                              </span>
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid="studio-open-lightbox"
                          onClick={openSelectedMediaLightbox}
                          className="cursor-zoom-in"
                          aria-label="Open selected image"
                        >
                          <img
                            src={selectedAssetDisplayVisual}
                            alt={selectedAsset.prompt_summary ?? "Selected media artifact"}
                            loading="eager"
                            fetchPriority="high"
                            decoding="async"
                            className="max-h-[58vh] w-auto max-w-full rounded-[28px] object-contain shadow-[0_22px_60px_rgba(0,0,0,0.4)] lg:max-h-[68vh]"
                          />
                        </button>
                      )
                    ) : null}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
                    <div className="pointer-events-auto flex items-center gap-2">
                      {mediaDownloadUrl(selectedAsset) ? (
                        <StudioActionIconButton
                          icon={Download}
                          label={downloadActionLabel}
                          onClick={() => void handleAssetDownload(selectedAsset)}
                          className="h-11 w-11 rounded-full border-white/12 bg-[rgba(8,10,9,0.72)] text-white/82 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
                        />
                      ) : null}
                    </div>
                    <div className="pointer-events-auto flex items-center gap-2">
                      <StudioActionIconButton
                        icon={Trash2}
                        label="Remove"
                        onClick={() => void dismissAsset(selectedAsset.asset_id)}
                        tone="danger"
                        className="h-11 w-11 rounded-full border-[rgba(201,102,82,0.28)] bg-[rgba(40,16,14,0.76)] text-[#ffb5a6] shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
                      />
                    </div>
                  </div>

                </div>

                <div className="hidden rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.04)] p-4 text-white lg:block">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                      {selectedAssetStructuredPresetActive ? "Preset Details" : "Prompt"}
                    </div>
                    {!selectedAssetStructuredPresetActive ? (
                      <button
                        type="button"
                        onClick={() => void copyPromptFromAsset(selectedAssetPrompt)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/76"
                      >
                        <Copy className="size-3.5" />
                        Copy
                      </button>
                    ) : null}
                  </div>
                  {selectedAssetStructuredPresetActive ? (
                    <div className="grid gap-4">
                      {selectedAssetPresetSlots.length ? (
                        <div className="grid gap-3">
                          {selectedAssetPresetSlots.map((slot) => {
                            const rawItems = Array.isArray(selectedAssetPresetSlotValues[slot.key])
                              ? (selectedAssetPresetSlotValues[slot.key] as unknown[])
                              : [];
                            const previews = rawItems
                              .map((item) => structuredPresetSlotPreviewUrl(item, localAssets, favoriteAssets))
                              .filter((item): item is { url: string; label: string } => Boolean(item?.url));
                            return (
                              <div key={slot.key} className="rounded-[18px] border border-white/7 bg-black/16 p-3">
                                <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/56">
                                  <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
                                  {slot.label}
                                </div>
                                {slot.helpText ? (
                                  <div className="mt-1 text-sm leading-6 text-white/60">{slot.helpText}</div>
                                ) : null}
                                {previews.length ? (
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    {previews.map((preview, index) => (
                                      <div key={`${slot.key}-${index}`} className="grid gap-2">
                                        <img
                                          src={preview.url}
                                          alt={preview.label}
                                          className="h-24 w-24 rounded-[16px] object-cover"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="mt-3 text-sm text-white/54">No source image was recorded.</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {selectedAssetPresetFields.length ? (
                        <div className="grid gap-2">
                          {selectedAssetPresetFields.map((field) => (
                            <div key={field.key} className="flex items-center justify-between gap-3 rounded-[16px] border border-white/7 bg-black/16 px-3 py-3">
                              <span className="text-sm text-white/56">{field.label}</span>
                              <span className="text-sm font-medium text-white/92">
                                {selectedAssetPresetInputValues[field.key] || field.defaultValue || "Not provided"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="max-h-[14rem] overflow-y-auto rounded-[18px] border border-white/7 bg-black/16 px-4 py-3 pr-2">
                      <p className="whitespace-pre-wrap text-sm leading-7 text-white/78">
                        {selectedAssetPrompt ?? "No prompt text was stored for this asset."}
                      </p>
                    </div>
                  )}
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
                          onClick={() => void copyPromptFromAsset(selectedAssetPrompt)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-white/76"
                        >
                          <Copy className="size-3.5" />
                          Copy
                        </button>
                      ) : undefined
                    }
                    open={mobileInspectorPromptOpen}
                    onOpenChange={setMobileInspectorPromptOpen}
                    className="rounded-[24px] !border-white/10 !bg-[rgba(16,19,18,0.98)] px-4 py-4 text-white shadow-[0_18px_38px_rgba(0,0,0,0.26)]"
                    titleClassName="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/72"
                    descriptionClassName="mt-1 text-sm text-white/74"
                    iconClassName="text-white/64"
                    bodyClassName="mt-3"
                  >
                    {selectedAssetStructuredPresetActive ? (
                      <div className="grid gap-4">
                        {selectedAssetPresetSlots.length ? (
                          <div className="grid gap-3">
                            {selectedAssetPresetSlots.map((slot) => {
                              const rawItems = Array.isArray(selectedAssetPresetSlotValues[slot.key])
                                ? (selectedAssetPresetSlotValues[slot.key] as unknown[])
                                : [];
                              const previews = rawItems
                                .map((item) => structuredPresetSlotPreviewUrl(item, localAssets, favoriteAssets))
                                .filter((item): item is { url: string; label: string } => Boolean(item?.url));
                              return (
                                <div key={slot.key} className="rounded-[18px] border border-white/7 bg-black/16 p-3">
                                  <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/56">
                                    <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
                                    {slot.label}
                                  </div>
                                  {slot.helpText ? <div className="mt-1 text-sm leading-6 text-white/60">{slot.helpText}</div> : null}
                                  {previews.length ? (
                                    <div className="mt-3 flex flex-wrap gap-3">
                                      {previews.map((preview, index) => (
                                        <img
                                          key={`${slot.key}-${index}`}
                                          src={preview.url}
                                          alt={preview.label}
                                          className="h-20 w-20 rounded-[14px] object-cover"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-3 text-sm text-white/54">No source image was recorded.</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {selectedAssetPresetFields.length ? (
                          <div className="grid gap-2">
                            {selectedAssetPresetFields.map((field) => (
                              <div key={field.key} className="flex items-center justify-between gap-3 rounded-[16px] border border-white/7 bg-black/16 px-3 py-3">
                                <span className="text-sm text-white/56">{field.label}</span>
                                <span className="text-sm font-medium text-white/92">
                                  {selectedAssetPresetInputValues[field.key] || field.defaultValue || "Not provided"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-white/7 bg-black/16 px-4 py-3">
                        <p className="whitespace-pre-wrap text-sm leading-7 text-white/78">
                          {selectedAssetPrompt ?? "No prompt text was stored for this asset."}
                        </p>
                      </div>
                    )}
                  </CollapsibleSubsection>
                  </div>
                </div>

                <div className="grid gap-3 rounded-[24px] border border-white/10 bg-[rgba(16,19,18,0.98)] p-3 shadow-[0_18px_38px_rgba(0,0,0,0.22)] lg:hidden">
                  {selectedAsset.generation_kind === "image" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, true)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-4 text-[0.82rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5"
                      >
                        <Wand2 className="size-4" />
                        Animate
                      </button>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, false)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.06] px-4 text-[0.82rem] font-semibold text-white/84 transition hover:border-[rgba(216,141,67,0.3)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
                      >
                        <ImagePlus className="size-4" />
                        Use image
                      </button>
                    </>
                  ) : null}
                </div>

                <div className="hidden min-h-0 gap-4 rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:grid lg:overflow-y-auto lg:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/54">
                      Selected asset
                    </div>
                    <div className="mt-1 text-sm text-white/76">
                      {selectedAsset.model_key ?? "Unknown model"} • {formatDateTime(selectedAsset.created_at)}
                    </div>
                  </div>
                  <StatusPill label={selectedAsset.status ?? "stored"} tone={toneForStatus(selectedAsset.status)} />
                </div>

                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                    Information
                  </div>
                  <div className="mt-3 grid gap-2">
                    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                      <span className="text-sm text-white/56">Model</span>
                      <span className="text-sm font-medium text-white/92">{selectedAsset.model_key ?? "Unknown"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                      <span className="text-sm text-white/56">Preset</span>
                      <span className="text-sm font-medium text-white/92">{selectedAsset.preset_key ?? "builtin"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                      <span className="text-sm text-white/56">Type</span>
                      <span className="text-sm font-medium text-white/92">{selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "asset"}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleAssetFavorite(selectedAsset)}
                      disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
                      className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.05] disabled:opacity-60"
                    >
                      <span className="text-sm text-white/56">Favorite</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-2 text-sm font-medium",
                          selectedAsset.favorited ? "text-[#ff9abc]" : "text-white/72",
                        )}
                      >
                        <Heart className={cn("size-4", selectedAsset.favorited ? "fill-current" : "")} />
                        {selectedAsset.favorited ? "Saved" : "Off"}
                      </span>
                    </button>
                    {Object.entries((selectedAsset.payload?.resolved_options as Record<string, unknown> | undefined) ?? {})
                      .filter(([, value]) => value != null && value !== "")
                      .slice(0, 6)
                      .map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">{optionShortLabel(key)}</span>
                          <span className="text-sm font-medium text-white/92">{displayChoiceLabel(key, {}, value) || formatOptionValue(value)}</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="grid gap-3">
                  {selectedAsset.generation_kind === "image" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, true)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-4 text-[0.82rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5"
                      >
                        <Wand2 className="size-4" />
                        Animate
                      </button>
                      <button
                        type="button"
                        onClick={() => useAssetAsSource(selectedAsset, false)}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.06] px-4 text-[0.82rem] font-semibold text-white/84 transition hover:border-[rgba(216,141,67,0.3)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
                      >
                        <ImagePlus className="size-4" />
                        Use image
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="lg:hidden">
                <CollapsibleSubsection
                  title="Selected asset"
                  description="Open the metadata and actions for this asset."
                  tone="media"
                  badge={<StatusPill label={selectedAsset.status ?? "stored"} tone={toneForStatus(selectedAsset.status)} />}
                  open={mobileInspectorInfoOpen}
                  onOpenChange={setMobileInspectorInfoOpen}
                    className="rounded-[24px] !border-white/10 !bg-[rgba(16,19,18,0.98)] px-4 py-4 text-white shadow-[0_18px_38px_rgba(0,0,0,0.26)]"
                  titleClassName="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/72"
                  descriptionClassName="mt-1 text-sm text-white/74"
                  iconClassName="text-white/64"
                  bodyClassName="mt-3"
                >
                  <div className="grid gap-4">
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                        Information
                      </div>
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">Model</span>
                          <span className="text-sm font-medium text-white/92">{selectedAsset.model_key ?? "Unknown"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">Preset</span>
                          <span className="text-sm font-medium text-white/92">{selectedAsset.preset_key ?? "builtin"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                          <span className="text-sm text-white/56">Type</span>
                          <span className="text-sm font-medium text-white/92">{selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "asset"}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void toggleAssetFavorite(selectedAsset)}
                          disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
                          className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.05] disabled:opacity-60"
                        >
                          <span className="text-sm text-white/56">Favorite</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-2 text-sm font-medium",
                              selectedAsset.favorited ? "text-[#ff9abc]" : "text-white/72",
                            )}
                          >
                            <Heart className={cn("size-4", selectedAsset.favorited ? "fill-current" : "")} />
                            {selectedAsset.favorited ? "Saved" : "Off"}
                          </span>
                        </button>
                        {Object.entries((selectedAsset.payload?.resolved_options as Record<string, unknown> | undefined) ?? {})
                          .filter(([, value]) => value != null && value !== "")
                          .slice(0, 6)
                          .map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                              <span className="text-sm text-white/56">{optionShortLabel(key)}</span>
                              <span className="text-sm font-medium text-white/92">{displayChoiceLabel(key, {}, value) || formatOptionValue(value)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                </CollapsibleSubsection>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedAsset && selectedMediaLightboxOpen ? (
        <StudioLightbox
          selectedAsset={selectedAsset}
          selectedAssetDisplayVisual={selectedAssetDisplayVisual}
          selectedAssetPlaybackVisual={selectedAssetPlaybackVisual}
          selectedAssetLightboxVisual={selectedAssetLightboxVisual}
          lightboxVideoRef={lightboxVideoRef}
          onClose={closeSelectedMediaLightbox}
        />
      ) : null}

      {!immersive ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <Panel>
          <PanelHeader
            eyebrow="Queue"
            title="Recent jobs"
            description="The stage above is the operator-facing create surface. This queue keeps the current Control API job state visible while runs are moving."
          />
          <div className="mt-5 grid gap-3">
            {localJobs.length ? (
              localJobs.slice(0, 6).map((job) => (
                <div
                  key={job.job_id}
                  className="rounded-[22px] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.78)] px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium tracking-[-0.02em] text-[var(--foreground)]">
                        {job.model_key ?? "Unknown model"}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                        {truncate(job.final_prompt_used || job.enhanced_prompt || job.raw_prompt || "No prompt recorded.", 160)}
                      </p>
                    </div>
                    <StatusPill label={job.status} tone={toneForStatus(job.status)} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                    <span>{formatDateTime(job.created_at)}</span>
                    <span>•</span>
                    <span>{job.provider_task_id ?? "local staging"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4 text-sm leading-7 text-[var(--muted-strong)]">
                No media jobs are stored yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Lineage"
            title="Current create context"
            description="A compact view of the prompt strategy currently staged in the bottom dock."
          />
          <div className="mt-5 grid gap-3">
            <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Model
              </div>
              <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                {currentModel?.label ?? "No model selected"}
              </div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Selected prompts
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedPromptList.length ? (
                  selectedPromptList.map((promptItem) => (
                    <span
                      key={promptItem.prompt_id}
                      className="rounded-full border border-[rgba(208,255,72,0.24)] bg-[rgba(208,255,72,0.12)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--accent-strong)]"
                    >
                      @{promptItem.key}
                    </span>
                  ))
                ) : (
                  <span className="text-sm leading-7 text-[var(--muted-strong)]">No system prompts selected yet.</span>
                )}
              </div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Preflight
              </div>
              <div className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                {validation?.resolved_system_prompt?.rendered_system_prompt
                  ? String(validation.resolved_system_prompt.rendered_system_prompt)
                  : "Run preflight to see the rendered system prompt and resolved options before submit."}
              </div>
            </div>
          </div>
        </Panel>
        </div>
      ) : null}
    </div>
  );
}
