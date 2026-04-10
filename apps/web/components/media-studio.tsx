"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CircleDollarSign,
  ChevronDown,
  Coins,
  Clapperboard,
  Copy,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from "lucide-react";

import { useGlobalActivity } from "@/components/global-activity";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { MediaModelsConsole } from "@/components/media-models-console";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { StudioGallery } from "@/components/studio/studio-gallery";
import { StudioHeaderChrome } from "@/components/studio/studio-header-chrome";
import { StudioInspectorInfo } from "@/components/studio/studio-inspector-info";
import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { StudioComposer } from "@/components/studio/studio-composer";
import { StudioMetricPill } from "@/components/studio/studio-metric-pill";
import { StudioPresetBrowser } from "@/components/studio/studio-preset-browser";
import { useStudioComposer } from "@/hooks/studio/use-studio-composer";
import { useStudioGalleryFeed } from "@/hooks/studio/use-studio-gallery-feed";
import { useStudioPolling } from "@/hooks/studio/use-studio-polling";
import { useStudioSelection } from "@/hooks/studio/use-studio-selection";
import { StudioInspectorActions } from "@/components/studio/studio-inspector-actions";
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
  structuredPresetInputValues,
  structuredPresetSlotValues,
} from "@/lib/studio-gallery";
import {
  batchPhaseMessage,
  buildStudioJobPrimaryInput,
  buildStudioJobReferenceInputs,
  buildStudioReferencePreviews,
  buildChoiceList,
  buildNormalizedStudioOptions,
  classifyFile,
  displayChoiceLabel,
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
  parseMultiShotScript,
  parseOptionChoice,
  pickerMenuHeightCap,
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
  type StudioReferencePreview,
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
import { installStudioDebugConsole, studioDebug } from "@/lib/studio-debug";
import { cn, formatDateTime, truncate } from "@/lib/utils";

declare global {
  interface Window {
    __mediaStudioTest?: {
      composer?: {
        setModel: (modelKey: string) => void;
      };
      enhancement?: {
        openDialog: () => void;
        requestPreview: () => Promise<void>;
        usePrompt: () => boolean;
      };
    };
  }
}

function StudioPillSelect({
  pickerId,
  openPicker,
  setOpenPicker,
  widthClass,
  icon: Icon,
  choiceIcon,
  label,
  choices,
  selectedValue,
  menuTitle,
  onSelect,
}: {
  pickerId: string;
  openPicker: string | null;
  setOpenPicker: (value: string | null) => void;
  widthClass: string;
  icon: React.ComponentType<{ className?: string }>;
  choiceIcon?: (choice: StudioChoice) => React.ComponentType<{ className?: string }>;
  label: string;
  choices: StudioChoice[];
  selectedValue?: string;
  menuTitle?: string;
  onSelect: (value: string) => void;
}) {
  const isOpen = openPicker === pickerId;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"up" | "down">("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState(280);
  const normalizedTitle = (menuTitle ?? pickerId.replaceAll("-", " ").replaceAll("_", " "))
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const selectedChoice =
    choices.find((choice) => choice.value === selectedValue) ??
    choices.find((choice) => choice.label === label) ??
    null;
  const SelectedIcon = selectedChoice ? choiceIcon?.(selectedChoice) ?? Icon : Icon;
  const fallbackChoices = selectedChoice
    ? choices.filter((choice) => choice.value !== selectedChoice.value)
    : choices;

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
      const preferUp = spaceAbove >= 220 || spaceAbove >= spaceBelow;
      const nextPlacement = preferUp ? "up" : "down";
      const availableSpace = nextPlacement === "down" ? spaceBelow : spaceAbove;
      setMenuPlacement(nextPlacement);
      setMenuMaxHeight(Math.max(180, Math.min(availableSpace, pickerMenuHeightCap(pickerId))));
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
        className="flex h-10 w-full items-center gap-2.5 rounded-[16px] border border-white/8 bg-white/[0.04] px-3 text-left text-[0.74rem] font-semibold tracking-[0.01em] text-white transition hover:border-[rgba(216,141,67,0.22)]"
      >
        <SelectedIcon className="size-4 shrink-0 text-[rgba(208,255,72,0.92)]" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-white/42 transition", isOpen ? "rotate-180" : "")} />
      </button>

      {isOpen ? (
        <div
          style={{ maxHeight: `${menuMaxHeight}px` }}
          className={cn(
            "absolute left-0 z-30 min-w-full w-max max-w-[28rem] overflow-auto rounded-[18px] border border-white/10 bg-[rgba(17,20,19,0.98)] p-2 shadow-[0_24px_52px_rgba(0,0,0,0.44)] backdrop-blur-xl",
            menuPlacement === "down" ? "top-[calc(100%+0.65rem)]" : "bottom-[calc(100%+0.65rem)]",
          )}
        >
          <div className="grid gap-2">
            <div className="px-2 pt-1 text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-white/38">
              {normalizedTitle}
            </div>

            {selectedChoice ? (
              <button
                type="button"
                data-testid={`studio-picker-option-${pickerId}-${selectedChoice.value || "empty"}`}
                onClick={() => {
                  onSelect(selectedChoice.value);
                  setOpenPicker(null);
                }}
                className="flex items-center gap-2.5 rounded-[14px] border border-white/10 bg-white/[0.08] px-2.5 py-2.5 text-left transition hover:border-[rgba(216,141,67,0.24)] hover:bg-white/[0.1]"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-white/10 bg-white/[0.06] text-white/92">
                  <SelectedIcon className="size-4 text-[rgba(208,255,72,0.92)]" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.9rem] font-medium text-white">{selectedChoice.label}</span>
                <Check className="size-4 shrink-0 text-white/56" />
              </button>
            ) : null}

            <div className="grid gap-1">
              {fallbackChoices.map((choice) => {
                const ChoiceIcon = choiceIcon?.(choice) ?? Icon;
                return (
                  <button
                    key={`${pickerId}:${choice.value}`}
                    type="button"
                    data-testid={`studio-picker-option-${pickerId}-${choice.value || "empty"}`}
                    onClick={() => {
                      onSelect(choice.value);
                      setOpenPicker(null);
                    }}
                    className="flex items-center gap-2 rounded-[12px] px-2.5 py-2.5 text-left text-[0.8rem] font-medium text-white/82 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-white/10 bg-white/[0.04] text-white/88">
                      <ChoiceIcon className="size-3.5 text-white/72" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StudioStagedMediaTile({
  preview,
  visualUrl,
  footerLabel,
  onOpenPreview,
  onRemove,
  replaceControl,
  className,
  tileClassName,
  testId,
}: {
  preview: StudioReferencePreview;
  visualUrl?: string | null;
  footerLabel?: string | null;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  onRemove?: () => void;
  replaceControl?: React.ReactNode;
  className?: string;
  tileClassName?: string;
  testId?: string;
}) {
  const mediaVisual = visualUrl ?? (preview.kind === "images" ? preview.url : preview.posterUrl ?? null);

  return (
    <div data-testid={testId} className={cn("group relative", className)}>
      <button
        type="button"
        onClick={() => onOpenPreview(preview)}
        className={cn("relative h-full w-full overflow-hidden rounded-[24px] border border-white/8 bg-white/8 text-left", tileClassName)}
        title={preview.label}
      >
        {preview.kind === "videos" ? (
          mediaVisual ? (
            <>
              <img
                src={mediaVisual}
                alt={preview.label}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/28">
                <Play className="size-4 text-white" />
              </span>
            </>
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-white/[0.05] text-white/72">
              <Play className="size-5" />
            </span>
          )
        ) : preview.kind === "audios" ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white/[0.05] text-white/72">
            <Volume2 className="size-5" />
            <span className="text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-white/58">Audio</span>
          </span>
        ) : mediaVisual ? (
          <img
            src={mediaVisual}
            alt={preview.label}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-white/[0.05] text-white/72">
            <ImageIcon className="size-5" />
          </span>
        )}
        {footerLabel ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-white/92">
            {footerLabel}
          </div>
        ) : null}
      </button>
      {replaceControl ? <div className="absolute bottom-1.5 left-1.5 z-10">{replaceControl}</div> : null}
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="absolute right-1.5 top-1.5 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-[rgba(11,14,13,0.88)] text-white/76 opacity-100 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:text-white md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          aria-label={`Remove ${preview.label}`}
          title={`Remove ${preview.label}`}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function composerModelLabel(label: string | null | undefined) {
  if (!label) return "Model";
  if (label === "Seedance 2.0 Standard") return "Seedance 2.0";
  return label;
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
  const [localRemainingCredits, setLocalRemainingCredits] = useState<number | null>(remainingCredits ?? null);
  const [studioSettingsOpen, setStudioSettingsOpen] = useState(false);
  const [presetBrowserOpen, setPresetBrowserOpen] = useState(false);
  const [formMessage, setFormMessage] = useState<ComposerStatusMessage | null>(null);
  const [copyPromptStatus, setCopyPromptStatus] = useState<"idle" | "copied" | "error">("idle");
  const [selectedFailedJobId, setSelectedFailedJobId] = useState<string | null>(null);
  const [selectedReferencePreview, setSelectedReferencePreview] = useState<StudioReferencePreview | null>(null);
  const [pendingGalleryStep, setPendingGalleryStep] = useState<"next" | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const lastComposerDebugSignatureRef = useRef<string | null>(null);
  const copyPromptStatusTimerRef = useRef<number | null>(null);
  const pollJobProxyRef = useRef<(jobId: string) => Promise<void>>(async () => {});
  const pollBatchProxyRef = useRef<(batchId: string) => Promise<void>>(async () => {});
  const openEnhanceDialogProxyRef = useRef<() => void>(() => undefined);
  const requestEnhancementPreviewProxyRef = useRef<() => Promise<void>>(async () => undefined);
  const applyEnhancementPromptProxyRef = useRef<() => boolean>(() => false);
  const enabledStudioModels = useMemo(
    () =>
      models.filter((model) => {
        const policy = queuePolicies.find((entry) => entry.model_key === model.key);
        return policy?.enabled ?? true;
      }),
    [models, queuePolicies],
  );
  useEffect(() => {
    setLocalRemainingCredits(remainingCredits ?? null);
  }, [remainingCredits]);

  async function refreshCreditBalance() {
    try {
      const response = await fetch("/api/control/media/credits", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as {
        available_credits?: number | null;
        remaining_credits?: number | null;
        raw?: { available_credits?: number | null; remaining_credits?: number | null } | null;
      };
      const nextCredits =
        typeof payload.available_credits === "number"
          ? payload.available_credits
          : typeof payload.remaining_credits === "number"
            ? payload.remaining_credits
            : typeof payload.raw?.available_credits === "number"
              ? payload.raw.available_credits
              : typeof payload.raw?.remaining_credits === "number"
                ? payload.raw.remaining_credits
                : null;
      setLocalRemainingCredits(nextCredits);
    } catch {
      // Balance refresh is best-effort; do not surface transient credit fetch noise in Studio.
    }
  }
  const refreshStudioDataWithSettleDelay = () => {
    startRefresh(() => router.refresh());
    window.setTimeout(() => {
      startRefresh(() => router.refresh());
    }, 1400);
  };

  useEffect(() => {
    return () => {
      if (copyPromptStatusTimerRef.current != null) {
        window.clearTimeout(copyPromptStatusTimerRef.current);
      }
    };
  }, []);
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
  const visibleGalleryAssetIds = useMemo(
    () => galleryTiles.map((tile) => tile.asset?.asset_id).filter((assetId): assetId is string | number => assetId != null),
    [galleryTiles],
  );
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
  const selectedFailedJob = useMemo(() => {
    if (!selectedFailedJobId) {
      return null;
    }
    const directMatch = localJobs.find((job) => job.job_id === selectedFailedJobId) ?? null;
    if (directMatch) {
      return directMatch;
    }
    for (const batch of localBatches) {
      const match = (batch.jobs ?? []).find((job) => job.job_id === selectedFailedJobId) ?? null;
      if (match) {
        return match;
      }
    }
    return null;
  }, [localBatches, localJobs, selectedFailedJobId]);
  const selectedFailedJobPrompt =
    selectedFailedJob?.final_prompt_used ?? selectedFailedJob?.enhanced_prompt ?? selectedFailedJob?.raw_prompt ?? null;
  const selectedFailedJobReferenceInputs = useMemo(
    () => buildStudioJobReferenceInputs({ job: selectedFailedJob, localAssets, favoriteAssets }),
    [favoriteAssets, localAssets, selectedFailedJob],
  );
  const selectedFailedJobPrimaryInput = useMemo(
    () => buildStudioJobPrimaryInput({ job: selectedFailedJob, localAssets, favoriteAssets }),
    [favoriteAssets, localAssets, selectedFailedJob],
  );
  const selectedFailedJobImageReferences = useMemo(
    () => selectedFailedJobReferenceInputs.filter((reference) => reference.kind === "images"),
    [selectedFailedJobReferenceInputs],
  );
  const selectedAssetReferencePreviews = useMemo(
    () =>
      buildStudioReferencePreviews({
        asset: selectedAsset,
        job: selectedAssetJob,
        presetSlots: selectedAssetPresetSlots,
        presetSlotValues: selectedAssetPresetSlotValues,
        localAssets,
        favoriteAssets,
      }),
    [
      favoriteAssets,
      localAssets,
      selectedAsset,
      selectedAssetJob,
      selectedAssetPresetSlotValues,
      selectedAssetPresetSlots,
    ],
  );
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

  useEffect(() => {
    setSelectedReferencePreview(null);
  }, [selectedAssetId]);
  const composer = useStudioComposer({
    models,
    presets,
    prompts,
    enhancementConfigs,
    queueSettings,
    queuePolicies,
    pricingSnapshot,
    remainingCredits: localRemainingCredits,
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
    refreshCreditBalance,
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
    seedanceComposer,
    effectiveSeedanceMode,
    enhanceEnabledForModel,
    enhanceConfiguredForModel,
    enhanceSetupHref,
    enhanceProviderLabel,
    enhanceProviderModelId,
    enhanceModeLabel,
    enhanceReadinessLabel,
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
    availableStudioPresets,
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
    seedanceFirstFrameAttachment,
    seedanceLastFrameAttachment,
    seedanceReferenceImages,
    seedanceReferenceVideos,
    seedanceReferenceAudios,
    seedanceReferenceGuideTokens,
    seedanceReferenceGuideText,
    canUseSourceAsset,
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
    applyPresetSelection,
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

  function openReferencePreview(preview: StudioReferencePreview | null) {
    if (!preview?.url) {
      return;
    }
    setSelectedReferencePreview(preview);
  }

  function buildAttachmentPreview(
    attachment: AttachmentRecord | null | undefined,
    label: string,
    previewKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ): StudioReferencePreview | null {
    const url = attachment?.previewUrl ?? null;
    if (!url) {
      return null;
    }
    return {
      key: `attachment:${attachment?.id ?? previewKey}`,
      label,
      url,
      kind: attachment?.kind ?? "images",
      posterUrl: attachment?.kind === "videos" ? null : undefined,
    };
  }

  function buildAssetReferencePreview(asset: MediaAsset | null | undefined, label: string): StudioReferencePreview | null {
    if (!asset) {
      return null;
    }
    const kind =
      asset.generation_kind === "video"
        ? ("videos" as const)
        : asset.generation_kind === "audio"
          ? ("audios" as const)
          : ("images" as const);
    const posterUrl =
      kind === "videos" ? mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset) ?? null : null;
    const url =
      (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
      mediaInlineUrl(asset) ??
      mediaDisplayUrl(asset) ??
      mediaThumbnailUrl(asset) ??
      null;
    if (!url) {
      return null;
    }
    return {
      key: `asset:${asset.asset_id}`,
      label,
      url,
      kind,
      posterUrl,
    };
  }

  useEffect(() => {
    installStudioDebugConsole();
  }, []);

  useEffect(() => {
    if (!composerStatusMessage?.text) {
      lastComposerDebugSignatureRef.current = null;
      return;
    }
    const signature = `${composerStatusMessage.tone}:${composerStatusMessage.text}:${busyState}`;
    if (lastComposerDebugSignatureRef.current === signature) {
      return;
    }
    lastComposerDebugSignatureRef.current = signature;
    studioDebug("composer-status", {
      tone: composerStatusMessage.tone,
      text: composerStatusMessage.text,
      busyState,
      modelKey,
      inputPatterns: currentModel?.input_patterns ?? [],
    });
  }, [busyState, composerStatusMessage, currentModel?.input_patterns, modelKey]);

  const polling = useStudioPolling({
    showActivity,
    showFloatingComposerBanner,
    setFormMessage,
    refreshStudioDataWithSettleDelay,
    refreshActiveGalleryAssets,
    setLocalJobs,
    setLocalBatches: gallery.actions.setLocalBatches,
    upsertBatch,
    setLocalAssets,
    setFavoriteAssets,
    setLocalLatestAsset,
    applyFavoriteAssetUpdate,
    selectedAssetId,
    selectedFailedJobId,
    sourceAssetId,
    setSelectedAssetId,
    setSelectedFailedJobId,
    setSourceAssetId,
    startRefresh,
    refreshRoute: () => router.refresh(),
    refreshCreditBalance,
  });
  const { favoriteAssetIdBusy } = polling.state;
  const { pollJob, pollBatch, retryJob, dismissJob, dismissAsset, toggleAssetFavorite } = polling.actions;
  const downloadActionLabel = hasMounted ? mobileSaveActionLabel() : "Download";
  const mobileComposerExpanded = !mobileComposerCollapsed;

  function revealComposer(options: { focusPresetField?: boolean } = {}) {
    setMobileComposerCollapsed(!isCoarsePointerDevice());

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const composerRoot = composerShellRef.current;
        if (!composerRoot) {
          return;
        }

        const focusTarget = options.focusPresetField
          ? ((composerRoot.querySelector("input[placeholder], input[type='text'], textarea") as HTMLElement | null) ?? promptInputRef.current)
          : promptInputRef.current;
        focusTarget?.focus();
      });
    });
  }

  function applyEnhancementPrompt() {
    const nextPrompt = enhancePreview?.final_prompt_used || enhancePreview?.enhanced_prompt;
    if (!nextPrompt) {
      return false;
    }
    setPrompt(nextPrompt);
    setEnhanceDialogOpen(false);
    setFormMessage({ tone: "healthy", text: "Loaded the enhanced prompt into the composer." });
    return true;
  }
  openEnhanceDialogProxyRef.current = openEnhanceDialog;
  requestEnhancementPreviewProxyRef.current = requestEnhancementPreview;
  applyEnhancementPromptProxyRef.current = applyEnhancementPrompt;

  const openEnhancementSetup = () => {
    void router.push(enhanceSetupHref);
  };

  function loadPresetIntoStudio(presetIdOrKey: string) {
    applyPresetSelection(presetIdOrKey, { preferredModelKey: modelKey });
    setPresetBrowserOpen(false);
    setSelectedAssetId(null);
    setSelectedFailedJobId(null);
    setSelectedMediaLightboxOpen(false);
    setSelectedReferencePreview(null);
    setOpenPicker(null);
    revealComposer({ focusPresetField: true });
    setFormMessage({ tone: "healthy", text: "Preset loaded into the composer." });
  }

  useEffect(() => {
    if (typeof window === "undefined" || !window.navigator.webdriver) {
      return;
    }
    window.__mediaStudioTest = {
      ...(window.__mediaStudioTest ?? {}),
      composer: {
        setModel: (nextModelKey) => setModelKey(nextModelKey),
      },
      enhancement: {
        openDialog: () => openEnhanceDialogProxyRef.current(),
        requestPreview: () => requestEnhancementPreviewProxyRef.current(),
        usePrompt: () => applyEnhancementPromptProxyRef.current(),
      },
    };
    return () => {
      if (!window.__mediaStudioTest) {
        return;
      }
      delete window.__mediaStudioTest.composer;
      delete window.__mediaStudioTest.enhancement;
      if (Object.keys(window.__mediaStudioTest).length === 0) {
        delete window.__mediaStudioTest;
      }
    };
  }, []);
  useEffect(() => {
    pollJobProxyRef.current = pollJob;
    pollBatchProxyRef.current = pollBatch;
  }, [pollBatch, pollJob]);
  const dedicatedImageReferenceRailActive =
    !structuredPresetActive &&
    !seedanceComposer &&
    !explicitVideoImageSlots &&
    maxImageInputs > 1 &&
    maxVideoInputs === 0 &&
    maxAudioInputs === 0 &&
    orderedImageInputs.length > 0;
  const multiImageReferenceStrip = dedicatedImageReferenceRailActive ? (
    <div className="overflow-hidden rounded-[26px] border border-white/10 bg-[rgba(21,24,23,0.84)] px-4 py-3 shadow-[0_22px_54px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/44">Image references</div>
        {imageLimitLabel ? (
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/62">
            {imageLimitLabel}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 items-start gap-3 overflow-x-auto overflow-y-hidden pb-1">
        {orderedImageInputs.map((slot, slotIndex) => {
          const slotVisual =
            slot.source === "asset"
              ? mediaThumbnailUrl(slot.asset) ?? mediaDisplayUrl(slot.asset)
              : slot.attachment.previewUrl ?? null;
          const slotLabel = imageSlotLabels[slotIndex] ?? `Image ${slotIndex + 1}`;
          const slotPreview =
            slot.source === "asset"
              ? buildAssetReferencePreview(slot.asset, slotLabel)
              : buildAttachmentPreview(slot.attachment as AttachmentRecord, slotLabel, `multi-image-${slotIndex + 1}`);
          return (
            <div key={`multi-image-slot-${slotIndex}`} className="flex shrink-0 flex-col gap-2">
              <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">{slotLabel}</div>
              {slotPreview ? (
                <StudioStagedMediaTile
                  preview={slotPreview}
                  visualUrl={slotVisual}
                  footerLabel={slot.source === "asset" ? "Source" : `Ref ${slotIndex + 1}`}
                  onOpenPreview={openReferencePreview}
                  onRemove={() => {
                    if (slot.source === "asset") {
                      setSourceAssetId(null);
                    } else {
                      removeAttachment(slot.attachment.id);
                    }
                  }}
                  className="h-[82px] w-[82px]"
                  tileClassName={slot.source === "asset" ? "border-[rgba(216,141,67,0.24)]" : undefined}
                  testId={`studio-multi-image-slot-${slotIndex + 1}`}
                />
              ) : null}
            </div>
          );
        })}

        {canAddMoreImages ? (
          <div className="flex shrink-0 flex-col gap-2">
            <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">
              {imageSlotLabels[orderedImageInputs.length] ?? `Image ${orderedImageInputs.length + 1}`}
            </div>
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
              )}
            >
              <Plus className="size-6" />
              <input
                type="file"
                multiple
                accept="image/*"
                data-testid="studio-multi-image-input"
                className="hidden"
                onChange={(event) => {
                  addFiles(event.target.files);
                  resetFileInputValue(event.currentTarget);
                }}
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;
  const sourceAttachmentStrip = !structuredPresetActive && !dedicatedImageReferenceRailActive ? (
    <div className="flex flex-wrap gap-3">
      {seedanceComposer ? (
        <>
          {[
            { label: "Start frame", role: "first_frame", attachment: seedanceFirstFrameAttachment },
            { label: "End frame", role: "last_frame", attachment: seedanceLastFrameAttachment },
          ].map((slot, slotIndex) => {
            const attachment = slot.attachment;
            const attachmentPreview = attachment
              ? buildAttachmentPreview(attachment, slot.label, `seedance-${slot.role}`)
              : null;
            return (
            <div key={`seedance-slot-${slot.role}`} className="flex flex-col gap-2">
              <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">{slot.label}</div>
              <div data-testid={`seedance-slot-${slot.role}`} className="relative h-[82px] w-[82px]">
                {attachment && attachmentPreview ? (
                  <div
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragActive(true);
                    }}
                    onDragLeave={() => setIsDragActive(false)}
                    onDrop={(event) => void handleSourceTileDrop(event, slotIndex)}
                    className="h-full w-full"
                  >
                    <StudioStagedMediaTile
                      preview={attachmentPreview}
                      visualUrl={attachment.previewUrl}
                      onOpenPreview={openReferencePreview}
                      onRemove={() => removeAttachment(attachment.id)}
                      replaceControl={
                        <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/12 bg-[rgba(11,14,13,0.88)] text-white/76 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:text-white">
                          <ImagePlus className="size-3.5" />
                          <input
                            type="file"
                            accept="image/*"
                            data-testid={`seedance-slot-input-${slot.role}`}
                            className="hidden"
                            onChange={(event) => {
                              if (slot.role === "last_frame" && !seedanceFirstFrameAttachment) {
                                setFormMessage({ tone: "warning", text: "Add a start frame before the end frame." });
                                resetFileInputValue(event.currentTarget);
                                return;
                              }
                              removeAttachment(attachment.id);
                              addFiles(event.target.files, {
                                role: slot.role as "first_frame" | "last_frame",
                                allowedKinds: ["images"],
                              });
                              resetFileInputValue(event.currentTarget);
                            }}
                          />
                        </label>
                      }
                      className="h-full w-full"
                      testId={`seedance-slot-filled-${slot.role}`}
                    />
                  </div>
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
                      data-testid={`seedance-slot-input-${slot.role}`}
                      className="hidden"
                      onChange={(event) => {
                        if (slot.role === "last_frame" && !seedanceFirstFrameAttachment) {
                          setFormMessage({ tone: "warning", text: "Add a start frame before the end frame." });
                          resetFileInputValue(event.currentTarget);
                          return;
                        }
                        addFiles(event.target.files, {
                          role: slot.role as "first_frame" | "last_frame",
                          allowedKinds: ["images"],
                        });
                        resetFileInputValue(event.currentTarget);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          )})}
        </>
      ) : explicitVideoImageSlots ? (
        <>
          {Array.from({ length: maxImageInputs }, (_, slotIndex) => {
            const slot = orderedImageInputs[slotIndex] ?? null;
            const slotVisual =
              slot?.source === "asset"
                ? mediaThumbnailUrl(slot.asset)
                : slot?.attachment?.previewUrl ?? null;
            const slotLabel = imageSlotLabels[slotIndex] ?? `Image ${slotIndex + 1}`;
            const slotFilled = Boolean(slot);
            const slotPreview =
              slot?.source === "asset"
                ? buildAssetReferencePreview(slot.asset, slotLabel)
                : slot?.source === "attachment"
                  ? buildAttachmentPreview(slot.attachment as AttachmentRecord, slotLabel, `video-slot-${slotIndex + 1}`)
                  : null;
            return (
              <div key={`video-image-slot-${slotIndex}`} className="flex flex-col gap-2">
                <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">{slotLabel}</div>
                <div className="relative h-[82px] w-[82px]">
                  {slotFilled && slotPreview ? (
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsDragActive(true);
                      }}
                      onDragLeave={() => setIsDragActive(false)}
                      onDrop={(event) => void handleSourceTileDrop(event, slotIndex)}
                      className="h-full w-full"
                    >
                      <StudioStagedMediaTile
                        preview={slotPreview}
                        visualUrl={slotVisual}
                        onOpenPreview={openReferencePreview}
                        onRemove={() => {
                          if (slot?.source === "asset") {
                            setSourceAssetId(null);
                          } else if (slot?.source === "attachment") {
                            removeAttachment(slot.attachment.id);
                          }
                        }}
                        replaceControl={
                          <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/12 bg-[rgba(11,14,13,0.88)] text-white/76 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:text-white">
                            <ImagePlus className="size-3.5" />
                            <input
                              type="file"
                              accept="image/*"
                              data-testid={`studio-source-slot-input-${slotIndex + 1}`}
                              className="hidden"
                              onChange={(event) => {
                                if (slot?.source === "asset") {
                                  setSourceAssetId(null);
                                } else if (slot?.source === "attachment") {
                                  removeAttachment(slot.attachment.id);
                                }
                                addFiles(event.target.files);
                                resetFileInputValue(event.currentTarget);
                              }}
                            />
                          </label>
                        }
                        className="h-full w-full"
                        tileClassName={slot?.source === "asset" ? "border-[rgba(216,141,67,0.24)]" : undefined}
                        testId={`studio-source-slot-filled-${slotIndex + 1}`}
                      />
                    </div>
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
                        data-testid={`studio-source-slot-input-${slotIndex + 1}`}
                        className="hidden"
                        onChange={(event) => {
                          if (slotIndex > orderedImageInputs.length) {
                            setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
                            resetFileInputValue(event.currentTarget);
                            return;
                          }
                          addFiles(event.target.files);
                          resetFileInputValue(event.currentTarget);
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
          {canUseSourceAsset && currentSourceAsset ? (
            <StudioStagedMediaTile
              preview={
                buildAssetReferencePreview(currentSourceAsset, currentSourceAsset.prompt_summary ?? "Source asset") ??
                {
                  key: `asset:${currentSourceAsset.asset_id}`,
                  label: currentSourceAsset.prompt_summary ?? "Source asset",
                  url: mediaThumbnailUrl(currentSourceAsset) ?? "",
                  kind: currentSourceAsset.generation_kind === "video" ? "videos" : "images",
                  posterUrl: mediaThumbnailUrl(currentSourceAsset) ?? null,
                }
              }
              visualUrl={mediaThumbnailUrl(currentSourceAsset) ?? mediaDisplayUrl(currentSourceAsset)}
              onOpenPreview={openReferencePreview}
              onRemove={() => setSourceAssetId(null)}
              className="h-[82px] w-[82px]"
              tileClassName="border-[rgba(216,141,67,0.24)]"
              testId="studio-source-asset-tile"
            />
          ) : null}

          {attachments.slice(0, 4).map((attachment) => (
            <StudioStagedMediaTile
              key={attachment.id}
              preview={
                buildAttachmentPreview(attachment, attachment.file.name, attachment.id) ?? {
                  key: `attachment:${attachment.id}`,
                  label: attachment.file.name,
                  url: attachment.previewUrl ?? "",
                  kind: attachment.kind,
                  posterUrl: null,
                }
              }
              visualUrl={attachment.kind === "audios" ? null : attachment.previewUrl}
              footerLabel={attachment.kind === "images" ? "Image" : attachment.kind === "videos" ? "Video" : "Audio"}
              onOpenPreview={openReferencePreview}
              onRemove={() => removeAttachment(attachment.id)}
              className="h-[82px] w-[82px]"
              testId={`studio-attachment-tile-${attachment.id}`}
            />
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
              data-testid="studio-source-input"
              className="hidden"
              disabled={!canAddMoreImages && !canAddMoreVideos && !canAddMoreAudios}
              onChange={(event) => {
                addFiles(event.target.files);
                resetFileInputValue(event.currentTarget);
              }}
            />
          </label>
        </>
      )}
      {(imageLimitLabel || maxVideoInputs > 0 || maxAudioInputs > 0) && !explicitVideoImageSlots && !seedanceComposer ? (
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
  const seedanceReferenceStrip =
    seedanceComposer ? (
      <div className="rounded-[26px] border border-white/10 bg-[rgba(21,24,23,0.84)] px-4 py-3 shadow-[0_22px_54px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
        <div className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/44">Seedance References</div>
        <div className="grid gap-2.5 lg:grid-cols-3">
          {[
            {
              key: "images",
              label: "Image refs",
              attachments: seedanceReferenceImages,
              accept: "image/*",
            },
            {
              key: "videos",
              label: "Video refs",
              attachments: seedanceReferenceVideos,
              accept: "video/*",
            },
            {
              key: "audios",
              label: "Audio refs",
              attachments: seedanceReferenceAudios,
              accept: "audio/*",
            },
          ].map((group) => (
            <div
              key={group.key}
              data-testid={`seedance-group-${group.key}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) =>
                void handleSeedanceReferenceDrop(event, group.key as "images" | "videos" | "audios")
              }
              className={cn(
                "relative rounded-[20px] border border-white/8 bg-white/[0.035] px-3 py-2.5 transition",
                isDragActive ? "border-[rgba(216,141,67,0.3)] bg-[rgba(32,38,35,0.9)]" : "",
              )}
            >
              <div className="absolute left-3 top-2.5 rounded-full border border-white/8 bg-black/18 px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.12em] text-white/42">
                {group.attachments.length}
                {group.key === "images" ? " / 9" : " / 3"}
              </div>
              <div className="mb-2 flex items-center justify-between gap-3 pt-4">
                <div className="min-w-0">
                  <div className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-white/52">{group.label}</div>
                </div>
                <label className="flex h-[56px] w-[56px] shrink-0 cursor-pointer items-center justify-center rounded-[18px] border border-dashed border-white/12 bg-white/[0.05] text-white/82 transition hover:border-[rgba(216,141,67,0.28)] hover:bg-white/[0.09]">
                  <Plus className="size-4.5" />
                  <input
                    type="file"
                    multiple
                    accept={group.accept}
                    data-testid={`seedance-group-input-${group.key}`}
                    className="hidden"
                    onChange={(event) => {
                      addFiles(event.target.files, {
                        role: "reference",
                        allowedKinds: [group.key as "images" | "videos" | "audios"],
                      });
                      resetFileInputValue(event.currentTarget);
                    }}
                  />
                </label>
              </div>
              <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
                {group.attachments.slice(0, 4).map((attachment) => (
                  <StudioStagedMediaTile
                    key={attachment.id}
                    preview={
                      buildAttachmentPreview(attachment, attachment.file.name, `${group.key}-${attachment.id}`) ?? {
                        key: `attachment:${attachment.id}`,
                        label: attachment.file.name,
                        url: attachment.previewUrl ?? "",
                        kind: attachment.kind,
                        posterUrl: null,
                      }
                    }
                    visualUrl={attachment.kind === "audios" ? null : attachment.previewUrl}
                    onOpenPreview={openReferencePreview}
                    onRemove={() => removeAttachment(attachment.id)}
                    className="h-[56px] w-[56px] shrink-0"
                    testId={`seedance-group-tile-${group.key}-${attachment.id}`}
                  />
                ))}
                {group.attachments.length > 4 ? (
                  <div className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-[18px] border border-white/8 bg-white/[0.04] text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-white/58">
                    +{group.attachments.length - 4}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    setOutputCount((current) => Math.min(Math.max(1, current), modelMaxOutputs));
  }, [modelMaxOutputs]);

  const lockingOverlayOpen =
    Boolean(selectedAssetId) ||
    studioSettingsOpen ||
    presetBrowserOpen ||
    selectedMediaLightboxOpen ||
    Boolean(selectedReferencePreview);

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

  useEffect(() => {
    if (!selectedAsset) {
      setPendingGalleryStep(null);
      return;
    }
    const currentIndex = visibleGalleryAssetIds.findIndex((assetId) => String(assetId) === String(selectedAsset.asset_id));
    if (currentIndex === -1) {
      setPendingGalleryStep(null);
      return;
    }

    if (pendingGalleryStep === "next") {
      if (currentIndex < visibleGalleryAssetIds.length - 1) {
        const nextAssetId = visibleGalleryAssetIds[currentIndex + 1];
        if (nextAssetId != null) {
          setPendingGalleryStep(null);
          setSelectedFailedJobId(null);
          setSelectedAssetId(nextAssetId);
          return;
        }
      }
      if (!activeGalleryHasMore && !activeGalleryLoadingMore) {
        setPendingGalleryStep(null);
      }
      return;
    }

    if (visibleGalleryAssetIds.length < 2) {
      return;
    }

    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tagName = target.tagName.toLowerCase();
      return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "ArrowRight" && currentIndex === visibleGalleryAssetIds.length - 1 && activeGalleryHasMore) {
        event.preventDefault();
        if (!activeGalleryLoadingMore && pendingGalleryStep == null) {
          setPendingGalleryStep("next");
          void loadMoreActiveGalleryAssets();
        }
        return;
      }
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + visibleGalleryAssetIds.length) % visibleGalleryAssetIds.length;
      const nextAssetId = visibleGalleryAssetIds[nextIndex];
      if (nextAssetId == null || String(nextAssetId) === String(selectedAsset.asset_id)) {
        return;
      }
      event.preventDefault();
      setSelectedFailedJobId(null);
      setSelectedAssetId(nextAssetId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeGalleryHasMore,
    activeGalleryLoadingMore,
    loadMoreActiveGalleryAssets,
    pendingGalleryStep,
    selectedAsset,
    setSelectedAssetId,
    visibleGalleryAssetIds,
  ]);

  function handleSourceTileDrop(event: React.DragEvent<HTMLElement>, slotIndex = 0) {
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
      if (seedanceComposer) {
        const role = slotIndex === 0 ? "first_frame" : "last_frame";
        void addGalleryAssetAsAttachment(asset, role);
        return;
      }
      if (slotIndex === 0) {
        useAssetAsSource(asset, false);
        return;
      }
      void addGalleryAssetAsAttachment(asset);
      return;
    }
    if (seedanceComposer) {
      if (slotIndex > 0 && !seedanceFirstFrameAttachment) {
        setFormMessage({ tone: "warning", text: "Add a start frame before the end frame." });
        return;
      }
      addFiles(event.dataTransfer.files, {
        role: slotIndex === 0 ? "first_frame" : "last_frame",
        allowedKinds: ["images"],
      });
      return;
    }
    addFiles(event.dataTransfer.files);
  }

  function handleSeedanceReferenceDrop(
    event: React.DragEvent<HTMLElement>,
    allowedKind: "images" | "videos" | "audios",
  ) {
    event.preventDefault();
    setIsDragActive(false);
    const galleryAssetId = event.dataTransfer.getData("application/x-bumblebee-media-asset-id");
    if (galleryAssetId) {
      const asset = findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      if (!asset) {
        setFormMessage({ tone: "danger", text: "The dragged gallery asset could not be found." });
        return;
      }
      void addGalleryAssetAsAttachment(asset, "reference", [allowedKind]);
      return;
    }
    addFiles(event.dataTransfer.files, { role: "reference", allowedKinds: [allowedKind] });
  }

  function handlePresetSlotDrop(event: React.DragEvent<HTMLElement>, slotKey: string) {
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
    if (!asset) {
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

  function resetFileInputValue(input: HTMLInputElement | null) {
    if (input) {
      input.value = "";
    }
  }

  function fallbackCopyTextToClipboard(text: string) {
    if (typeof document === "undefined") {
      return false;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }

  function showCopyPromptStatus(status: "copied" | "error") {
    setCopyPromptStatus(status);
    if (copyPromptStatusTimerRef.current != null) {
      window.clearTimeout(copyPromptStatusTimerRef.current);
    }
    copyPromptStatusTimerRef.current = window.setTimeout(() => {
      setCopyPromptStatus("idle");
      copyPromptStatusTimerRef.current = null;
    }, 1800);
  }

  async function copyPromptFromAsset(promptText: string | null) {
    if (!promptText) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(promptText);
      } else if (!fallbackCopyTextToClipboard(promptText)) {
        throw new Error("Clipboard copy is not available in this browser.");
      }
      showCopyPromptStatus("copied");
      setFormMessage({ tone: "healthy", text: "Copied the selected asset prompt." });
    } catch {
      if (fallbackCopyTextToClipboard(promptText)) {
        showCopyPromptStatus("copied");
        setFormMessage({ tone: "healthy", text: "Copied the selected asset prompt." });
        return;
      }
      showCopyPromptStatus("error");
      setFormMessage({ tone: "danger", text: "Studio could not copy the prompt on this device." });
    }
  }

  function useAssetAsSource(asset: MediaAsset | null, animate = false) {
    if (!asset) {
      return;
    }
    if (seedanceComposer) {
      const role =
        effectiveSeedanceMode === "first_last_frames"
          ? seedanceFirstFrameAttachment
            ? "last_frame"
            : "first_frame"
          : effectiveSeedanceMode === "single_image"
            ? "first_frame"
            : "reference";
      void addGalleryAssetAsAttachment(asset, role);
      setSelectedMediaLightboxOpen(false);
      setSelectedAssetId(null);
      setFormMessage({
        tone: "warning",
        text:
          role === "reference"
            ? "The selected asset is now staged as a Seedance reference."
            : `The selected asset is now staged as the ${role === "first_frame" ? "first" : "last"} frame.`,
      });
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

  async function fetchReferenceFile(referenceUrl: string, label: string, kind: "images" | "videos" | "audios") {
    const response = await fetch(referenceUrl, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error("Unable to fetch the reference media.");
    }
    const blob = await response.blob();
    const fallbackExtension = kind === "videos" ? "mp4" : kind === "audios" ? "wav" : "png";
    const fallbackMime = kind === "videos" ? "video/mp4" : kind === "audios" ? "audio/wav" : "image/png";
    const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "reference";
    const urlPath = (() => {
      try {
        return new URL(referenceUrl, window.location.origin).pathname.split("/").at(-1) ?? "";
      } catch {
        return "";
      }
    })();
    const fileName = urlPath || `${safeLabel}.${fallbackExtension}`;
    return new File([blob], fileName, { type: blob.type || fallbackMime });
  }

  async function fetchAssetById(assetId: string | number) {
    const response = await fetch(`/api/control/media-assets/${assetId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; asset?: MediaAsset | null } | null;
    if (!response.ok || !payload?.ok || !payload.asset) {
      throw new Error("Unable to load the selected media asset.");
    }
    return payload.asset;
  }

  async function retryFailedJobInStudio(job: MediaJob | null) {
    if (!job) {
      return;
    }
    const targetModel = models.find((model) => model.key === job.model_key) ?? null;
    if (!targetModel) {
      setFormMessage({ tone: "danger", text: "Studio could not find the model used by this failed job." });
      return;
    }
    const targetPreset =
      presets.find(
        (preset) =>
          preset.key === job.resolved_preset_key ||
          preset.key === job.requested_preset_key ||
          preset.preset_id === job.resolved_preset_key ||
          preset.preset_id === job.requested_preset_key,
      ) ?? null;

    clearComposer();
    setModelKey(targetModel.key);
    setSelectedPresetId(targetPreset?.preset_id ?? targetPreset?.key ?? "");
    setSelectedPromptIds(job.selected_system_prompt_ids ?? []);
    setPrompt(job.final_prompt_used ?? job.enhanced_prompt ?? job.raw_prompt ?? "");
    setPresetInputValues(structuredPresetInputValues(job));
    setOptionValues(buildNormalizedStudioOptions(targetModel, (job.resolved_options as Record<string, unknown> | undefined) ?? {}, null));
    setOutputCount(Math.max(1, job.requested_outputs ?? 1));
    setValidation(null);
    setBusyState("idle");
    setOpenPicker(null);
    setEnhanceDialogOpen(false);
    setEnhancePreview(null);
    setEnhanceError(null);
    setIsDragActive(false);
    setSourceAssetId(job.source_asset_id ?? null);

    setSelectedFailedJobId(null);
    setSelectedAssetId(null);
    setSelectedMediaLightboxOpen(false);
    setSelectedReferencePreview(null);
    setMobileComposerCollapsed(false);

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    let restoredPrimaryInput = false;
    if (job.source_asset_id != null) {
      const localSourceAsset = findMediaAssetById(job.source_asset_id, localAssets, favoriteAssets);
      if (localSourceAsset) {
        setSourceAssetId(localSourceAsset.asset_id);
        restoredPrimaryInput = true;
      } else {
        try {
          const loadedSourceAsset = await fetchAssetById(job.source_asset_id);
          setLocalAssets((current) => [loadedSourceAsset, ...current.filter((asset) => asset.asset_id !== loadedSourceAsset.asset_id)]);
          setSourceAssetId(loadedSourceAsset.asset_id);
          restoredPrimaryInput = true;
        } catch {
          // fall through to local file-based source restore below
        }
      }
    }

    if (!restoredPrimaryInput && selectedFailedJobPrimaryInput) {
      try {
        const primaryFile = await fetchReferenceFile(
          selectedFailedJobPrimaryInput.url,
          "source-image",
          selectedFailedJobPrimaryInput.kind,
        );
        addFiles([primaryFile], { allowedKinds: [selectedFailedJobPrimaryInput.kind] });
        restoredPrimaryInput = true;
      } catch {
        // leave the composer open even if the source cannot be refetched
      }
    }

    if (targetPreset) {
      const slotValues = structuredPresetSlotValues(job);
      for (const slot of normalizeStructuredPresetImageSlots(targetPreset)) {
        const rawItems = Array.isArray(slotValues[slot.key]) ? (slotValues[slot.key] as unknown[]) : [];
        const firstItem = rawItems[0];
        if (!isRecord(firstItem)) {
          continue;
        }
        const assetId =
          typeof firstItem.asset_id === "string" || typeof firstItem.asset_id === "number" ? firstItem.asset_id : null;
        if (assetId != null) {
          const asset = findMediaAssetById(assetId, localAssets, favoriteAssets);
          if (asset) {
            assignPresetSlotAsset(slot.key, asset);
            continue;
          }
        }
        const slotUrl =
          typeof firstItem.url === "string"
            ? firstItem.url
            : typeof firstItem.path === "string"
              ? mediaPreviewUrl({ hero_original_path: firstItem.path } as MediaAsset)
              : null;
        if (slotUrl) {
          try {
            const file = await fetchReferenceFile(slotUrl, slot.label, "images");
            assignPresetSlotFile(slot.key, file);
          } catch {
            // skip unavailable slot media
          }
        }
      }
    }

    for (const reference of selectedFailedJobReferenceInputs) {
      if (reference.assetId != null) {
        const asset = findMediaAssetById(reference.assetId, localAssets, favoriteAssets);
        if (asset) {
          await addGalleryAssetAsAttachment(asset, reference.role, [reference.kind]);
          continue;
        }
      }
      try {
        const file = await fetchReferenceFile(reference.url, reference.label, reference.kind);
        addFiles([file], { role: reference.role ?? undefined, allowedKinds: [reference.kind] });
      } catch {
        // skip unavailable references; the user can still adjust before rerunning
      }
    }

    setFormMessage({
      tone: restoredPrimaryInput ? "warning" : "danger",
      text: restoredPrimaryInput
        ? "Loaded the failed job back into Studio. Review it and generate again."
        : "Loaded the failed job prompt and settings, but Studio could not restage the original source image.",
    });
  }

  function clearGallerySelection() {
    resetInspector();
    setSelectedFailedJobId(null);
  }

  function handleGalleryModelFilterChange(nextModelKey: string) {
    clearGallerySelection();
    setGalleryModelFilter(nextModelKey);
  }

  function handleGalleryKindFilterChange(nextKind: GalleryKindFilter) {
    clearGallerySelection();
    activateGalleryKindFilter(nextKind);
  }

  function handleFavoritesFilterToggle() {
    clearGallerySelection();
    toggleFavoritesFilter();
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
          "overflow-x-hidden overflow-y-visible bg-[#121413] px-0 py-0 text-white",
          immersive
            ? "min-h-dvh"
            : "rounded-[34px] border border-[rgba(22,26,24,0.9)] shadow-[0_38px_90px_rgba(19,24,21,0.3)]",
        )}
      >
        <div className={cn("relative overflow-x-hidden overflow-y-visible", immersive ? "min-h-dvh" : "min-h-[920px]")}>
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
            onGalleryModelFilterChange={handleGalleryModelFilterChange}
            onActivateGalleryKindFilter={handleGalleryKindFilterChange}
            onToggleFavoritesFilter={handleFavoritesFilterToggle}
            onOpenPresets={() => setPresetBrowserOpen(true)}
            onOpenSettings={() => void router.push("/settings")}
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
            onSelectAsset={(assetId) => {
              setSelectedFailedJobId(null);
              setSelectedAssetId(assetId);
            }}
            onSelectFailedJob={(jobId) => {
              setSelectedMediaLightboxOpen(false);
              setSelectedAssetId(null);
              setSelectedFailedJobId(jobId);
            }}
            onDragAsset={handleGalleryAssetDragStart}
            onToggleFavorite={(asset) => void toggleAssetFavorite(asset)}
          />

          {!selectedAsset ? (
            <>
              <div ref={composerShellRef}>
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
                  externalTopContent={multiImageReferenceStrip ?? seedanceReferenceStrip}
                  sourceAttachmentStrip={sourceAttachmentStrip}
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
                              const presetSlotPreview =
                                slotPreview
                                  ? ({
                                      key: `preset-slot:${slot.key}`,
                                      label: slot.label,
                                      url: slotPreview,
                                      kind: "images",
                                      posterUrl: null,
                                    } satisfies StudioReferencePreview)
                                  : null;
                              return (
                                <div
                                  key={slot.key}
                                  data-testid={`studio-preset-slot-${slot.key}`}
                                  className="rounded-[20px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-white/88">{slot.label}</div>
                                      <div className="mt-1 text-xs leading-6 text-white/56">{slot.helpText || "Upload or drag an image into this slot."}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex items-center gap-3">
                                    <div className="relative h-[86px] w-[86px] shrink-0">
                                      {presetSlotPreview ? (
                                        <div
                                          onDragOver={(event) => event.preventDefault()}
                                          onDrop={(event) => handlePresetSlotDrop(event, slot.key)}
                                          className="h-full w-full"
                                        >
                                          <StudioStagedMediaTile
                                            preview={presetSlotPreview}
                                            visualUrl={slotPreview}
                                            onOpenPreview={openReferencePreview}
                                            onRemove={() => clearPresetSlot(slot.key)}
                                            replaceControl={
                                              <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/12 bg-[rgba(11,14,13,0.88)] text-white/76 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:text-white">
                                                <ImagePlus className="size-3.5" />
                                                <input
                                                  type="file"
                                                  accept="image/*"
                                                  data-testid={`studio-preset-slot-input-${slot.key}`}
                                                  className="hidden"
                                                  onChange={(event) => {
                                                    assignPresetSlotFile(slot.key, event.target.files?.[0] ?? null);
                                                    resetFileInputValue(event.currentTarget);
                                                  }}
                                                />
                                              </label>
                                            }
                                            className="h-full w-full"
                                            testId={`studio-preset-slot-filled-${slot.key}`}
                                          />
                                        </div>
                                      ) : (
                                        <label
                                          onDragOver={(event) => event.preventDefault()}
                                          onDrop={(event) => handlePresetSlotDrop(event, slot.key)}
                                          className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.05] text-white/74"
                                        >
                                          <ImagePlus className="size-5" />
                                          <input
                                            type="file"
                                            accept="image/*"
                                            data-testid={`studio-preset-slot-input-${slot.key}`}
                                            className="hidden"
                                            onChange={(event) => {
                                              assignPresetSlotFile(slot.key, event.target.files?.[0] ?? null);
                                              resetFileInputValue(event.currentTarget);
                                            }}
                                          />
                                        </label>
                                      )}
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
                    <>
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
                          className={cn(
                            "w-full resize-none rounded-[26px] border border-white/8 bg-white/[0.04] px-4 py-[18px] text-[0.86rem] leading-6 text-white outline-none placeholder:text-white/38 focus:border-[rgba(216,141,67,0.3)]",
                            "min-h-[146px] md:min-h-[136px]",
                          )}
                        />
                          {enhanceEnabledForModel ? (
                            enhanceConfiguredForModel ? (
                            <button
                            type="button"
                            data-testid="studio-open-enhance-dialog"
                            onClick={openEnhanceDialog}
                            aria-label="Open enhance dialog"
                            title="Open enhance dialog"
                            className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:border-[rgba(216,141,67,0.32)] hover:bg-[rgba(216,141,67,0.14)] hover:text-white"
                          >
                            <Sparkles className="size-4" />
                            </button>
                            ) : (
                              <button
                                type="button"
                                data-testid="studio-open-enhance-setup"
                                onClick={openEnhancementSetup}
                                className="absolute bottom-3 right-3 inline-flex h-9 items-center justify-center rounded-full border border-[rgba(216,141,67,0.22)] bg-[rgba(216,141,67,0.12)] px-3 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#ffd7af] transition hover:border-[rgba(216,141,67,0.34)] hover:text-white"
                              >
                                Set up
                              </button>
                            )
                          ) : null}
                      </div>
                    </>
                  )}
                  <div className="relative z-30 flex flex-wrap items-center gap-2 pb-1 text-[0.77rem]">
                    <StudioPillSelect
                      pickerId="model"
                      openPicker={openPicker}
                      setOpenPicker={setOpenPicker}
                      widthClass={pickerWidth("model")}
                      icon={Clapperboard}
                      label={composerModelLabel(currentModel?.label)}
                      selectedValue={modelKey ?? ""}
                      menuTitle="Model"
                      choices={enabledStudioModels.map((model) => ({
                        value: model.key,
                        label: composerModelLabel(model.label),
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
                      selectedValue={selectedPresetId}
                      menuTitle="Preset"
                      choices={[
                        { value: "", label: "Preset" },
                        ...modelPresets.map((preset) => ({
                          value: preset.preset_id,
                          label: preset.label,
                        })),
                      ]}
                      onSelect={(value) => applyPresetSelection(value, { preferredModelKey: modelKey })}
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
                        selectedValue={String(outputCount)}
                        menuTitle="Outputs"
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
                      const currentValue = optionValues[optionKey];
                      const Icon = optionIcon(optionKey, currentValue);
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
                          choiceIcon={(choice) => optionIcon(optionKey, parseOptionChoice(schema, choice.value))}
                          label={resolvedLabel}
                          selectedValue={serializeOptionChoice(resolvedValue ?? "")}
                          menuTitle={optionKey.replaceAll("_", " ")}
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
                      <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={clearComposer}
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#b4d58b,#87a86a)] px-5 text-[0.76rem] font-semibold text-[#132108] shadow-[0_18px_38px_rgba(113,147,86,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_42px_rgba(113,147,86,0.24)]"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        data-testid="studio-generate-button"
                        onClick={() => void submitMedia("submit")}
                        disabled={!canSubmit}
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 text-[0.76rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5 disabled:opacity-60"
                      >
                        {generateButtonLabel}
                      </button>
                      </div>
                    </div>
                  </div>
	              {(selectedPromptList.length || multiShotsEnabled) ? (
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
              </div>
            </>
          ) : null}
        </div>
      </div>

      {enhanceDialogOpen ? (
        <div data-testid="studio-enhance-dialog" className="fixed inset-0 z-[125] bg-[rgba(6,8,7,0.7)] backdrop-blur-md">
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
                    <pre data-testid="studio-enhance-preview-text" className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/88">
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
                        <span className="text-white/48">Enhancement mode:</span> {enhanceModeLabel}
                      </div>
                      <div>
                        <span className="text-white/48">Readiness:</span> {enhanceReadinessLabel}
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
                  {enhanceConfiguredForModel ? (
                    <button type="button" data-testid="studio-enhance-run-button" onClick={() => void requestEnhancementPreview()} disabled={enhanceBusy} className="inline-flex w-full items-center justify-center gap-3 rounded-[22px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 py-4 text-[0.98rem] font-semibold text-[#162300] shadow-[0_18px_34px_rgba(156,204,33,0.22)] disabled:opacity-60">
                      {enhanceBusy ? <LoaderCircle className="size-4.5 animate-spin" /> : <Sparkles className="size-4.5" />}
                      {enhanceBusy ? "Enhancing..." : "Enhance"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="studio-enhance-setup-button"
                      onClick={openEnhancementSetup}
                      className="inline-flex w-full items-center justify-center gap-3 rounded-[22px] border border-[rgba(216,141,67,0.24)] bg-[rgba(216,141,67,0.12)] px-5 py-4 text-[0.9rem] font-semibold text-[#ffd7af] transition hover:border-[rgba(216,141,67,0.36)] hover:text-white"
                    >
                      <Sparkles className="size-4.5" />
                      Set up enhancement
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="studio-enhance-use-prompt-button"
                    onClick={() => {
                      applyEnhancementPrompt();
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

      {presetBrowserOpen ? (
        <StudioPresetBrowser
          presets={availableStudioPresets}
          onClose={() => setPresetBrowserOpen(false)}
          onSelectPreset={(preset) => loadPresetIntoStudio(preset.preset_id ?? preset.key)}
        />
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
                  <div className="flex min-h-[52vh] items-center justify-center p-4 sm:p-6 lg:h-full">
                    {selectedAssetDisplayVisual ? (
                      selectedAsset.generation_kind === "video" ? (
                        <button
                          type="button"
                          data-testid="studio-open-lightbox"
                          onClick={openSelectedMediaLightbox}
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
                      )
                    ) : null}
                  </div>
                  <StudioInspectorActions
                    canDownload={Boolean(mediaDownloadUrl(selectedAsset))}
                    downloadActionLabel={downloadActionLabel}
                    showImageActions={selectedAsset.generation_kind === "image"}
                    onDownload={() => void handleAssetDownload(selectedAsset)}
                    onDismiss={() => void dismissAsset(selectedAsset.asset_id)}
                    onAnimate={() => useAssetAsSource(selectedAsset, true)}
                    onUseImage={() => useAssetAsSource(selectedAsset, false)}
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
                        onClick={() => void copyPromptFromAsset(selectedAssetPrompt)}
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
                        <div className="grid gap-2 sm:grid-cols-2">
                          {selectedAssetPresetFields.map((field) => (
                            <div key={field.key} className="rounded-[16px] border border-white/7 bg-black/16 px-3 py-3">
                              <div className="text-sm text-white/56">{field.label}</div>
                              <div className="mt-1 text-sm font-medium text-white/92">
                                {selectedAssetPresetInputValues[field.key] || field.defaultValue || "Not provided"}
                              </div>
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
                          <div className="grid gap-2 sm:grid-cols-2">
                            {selectedAssetPresetFields.map((field) => (
                              <div key={field.key} className="rounded-[16px] border border-white/7 bg-black/16 px-3 py-3">
                                <div className="text-sm text-white/56">{field.label}</div>
                                <div className="mt-1 text-sm font-medium text-white/92">
                                  {selectedAssetPresetInputValues[field.key] || field.defaultValue || "Not provided"}
                                </div>
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

                <StudioInspectorInfo
                  selectedAsset={selectedAsset}
                  favoriteAssetIdBusy={favoriteAssetIdBusy}
                  onToggleFavorite={toggleAssetFavorite}
                  referencePreviews={selectedAssetReferencePreviews}
                  onOpenReference={setSelectedReferencePreview}
                />

                <StudioInspectorActions
                  canDownload={false}
                  downloadActionLabel={downloadActionLabel}
                  showImageActions={selectedAsset.generation_kind === "image"}
                  onDownload={() => void handleAssetDownload(selectedAsset)}
                  onDismiss={() => void dismissAsset(selectedAsset.asset_id)}
                  onAnimate={() => useAssetAsSource(selectedAsset, true)}
                  onUseImage={() => useAssetAsSource(selectedAsset, false)}
                />
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
                    <StudioInspectorInfo
                      selectedAsset={selectedAsset}
                      favoriteAssetIdBusy={favoriteAssetIdBusy}
                      onToggleFavorite={toggleAssetFavorite}
                      referencePreviews={selectedAssetReferencePreviews}
                      onOpenReference={setSelectedReferencePreview}
                    />
                  </div>
                </CollapsibleSubsection>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedFailedJob ? (
        <div data-testid="studio-failed-job-inspector" className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.86)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
          <div className="min-h-dvh p-0 lg:p-6">
            <div className="grid min-h-dvh content-start gap-4 bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] px-3 pb-6 pt-3 shadow-[0_40px_100px_rgba(0,0,0,0.5)] [touch-action:pan-y] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8 lg:px-6 lg:pb-6 lg:pt-6">
              <div className="grid min-h-0 content-start gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
                <div className="relative overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)]">
                  <button
                    type="button"
                    onClick={() => setSelectedFailedJobId(null)}
                    className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/24 text-white/78 transition hover:text-white"
                    aria-label="Close failed job inspector"
                  >
                    <X className="size-5" />
                  </button>
                  <div className="flex min-h-[48vh] items-center justify-center p-4 sm:p-6 lg:h-full">
                    <div className="grid max-w-[24rem] gap-4 rounded-[28px] border border-[rgba(255,139,139,0.18)] bg-[rgba(40,16,14,0.42)] px-6 py-8 text-center text-white/78">
                      <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(255,139,139,0.24)] bg-[rgba(255,139,139,0.1)] text-[#ff8b8b]">
                        <AlertTriangle className="size-7" />
                      </div>
                      <div>
                        <div className="text-base font-semibold text-white">Failed media job</div>
                        <p className="mt-2 text-sm leading-7 text-white/64">
                          No output image was published for this failed job. The saved prompt and provider error are still available below.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
                    <div className="pointer-events-auto flex items-center gap-2" />
                    <div className="pointer-events-auto flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="studio-failed-job-remove"
                        onClick={() => void dismissJob(selectedFailedJob.job_id)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(201,102,82,0.28)] bg-[rgba(40,16,14,0.76)] text-[#ffb5a6] shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl transition hover:border-[rgba(201,102,82,0.4)] hover:text-white"
                        aria-label="Remove failed media card"
                        title="Remove failed media card"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.04)] p-4 text-white">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Prompt</div>
                  </div>
                  <div className="max-h-[14rem] overflow-y-auto rounded-[18px] border border-white/7 bg-black/16 px-4 py-3 pr-2">
                    <p className="whitespace-pre-wrap text-sm leading-7 text-white/78">
                      {selectedFailedJobPrompt ?? "No prompt text was stored for this failed job."}
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid min-h-0 gap-4 rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:grid lg:overflow-y-auto lg:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/54">
                      Failed job
                    </div>
                    <div className="mt-1 text-sm text-white/76">
                      {selectedFailedJob.model_key ?? "Unknown model"} • {formatDateTime(selectedFailedJob.created_at)}
                    </div>
                  </div>
                  <StatusPill label={jobStatusLabel(selectedFailedJob.status)} tone="danger" />
                </div>
                <button
                  type="button"
                  onClick={() => void retryFailedJobInStudio(selectedFailedJob)}
                  className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-[rgba(208,255,72,0.18)] bg-[rgba(208,255,72,0.12)] px-4 py-3 text-sm font-semibold text-[#dcff88] transition hover:border-[rgba(208,255,72,0.28)] hover:bg-[rgba(208,255,72,0.18)]"
                >
                  <RotateCcw className="size-4" />
                  Retry in Studio
                </button>
                <div className="min-w-0 rounded-[22px] border border-[rgba(255,139,139,0.16)] bg-[rgba(73,20,20,0.24)] p-4">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#ffb8b8]">
                    Provider Error
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-7 text-white/84">
                    {selectedFailedJob.error ?? "The media provider did not return a more specific failure message."}
                  </p>
                </div>
                {selectedFailedJobImageReferences.length ? (
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                      <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
                      References
                    </div>
                    <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                      {selectedFailedJobImageReferences.map((reference) => (
                        <button
                          key={reference.key}
                          type="button"
                          onClick={() => setSelectedReferencePreview(reference)}
                          className="grid w-[5.5rem] shrink-0 gap-2 text-left transition hover:opacity-95"
                        >
                          <span className="overflow-hidden rounded-[16px] border border-white/10 bg-black/18">
                            <img
                              src={reference.url}
                              alt={reference.label}
                              className="h-[5.5rem] w-[5.5rem] object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          </span>
                          <span className="line-clamp-2 text-xs leading-5 text-white/70">{reference.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                    <span className="pt-0.5 text-sm text-white/56">Job ID</span>
                    <span className="min-w-0 text-right text-sm font-medium text-white/92 break-words [overflow-wrap:anywhere]">
                      {selectedFailedJob.job_id}
                    </span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                    <span className="pt-0.5 text-sm text-white/56">Provider Task</span>
                    <span className="min-w-0 text-right text-sm font-medium text-white/92 break-words [overflow-wrap:anywhere]">
                      {selectedFailedJob.provider_task_id ?? "Not assigned"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                    <span className="pt-0.5 text-sm text-white/56">Mode</span>
                    <span className="min-w-0 text-right text-sm font-medium text-white/92 break-words [overflow-wrap:anywhere]">
                      {selectedFailedJob.task_mode ?? "Unknown"}
                    </span>
                  </div>
                </div>
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

      {selectedReferencePreview ? (
        <StudioImageLightbox
          src={selectedReferencePreview.url}
          alt={selectedReferencePreview.label}
          kind={selectedReferencePreview.kind}
          posterSrc={selectedReferencePreview.posterUrl}
          onClose={() => setSelectedReferencePreview(null)}
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
