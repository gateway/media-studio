"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleDollarSign,
  Coins,
  Clapperboard,
  Copy,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Monitor,
  Play,
  Sparkles,
  X,
} from "lucide-react";

import { useGlobalActivity } from "@/components/global-activity";
import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { MediaModelsConsole } from "@/components/media-models-console";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { StudioGallery } from "@/components/studio/studio-gallery";
import { StudioFailedJobInspector } from "@/components/studio/studio-failed-job-inspector";
import { StudioHeaderChrome } from "@/components/studio/studio-header-chrome";
import { StudioInspectorInfo } from "@/components/studio/studio-inspector-info";
import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { StudioMediaSlotAddTile, studioMediaSlotAddTileIcon } from "@/components/studio/studio-media-slot-add-tile";
import { StudioMobileInputsGroup, StudioMobileInputsSection } from "@/components/studio/studio-mobile-inputs-section";
import { StudioComposer } from "@/components/studio/studio-composer";
import { StudioMetricPill } from "@/components/studio/studio-metric-pill";
import { StudioPresetBrowser } from "@/components/studio/studio-preset-browser";
import { StudioReferenceLibrary } from "@/components/studio/studio-reference-library";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
import { PillSelect } from "@/components/ui/pill-select";
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
} from "@/lib/studio-gallery";
import {
  applyPromptReferenceMention,
  batchPhaseMessage,
  buildStudioJobPrimaryInput,
  buildStudioJobReferenceInputs,
  buildStudioRetryRestorePlan,
  buildStudioReferencePreviews,
  buildChoiceList,
  classifyFile,
  displayChoiceLabel,
  detectPromptReferenceMention,
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
  orderedImageInputKey,
  orderedImageInputVisual,
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
  type StudioComposerSlot,
  studioValidationReady,
  StructuredPresetImageSlot,
  StructuredPresetTextField,
  structuredPresetSlotPreviewUrl,
  StudioChoice,
  type StudioReferencePreview,
  studioOptionChoices,
  studioPresetSupportedModels,
  stripUnsupportedStudioOptions,
  toWholeNumber,
  toneForStatus,
  jobStatusLabel,
  jobPhaseMessage,
  type MultiShotParseResult,
} from "@/lib/media-studio-helpers";
import type { MediaAsset, MediaBatch, MediaEnhancePreviewResponse, MediaJob, MediaReference, MediaValidationResponse } from "@/lib/types";
import { estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";
import { installStudioDebugConsole, studioDebug } from "@/lib/studio-debug";
import { readStudioComposerDraft } from "@/lib/studio-composer-draft";
import { cn, formatDateTime, truncate } from "@/lib/utils";

declare global {
  interface Window {
    __mediaStudioTest?: {
      composer?: {
        setModel: (modelKey: string) => void;
      };
      gallery?: {
        seedAssets: (assets: MediaAsset[]) => void;
        openLightbox: (assetId: string | number) => void;
      };
      library?: {
        open: () => void;
      };
      failedJob?: {
        seedAndOpen: (job: MediaJob, batch?: MediaBatch | null) => void;
      };
      enhancement?: {
        openDialog: () => void;
        requestPreview: () => Promise<void>;
        usePrompt: () => boolean;
      };
    };
  }
}

function composerModelLabel(label: string | null | undefined) {
  if (!label) return "Model";
  if (label === "Seedance 2.0 Standard") return "Seedance 2.0";
  return label;
}

type ReferenceLibraryTarget =
  | { type: "attachment"; title: string; role?: "first_frame" | "last_frame" | "reference" | null; allowedKinds?: AttachmentRecord["kind"][] }
  | { type: "standard-slot"; title: string; slotIndex: number; label: string; allowedKinds?: AttachmentRecord["kind"][] }
  | { type: "preset-slot"; title: string; slotKey: string };

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
  const initialComposerDraftRef = useRef(readStudioComposerDraft());
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
  const [referenceLibraryTarget, setReferenceLibraryTarget] = useState<ReferenceLibraryTarget | null>(null);
  const [promptCursorIndex, setPromptCursorIndex] = useState<number | null>(null);
  const [promptHasFocus, setPromptHasFocus] = useState(false);
  const [promptReferenceDismissed, setPromptReferenceDismissed] = useState(false);
  const [promptReferenceActiveIndex, setPromptReferenceActiveIndex] = useState(0);
  const [pendingGalleryStep, setPendingGalleryStep] = useState<"next" | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(
    initialComposerDraftRef.current?.sourceAssetId ?? null,
  );
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
  const selectedFailedJobBatch = useMemo(() => {
    if (!selectedFailedJob?.batch_id) {
      return null;
    }
    return localBatches.find((batch) => batch.batch_id === selectedFailedJob.batch_id) ?? null;
  }, [localBatches, selectedFailedJob?.batch_id]);
  const selectedAssetBatch = useMemo(() => {
    if (!selectedAssetJob?.batch_id) {
      return null;
    }
    return localBatches.find((batch) => batch.batch_id === selectedAssetJob.batch_id) ?? null;
  }, [localBatches, selectedAssetJob?.batch_id]);
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
  const selectedFailedJobRetryPlan = useMemo(
    () =>
      buildStudioRetryRestorePlan({
        job: selectedFailedJob,
        batch: selectedFailedJobBatch,
        models,
        presets,
        localAssets,
        favoriteAssets,
      }),
    [favoriteAssets, localAssets, models, presets, selectedFailedJob, selectedFailedJobBatch],
  );
  const mobileAddTileClassName = "h-[58px] w-[58px] rounded-[18px]";
  const mobileAddTilePlusIconClassName = "size-5";
  const selectedFailedJobImageReferences = useMemo(
    () => (selectedFailedJobRetryPlan?.referenceInputs ?? []).filter((reference) => reference.kind === "images"),
    [selectedFailedJobRetryPlan],
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
  const selectedAssetRevisionPlan = useMemo(
    () =>
      buildStudioRetryRestorePlan({
        job: selectedAssetJob,
        batch: selectedAssetBatch,
        models,
        presets,
        localAssets,
        favoriteAssets,
      }),
    [favoriteAssets, localAssets, models, presets, selectedAssetBatch, selectedAssetJob],
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
    canOpenReferenceLibrary,
    standardComposerLayout,
    explicitVideoImageSlots,
    explicitMotionControlSlots,
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
    stageSourceAsset,
    clearSourceAsset,
    updateOption,
    addFiles,
    addGalleryAssetAsAttachment,
    addReferenceMediaAsAttachment,
    assignPresetSlotFile,
    assignPresetSlotAsset,
    assignPresetSlotReference,
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

  function openReferenceLibrary(target: ReferenceLibraryTarget) {
    setOpenPicker(null);
    setReferenceLibraryTarget(target);
  }

  function openContextualReferenceLibrary() {
    if (!canOpenReferenceLibrary) {
      setFormMessage({ tone: "warning", text: "This model is text-to-video only, so Studio is hiding image inputs." });
      return;
    }
    if (structuredPresetActive && structuredPresetImageSlots.length) {
      const targetSlot =
        structuredPresetImageSlots.find((slot) => {
          const slotState = presetSlotStates[slot.key];
          return !slotState?.assetId && !slotState?.referenceId && !slotState?.file;
        }) ?? structuredPresetImageSlots[0];
      openReferenceLibrary({
        type: "preset-slot",
        title: `Pick a reusable image for ${targetSlot.label}.`,
        slotKey: targetSlot.key,
      });
      return;
    }
    if (seedanceComposer) {
      if (!seedanceFirstFrameAttachment) {
        openReferenceLibrary({
          type: "attachment",
          title: "Pick a reusable image for the Seedance start frame.",
          role: "first_frame",
          allowedKinds: ["images"],
        });
        return;
      }
      if (effectiveSeedanceMode === "first_last_frames" && !seedanceLastFrameAttachment) {
        openReferenceLibrary({
          type: "attachment",
          title: "Pick a reusable image for the Seedance end frame.",
          role: "last_frame",
          allowedKinds: ["images"],
        });
        return;
      }
      openReferenceLibrary({
        type: "attachment",
        title: "Pick a reusable image for Seedance reference guidance.",
        role: "reference",
        allowedKinds: ["images"],
      });
      return;
    }
    const nextStandardImageSlot =
      standardComposerSlots.find((slot) => slot.kind === "image" && !slot.filled) ??
      standardComposerSlots.find((slot) => slot.kind === "image") ??
      null;
    if (standardComposerLayout.usesExplicitSlots && nextStandardImageSlot) {
      openReferenceLibrary({
        type: "standard-slot",
        title:
          nextStandardImageSlot.role === "end_frame"
            ? "Pick a reusable image for the end frame."
            : nextStandardImageSlot.role === "start_frame"
              ? "Pick a reusable image for the start frame."
              : "Pick a reusable image for this input.",
        slotIndex: nextStandardImageSlot.slotIndex,
        label: nextStandardImageSlot.label,
        allowedKinds: ["images"],
      });
      return;
    }
    openReferenceLibrary({
      type: "attachment",
      title: dedicatedImageReferenceRailActive
        ? "Pick a reusable image reference for Nano Banana."
        : "Pick a reusable image from your reference library.",
      role: dedicatedImageReferenceRailActive ? "reference" : undefined,
      allowedKinds: ["images"],
    });
  }

  async function handleReferenceLibrarySelect(reference: MediaReference) {
    try {
      await fetch(`/api/control/reference-media/${reference.reference_id}/use`, {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // Helpful, not required for staging.
    }
    const target = referenceLibraryTarget;
    setReferenceLibraryTarget(null);
    if (!target) {
      return;
    }
    if (target.type === "preset-slot") {
      assignPresetSlotReference(target.slotKey, reference);
      setFormMessage({ tone: "healthy", text: "Reference image loaded into the preset slot." });
      return;
    }
    if (target.type === "standard-slot") {
      const currentSlot = orderedImageInputs[target.slotIndex] ?? null;
      if (target.slotIndex > orderedImageInputs.length) {
        setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
        return;
      }
      if (currentSlot?.source === "asset") {
        clearSourceAsset();
      }
      addReferenceMediaAsAttachment(reference, {
        allowedKinds: target.allowedKinds,
        insertImageIndex: Math.min(target.slotIndex, orderedImageInputs.length),
        replaceImageIndex: target.slotIndex,
      });
      setFormMessage({ tone: "healthy", text: `Reference image loaded into ${target.label}.` });
      return;
    }
    addReferenceMediaAsAttachment(reference, {
      role: target.role ?? undefined,
      allowedKinds: target.allowedKinds,
    });
    setFormMessage({ tone: "healthy", text: "Reference image loaded from the library." });
  }

  function buildAttachmentPreview(
    attachment: AttachmentRecord | null | undefined,
    label: string,
    previewKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ): StudioReferencePreview | null {
    const url = attachment?.previewUrl ?? attachment?.referenceRecord?.stored_url ?? null;
    if (!url) {
      return null;
    }
    return {
      key: `attachment:${attachment?.id ?? previewKey}`,
      label,
      url,
      kind: attachment?.kind ?? "images",
      posterUrl: attachment?.kind === "videos" ? attachment?.referenceRecord?.poster_url ?? null : undefined,
    };
  }

  function orderedImageInputPreview(slot: (typeof orderedImageInputs)[number] | null, label: string, key: string) {
    if (!slot) {
      return null;
    }
    if (slot.source === "asset") {
      return buildAssetReferencePreview(slot.asset, label);
    }
    if (slot.source === "reference") {
      return {
        key: `reference:${slot.reference.reference_id}:${key}`,
        label,
        url: slot.reference.stored_url ?? slot.previewUrl ?? "",
        kind: "images" as const,
        posterUrl: null,
      } satisfies StudioReferencePreview;
    }
    return buildAttachmentPreview(slot.attachment as AttachmentRecord, label, key);
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
  const structuredPresetModelChoices = useMemo(() => {
    if (!structuredPresetActive) {
      return [];
    }
    const supportedModelKeys = new Set(studioPresetSupportedModels(currentPreset));
    return models
      .filter((model) => supportedModelKeys.has(model.key))
      .map((model) => ({
        value: model.key,
        label: composerModelLabel(model.label),
      }));
  }, [currentPreset, models, structuredPresetActive]);
  const showStructuredPresetModelPicker = structuredPresetActive && structuredPresetModelChoices.length > 1;

  function revealComposer(options: { focusPresetField?: boolean } = {}) {
    setMobileComposerCollapsed(!isCoarsePointerDevice());

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const composerRoot = composerShellRef.current;
        if (!composerRoot) {
          return;
        }

        composerRoot.scrollIntoView({ block: "end", behavior: "smooth" });

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
      gallery: {
        seedAssets: (seedAssets) => {
          setLocalAssets(seedAssets);
          setSelectedFailedJobId(null);
          setSelectedAssetId(null);
          setSelectedMediaLightboxOpen(false);
          activateGalleryKindFilter("all");
          setGalleryModelFilter("all");
        },
        openLightbox: (assetId) => {
          setSelectedFailedJobId(null);
          setSelectedAssetId(assetId);
          setSelectedMediaLightboxOpen(true);
        },
      },
      library: {
        open: () => openContextualReferenceLibrary(),
      },
      failedJob: {
        seedAndOpen: (job, batch = null) => {
          if (batch) {
            gallery.actions.setLocalBatches((current) =>
              [batch, ...current.filter((entry) => entry.batch_id !== batch.batch_id)].slice(0, 12),
            );
          }
          setLocalJobs((current) => [job, ...current.filter((entry) => entry.job_id !== job.job_id)].slice(0, 24));
          setSelectedFailedJobId(job.job_id);
        },
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
      delete window.__mediaStudioTest.gallery;
      delete window.__mediaStudioTest.library;
      delete window.__mediaStudioTest.failedJob;
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
    maxAudioInputs === 0;
  const promptReferenceMention =
    dedicatedImageReferenceRailActive && promptHasFocus
      ? detectPromptReferenceMention(prompt, promptCursorIndex ?? promptInputRef.current?.selectionStart ?? prompt.length)
      : null;
  const promptReferenceChoices = useMemo(() => {
    if (!dedicatedImageReferenceRailActive) {
      return [];
    }
    const normalizedQuery = (promptReferenceMention?.query ?? "").replace(/\s+/g, " ").trim();
    return orderedImageInputs
      .map((slot, index) => {
        const label = `Image reference ${index + 1}`;
        const preview = orderedImageInputPreview(slot, label, `prompt-reference-${index + 1}`);
        return {
          id: `image-reference-${index + 1}`,
          label,
          token: `[image reference ${index + 1}]`,
          search: `${label.toLowerCase()} ref ${index + 1} image ${index + 1}`,
          preview,
          visualUrl: orderedImageInputVisual(slot) ?? preview?.posterUrl ?? preview?.url ?? null,
        };
      })
      .filter((choice) => !normalizedQuery || choice.search.includes(normalizedQuery));
  }, [dedicatedImageReferenceRailActive, orderedImageInputs, promptReferenceMention?.query]);
  const promptReferencePickerOpen = Boolean(promptReferenceMention && promptReferenceChoices.length > 0 && !promptReferenceDismissed);

  useEffect(() => {
    setPromptReferenceActiveIndex(0);
    setPromptReferenceDismissed(false);
  }, [promptReferenceMention?.start, promptReferenceMention?.query, promptReferenceChoices.length]);

  function syncPromptCursorIndex(target: HTMLTextAreaElement | null) {
    if (!target) {
      return;
    }
    setPromptCursorIndex(target.selectionStart ?? target.value.length);
  }

  function applyPromptReferenceChoice(choice: (typeof promptReferenceChoices)[number] | null) {
    if (!choice || !promptReferenceMention) {
      return;
    }
    const nextPromptState = applyPromptReferenceMention(prompt, promptReferenceMention, choice.token);
    setPrompt(nextPromptState.prompt);
    setPromptCursorIndex(nextPromptState.caretIndex);
    window.requestAnimationFrame(() => {
      const input = promptInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.setSelectionRange(nextPromptState.caretIndex, nextPromptState.caretIndex);
    });
  }

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
          const slotVisual = orderedImageInputVisual(slot);
          const slotLabel = `Image reference ${slotIndex + 1}`;
          const slotPreview = orderedImageInputPreview(slot, slotLabel, `multi-image-${slotIndex + 1}`);
          return (
            <div key={orderedImageInputKey(slot, slotIndex)} className="flex shrink-0 flex-col gap-2">
              {slotPreview ? (
                <StudioStagedMediaTile
                  preview={slotPreview}
                  visualUrl={slotVisual}
                  onOpenPreview={openReferencePreview}
                  onRemove={() => clearOrderedImageInput(slot)}
                  className="h-[82px] w-[82px]"
                  tileClassName="border-[rgba(216,141,67,0.2)]"
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
              setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(event) => void handleSourceTileDrop(event, orderedImageInputs.length)}
            onPickFiles={(fileList, input) => {
              addImageFilesToOrderedSlot(fileList, orderedImageInputs.length, input);
            }}
          />
        ) : null}
      </div>
    </div>
  ) : null;
  const genericSourceInputsAvailable =
    !structuredPresetActive &&
    !dedicatedImageReferenceRailActive &&
    !seedanceComposer &&
    !explicitVideoImageSlots &&
    !explicitMotionControlSlots &&
    (maxImageInputs > 0 || maxVideoInputs > 0 || maxAudioInputs > 0);
  const genericSourceAddTileVisible = canAddMoreImages || canAddMoreVideos || canAddMoreAudios;
  const motionControlVideoAsset = currentSourceAsset?.generation_kind === "video" ? currentSourceAsset : null;
  const motionControlVideoAttachment =
    motionControlVideoAsset ? null : attachments.find((attachment) => attachment.kind === "videos") ?? null;
  const motionControlVideoPreview = motionControlVideoAsset
    ? buildAssetReferencePreview(motionControlVideoAsset, "Driving video")
    : buildAttachmentPreview(motionControlVideoAttachment, "Driving video", "motion-control-video");
  const motionControlVideoVisual = motionControlVideoAsset
    ? mediaThumbnailUrl(motionControlVideoAsset) ?? mediaDisplayUrl(motionControlVideoAsset)
    : motionControlVideoAttachment?.previewUrl ??
      motionControlVideoAttachment?.referenceRecord?.thumb_url ??
      motionControlVideoAttachment?.referenceRecord?.stored_url ??
      null;
  const standardComposerSlots = standardComposerLayout.slots.filter((slot) => slot.visible);
  const standardComposerSectionTitle = standardComposerSlots.some((slot) => slot.role === "driving_video")
    ? "Motion inputs"
    : standardComposerSlots.some((slot) => slot.role === "start_frame" || slot.role === "end_frame")
      ? "Frames"
      : standardComposerSlots.length > 0
        ? "Input"
        : "Inputs";

  function standardComposerSlotPreview(slot: StudioComposerSlot, previewKey: string) {
    if (slot.kind === "image") {
      return orderedImageInputPreview(orderedImageInputs[slot.slotIndex] ?? null, slot.label, previewKey);
    }
    if (slot.role === "driving_video") {
      return motionControlVideoAsset
        ? buildAssetReferencePreview(motionControlVideoAsset, slot.label)
        : buildAttachmentPreview(motionControlVideoAttachment, slot.label, previewKey);
    }
    return null;
  }

  function standardComposerSlotVisual(slot: StudioComposerSlot) {
    if (slot.kind === "image") {
      return orderedImageInputVisual(orderedImageInputs[slot.slotIndex] ?? null);
    }
    if (slot.role === "driving_video") {
      return motionControlVideoVisual;
    }
    return null;
  }

  function clearStandardComposerSlot(slot: StudioComposerSlot) {
    if (slot.kind === "image") {
      clearOrderedImageInput(orderedImageInputs[slot.slotIndex] ?? null);
      return;
    }
    if (slot.role === "driving_video") {
      if (motionControlVideoAsset) {
        clearSourceAsset();
        return;
      }
      if (motionControlVideoAttachment) {
        removeAttachment(motionControlVideoAttachment.id);
      }
    }
  }

  function addFilesToStandardComposerSlot(
    slot: StudioComposerSlot,
    fileList: FileList | File[] | null,
    input?: HTMLInputElement | null,
    replaceFilled = false,
  ) {
    if (slot.kind === "image") {
      const currentSlot = orderedImageInputs[slot.slotIndex] ?? null;
      if (replaceFilled && currentSlot?.source === "asset") {
        clearSourceAsset();
      }
      addImageFilesToOrderedSlot(fileList, slot.slotIndex, input, replaceFilled);
      return;
    }
    if (slot.role === "driving_video") {
      if (replaceFilled) {
        if (motionControlVideoAsset) {
          clearSourceAsset();
        } else if (motionControlVideoAttachment) {
          removeAttachment(motionControlVideoAttachment.id);
        }
      }
      addFiles(fileList, { allowedKinds: ["videos"] });
      resetFileInputValue(input ?? null);
    }
  }

  function standardComposerSlotReplaceControl(slot: StudioComposerSlot, testId: string) {
    return (
      <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/12 bg-[rgba(11,14,13,0.88)] text-white/76 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:text-white">
        <ImagePlus className="size-3.5" />
        <input
          type="file"
          accept={slot.accept}
          data-testid={testId}
          className="hidden"
          onChange={(event) => {
            addFilesToStandardComposerSlot(slot, event.target.files, event.currentTarget, true);
          }}
        />
      </label>
    );
  }

  function renderStandardComposerSlotLabel(slot: StudioComposerSlot) {
    if (slot.role === "end_frame") {
      return (
        <div className="max-w-[96px] whitespace-nowrap text-[0.62rem] font-semibold uppercase leading-none tracking-[0.14em] text-white/46">
          End frame
        </div>
      );
    }
    return (
      <div className="max-w-[96px] whitespace-nowrap text-[0.62rem] font-semibold uppercase leading-none tracking-[0.14em] text-white/46">
        {slot.label}
      </div>
    );
  }

  function renderStandardComposerSlot(
    slot: StudioComposerSlot,
    options: { mobile?: boolean; testIdPrefix: string },
  ) {
    const mobile = options.mobile ?? false;
    const preview = standardComposerSlotPreview(slot, `${options.testIdPrefix}-${slot.id}`);
    const visualUrl = standardComposerSlotVisual(slot);
    const previewClassName = mobile ? "h-[72px] w-[72px]" : "h-full w-full";
    return (
      <div key={slot.id} className={mobile ? "shrink-0" : "flex w-[96px] flex-col gap-2"}>
        {!preview ? (
          renderStandardComposerSlotLabel(slot)
        ) : null}
        <div className={mobile ? "h-[72px] w-[72px]" : "relative h-[82px] w-[82px]"}>
          {preview ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) => void handleSourceTileDrop(event, slot.slotIndex, slot)}
              className={previewClassName}
            >
              <StudioStagedMediaTile
                preview={preview}
                visualUrl={visualUrl}
                onOpenPreview={openReferencePreview}
                onRemove={() => clearStandardComposerSlot(slot)}
                replaceControl={
                  mobile ? undefined : standardComposerSlotReplaceControl(slot, `${options.testIdPrefix}-${slot.id}-replace`)
                }
                className={previewClassName}
                tileClassName={slot.kind === "image" && orderedImageInputs[slot.slotIndex]?.source === "asset" ? "border-[rgba(216,141,67,0.24)]" : undefined}
                testId={`${options.testIdPrefix}-${slot.id}-filled`}
              />
            </div>
          ) : (
            <StudioMediaSlotAddTile
              accept={slot.accept}
              isDragActive={isDragActive}
              testId={`${options.testIdPrefix}-${slot.id}`}
              required={slot.required}
              wrapperClassName={mobile ? "shrink-0" : "h-full w-full"}
              tileClassName={mobile ? mobileAddTileClassName : "h-full w-full"}
              plusIconClassName={mobile ? mobileAddTilePlusIconClassName : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) => void handleSourceTileDrop(event, slot.slotIndex, slot)}
              onPickFiles={(fileList, input) => {
                addFilesToStandardComposerSlot(slot, fileList, input);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  const sourceAttachmentStrip = !structuredPresetActive &&
    !dedicatedImageReferenceRailActive &&
    (seedanceComposer || standardComposerLayout.usesExplicitSlots || genericSourceInputsAvailable) ? (
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
              {!attachment ? (
                <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">{slot.label}</div>
              ) : null}
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
                  <StudioMediaSlotAddTile
                    accept="image/*"
                    isDragActive={isDragActive}
                    testId={`seedance-slot-input-${slot.role}`}
                    required={slot.role === "first_frame"}
                    wrapperClassName="h-full w-full"
                    tileClassName="h-full w-full"
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragActive(true);
                    }}
                    onDragLeave={() => setIsDragActive(false)}
                    onDrop={(event) => void handleSourceTileDrop(event, slotIndex)}
                    onPickFiles={(fileList, input) => {
                      if (slot.role === "last_frame" && !seedanceFirstFrameAttachment) {
                        setFormMessage({ tone: "warning", text: "Add a start frame before the end frame." });
                        resetFileInputValue(input);
                        return;
                      }
                      addFiles(fileList, {
                        role: slot.role as "first_frame" | "last_frame",
                        allowedKinds: ["images"],
                      });
                      resetFileInputValue(input);
                    }}
                  />
                )}
              </div>
            </div>
          )})}
        </>
      ) : standardComposerLayout.usesExplicitSlots ? (
        <>{standardComposerSlots.map((slot) => renderStandardComposerSlot(slot, { testIdPrefix: "studio-standard-slot" }))}</>
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
              onRemove={() => clearSourceAsset()}
              className="h-[82px] w-[82px]"
              tileClassName="border-[rgba(216,141,67,0.24)]"
              testId="studio-source-asset-tile"
            />
          ) : null}

          {attachments.slice(0, 4).map((attachment) => (
            <StudioStagedMediaTile
              key={attachment.id}
              preview={
                buildAttachmentPreview(attachment, attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference", attachment.id) ?? {
                  key: `attachment:${attachment.id}`,
                  label: attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference",
                  url: attachment.previewUrl ?? attachment.referenceRecord?.stored_url ?? "",
                  kind: attachment.kind,
                  posterUrl: attachment.referenceRecord?.poster_url ?? null,
                }
              }
              visualUrl={attachment.kind === "audios" ? null : attachment.previewUrl ?? attachment.referenceRecord?.thumb_url ?? attachment.referenceRecord?.stored_url ?? null}
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

          {genericSourceAddTileVisible ? (
            <StudioMediaSlotAddTile
              accept="image/*,video/*,audio/*"
              multiple
              disabled={!genericSourceAddTileVisible}
              isDragActive={isDragActive}
              testId="studio-source-input"
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) => void handleSourceTileDrop(event)}
              onPickFiles={(fileList, input) => {
                addFiles(fileList);
                resetFileInputValue(input);
              }}
            />
          ) : null}
        </>
      )}
      {(imageLimitLabel || maxVideoInputs > 0 || maxAudioInputs > 0) &&
      !explicitVideoImageSlots &&
      !explicitMotionControlSlots &&
      !seedanceComposer ? (
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
        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.85fr)_minmax(260px,0.85fr)]">
          {[
            {
              key: "images",
              label: "Image refs",
              tokenHint: "image@",
              attachments: seedanceReferenceImages,
              accept: "image/*",
              maxLabel: "9",
              tileClassName: "h-[82px] w-[82px]",
              addTileClassName: "h-[82px] w-[82px] rounded-[22px]",
              plusIconClassName: "size-4.5",
              maxVisibleTiles: 4,
            },
            {
              key: "videos",
              label: "Video refs",
              tokenHint: "video@",
              attachments: seedanceReferenceVideos,
              accept: "video/*",
              maxLabel: "3",
              tileClassName: "h-[82px] w-[82px]",
              addTileClassName: "h-[82px] w-[82px] rounded-[22px]",
              plusIconClassName: "size-4.5",
              maxVisibleTiles: 3,
            },
            {
              key: "audios",
              label: "Audio refs",
              tokenHint: "audio@",
              attachments: seedanceReferenceAudios,
              accept: "audio/*",
              maxLabel: "3",
              tileClassName: "h-[82px] w-[82px]",
              addTileClassName: "h-[82px] w-[82px] rounded-[22px]",
              plusIconClassName: "size-4.5",
              maxVisibleTiles: 3,
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
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-white/52">
                    {group.label} <span className="text-white/32">- {group.tokenHint}</span>
                  </div>
                </div>
                <div className="shrink-0 rounded-full border border-white/8 bg-black/18 px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.12em] text-white/42">
                  {group.attachments.length}
                  {` / ${group.maxLabel}`}
                </div>
              </div>
              <div className="scrollbar-none flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pb-0.5">
                {group.attachments.slice(0, group.maxVisibleTiles).map((attachment) => (
                  <StudioStagedMediaTile
                    key={attachment.id}
                    preview={
                      buildAttachmentPreview(attachment, attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference", `${group.key}-${attachment.id}`) ?? {
                        key: `attachment:${attachment.id}`,
                        label: attachment.file?.name ?? attachment.referenceRecord?.original_filename ?? "Reference",
                        url: attachment.previewUrl ?? attachment.referenceRecord?.stored_url ?? "",
                        kind: attachment.kind,
                        posterUrl: attachment.referenceRecord?.poster_url ?? null,
                      }
                    }
                    visualUrl={attachment.kind === "audios" ? null : attachment.previewUrl ?? attachment.referenceRecord?.thumb_url ?? attachment.referenceRecord?.stored_url ?? null}
                    onOpenPreview={openReferencePreview}
                    onRemove={() => removeAttachment(attachment.id)}
                    className={cn("shrink-0", group.tileClassName)}
                    testId={`seedance-group-tile-${group.key}-${attachment.id}`}
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
                ) : null}
                {group.attachments.length > group.maxVisibleTiles ? (
                  <div className={cn("flex shrink-0 items-center justify-center border border-white/8 bg-white/[0.04] text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-white/58", group.addTileClassName)}>
                    +{group.attachments.length - group.maxVisibleTiles}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;
  const mobileInputsSection = !structuredPresetActive ? (
    dedicatedImageReferenceRailActive ? (
      <StudioMobileInputsSection title="Image references" summary={imageLimitLabel}>
        <div className="flex min-w-0 items-start gap-2 overflow-x-auto overflow-y-hidden pb-1">
          {orderedImageInputs.map((slot, slotIndex) => {
            const slotVisual = orderedImageInputVisual(slot);
            const slotLabel = `Image reference ${slotIndex + 1}`;
            const slotPreview = orderedImageInputPreview(slot, slotLabel, `mobile-multi-image-${slotIndex + 1}`);
            return slotPreview ? (
              <StudioStagedMediaTile
                key={orderedImageInputKey(slot, slotIndex)}
                preview={slotPreview}
                visualUrl={slotVisual}
                onOpenPreview={openReferencePreview}
                onRemove={() => clearOrderedImageInput(slot)}
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
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) => void handleSourceTileDrop(event, orderedImageInputs.length)}
              onPickFiles={(fileList, input) => {
                addImageFilesToOrderedSlot(fileList, orderedImageInputs.length, input);
              }}
            />
          ) : null}
        </div>
      </StudioMobileInputsSection>
    ) : seedanceComposer ? (
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
                { label: "Start frame", role: "first_frame", attachment: seedanceFirstFrameAttachment },
                ...(effectiveSeedanceMode === "first_last_frames"
                  ? [{ label: "End frame", role: "last_frame", attachment: seedanceLastFrameAttachment }]
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
                          setIsDragActive(true);
                        }}
                        onDragLeave={() => setIsDragActive(false)}
                        onDrop={(event) => void handleSourceTileDrop(event, slotIndex)}
                        className="h-[72px] w-[72px]"
                      >
                        <StudioStagedMediaTile
                          preview={attachmentPreview}
                          visualUrl={slot.attachment.previewUrl}
                          onOpenPreview={openReferencePreview}
                          onRemove={() => removeAttachment(slot.attachment?.id ?? "")}
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
                          setIsDragActive(true);
                        }}
                        onDragLeave={() => setIsDragActive(false)}
                        onDrop={(event) => void handleSourceTileDrop(event, slotIndex)}
                        onPickFiles={(fileList, input) => {
                          if (slot.role === "last_frame" && !seedanceFirstFrameAttachment) {
                            setFormMessage({ tone: "warning", text: "Add a start frame before the end frame." });
                            resetFileInputValue(input);
                            return;
                          }
                          addFiles(fileList, {
                            role: slot.role as "first_frame" | "last_frame",
                            allowedKinds: ["images"],
                          });
                          resetFileInputValue(input);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </StudioMobileInputsGroup>

          {[
            {
              key: "images",
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
              key: "videos",
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
              key: "audios",
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
          ].map((group) => (
            <StudioMobileInputsGroup
              key={`mobile-${group.key}`}
              label={`${group.label} - ${group.tokenHint}`}
              summary={`${group.attachments.length} / ${group.maxLabel}`}
            >
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={(event) =>
                  void handleSeedanceReferenceDrop(event, group.key as "images" | "videos" | "audios")
                }
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
                      onOpenPreview={openReferencePreview}
                      onRemove={() => removeAttachment(attachment.id)}
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
                          addFiles(event.target.files, {
                            role: "reference",
                            allowedKinds: [group.key as "images" | "videos" | "audios"],
                          });
                          resetFileInputValue(event.currentTarget);
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
    ) : standardComposerLayout.usesExplicitSlots ? (
      <StudioMobileInputsSection
        title={standardComposerSectionTitle}
        summary={standardComposerLayout.summaryLabel}
      >
        <div className="flex min-w-0 items-start gap-2 overflow-x-auto overflow-y-hidden pb-1">
          {standardComposerSlots.map((slot) => renderStandardComposerSlot(slot, { mobile: true, testIdPrefix: "studio-mobile-standard-slot" }))}
        </div>
      </StudioMobileInputsSection>
    ) : sourceAttachmentStrip ? (
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
              onOpenPreview={openReferencePreview}
              onRemove={() => clearSourceAsset()}
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
              onOpenPreview={openReferencePreview}
              onRemove={() => removeAttachment(attachment.id)}
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
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) => void handleSourceTileDrop(event)}
              onPickFiles={(fileList, input) => {
                addFiles(fileList);
                resetFileInputValue(input);
              }}
            />
          ) : null}
        </div>
      </StudioMobileInputsSection>
    ) : null
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
    Boolean(selectedReferencePreview) ||
    Boolean(referenceLibraryTarget);

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

  const navigateSelectedGalleryAsset = useCallback(
    (direction: 1 | -1) => {
      if (!selectedAsset || visibleGalleryAssetIds.length < 2) {
        return false;
      }
      const currentIndex = visibleGalleryAssetIds.findIndex((assetId) => String(assetId) === String(selectedAsset.asset_id));
      if (currentIndex === -1) {
        return false;
      }
      if (direction === 1 && currentIndex === visibleGalleryAssetIds.length - 1 && activeGalleryHasMore) {
        if (!activeGalleryLoadingMore && pendingGalleryStep == null) {
          setPendingGalleryStep("next");
          void loadMoreActiveGalleryAssets();
        }
        return true;
      }
      const nextIndex = (currentIndex + direction + visibleGalleryAssetIds.length) % visibleGalleryAssetIds.length;
      const nextAssetId = visibleGalleryAssetIds[nextIndex];
      if (nextAssetId == null || String(nextAssetId) === String(selectedAsset.asset_id)) {
        return false;
      }
      setSelectedFailedJobId(null);
      setSelectedAssetId(nextAssetId);
      return true;
    },
    [
      activeGalleryHasMore,
      activeGalleryLoadingMore,
      loadMoreActiveGalleryAssets,
      pendingGalleryStep,
      selectedAsset,
      setSelectedAssetId,
      visibleGalleryAssetIds,
    ],
  );

  function handleSourceTileDrop(
    event: React.DragEvent<HTMLElement>,
    slotIndex = 0,
    standardSlot?: StudioComposerSlot | null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    const galleryAssetId = event.dataTransfer.getData("application/x-bumblebee-media-asset-id");
    if (standardSlot) {
      if (galleryAssetId) {
        const asset = findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
        if (!asset) {
          setFormMessage({ tone: "danger", text: "The dragged gallery asset could not be found." });
          return;
        }
        if (standardSlot.kind === "image") {
          if (asset.generation_kind !== "image") {
            setFormMessage({ tone: "danger", text: `${standardSlot.label} only accepts image assets.` });
            return;
          }
          if (slotIndex > orderedImageInputs.length) {
            setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
            return;
          }
          if (slotIndex === 0) {
            const currentSlot = orderedImageInputs[0] ?? null;
            if (currentSlot && currentSlot.source !== "asset") {
              clearOrderedImageInput(currentSlot);
            }
            useAssetAsSource(asset, false);
            return;
          }
          void addGalleryAssetAsAttachment(asset, null, ["images"], {
            insertImageIndex: Math.min(slotIndex, orderedImageInputs.length),
            replaceImageIndex: slotIndex,
          });
          return;
        }
        if (asset.generation_kind !== "video") {
          setFormMessage({ tone: "danger", text: `${standardSlot.label} only accepts video assets.` });
          return;
        }
        if (motionControlVideoAsset) {
          clearSourceAsset();
        } else if (motionControlVideoAttachment) {
          removeAttachment(motionControlVideoAttachment.id);
        }
        void addGalleryAssetAsAttachment(asset, null, ["videos"]);
        return;
      }
      if (standardSlot.kind === "image") {
        if (slotIndex > orderedImageInputs.length) {
          setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
          return;
        }
        const currentSlot = orderedImageInputs[slotIndex] ?? null;
        if (currentSlot?.source === "asset") {
          clearSourceAsset();
        }
        addFiles(event.dataTransfer.files, {
          allowedKinds: ["images"],
          insertImageIndex: Math.min(slotIndex, orderedImageInputs.length),
          replaceImageIndex: slotIndex,
        });
        return;
      }
      if (motionControlVideoAsset) {
        clearSourceAsset();
      } else if (motionControlVideoAttachment) {
        removeAttachment(motionControlVideoAttachment.id);
      }
      addFiles(event.dataTransfer.files, { allowedKinds: ["videos"] });
      return;
    }
    if (galleryAssetId) {
      const asset = findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      if (!asset) {
        setFormMessage({ tone: "danger", text: "The dragged gallery asset could not be found." });
        return;
      }
      if (explicitMotionControlSlots) {
        if (slotIndex === 0) {
          if (asset.generation_kind !== "image") {
            setFormMessage({ tone: "danger", text: "The motion image slot only accepts image assets." });
            return;
          }
          useAssetAsSource(asset, false);
          return;
        }
        if (asset.generation_kind !== "video") {
          setFormMessage({ tone: "danger", text: "The motion video slot only accepts video assets." });
          return;
        }
        if (motionControlVideoAsset) {
          clearSourceAsset();
        } else if (motionControlVideoAttachment) {
          removeAttachment(motionControlVideoAttachment.id);
        }
        void addGalleryAssetAsAttachment(asset, null, ["videos"]);
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
    if (explicitMotionControlSlots) {
      if (slotIndex === 0) {
        addFiles(event.dataTransfer.files, { allowedKinds: ["images"], insertImageIndex: 0 });
        return;
      }
      if (motionControlVideoAsset) {
        clearSourceAsset();
      } else if (motionControlVideoAttachment) {
        removeAttachment(motionControlVideoAttachment.id);
      }
      addFiles(event.dataTransfer.files, { allowedKinds: ["videos"] });
      return;
    }
    if ((dedicatedImageReferenceRailActive || explicitVideoImageSlots) && slotIndex > orderedImageInputs.length) {
      setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
      return;
    }
    if (explicitVideoImageSlots) {
      const slot = orderedImageInputs[slotIndex] ?? null;
      if (slot) {
        clearOrderedImageInput(slot);
      }
      addFiles(event.dataTransfer.files, {
        allowedKinds: ["images"],
        insertImageIndex: Math.min(slotIndex, orderedImageInputs.length),
      });
      return;
    }
    addFiles(
      event.dataTransfer.files,
      dedicatedImageReferenceRailActive
        ? { allowedKinds: ["images"], insertImageIndex: slotIndex }
        : undefined,
    );
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
    if (!seedanceComposer && !structuredPresetActive && !canUseSourceAsset && !explicitVideoImageSlots && !dedicatedImageReferenceRailActive) {
      setFormMessage({ tone: "warning", text: "The selected model is text-to-video only, so Studio is hiding source image inputs." });
      return;
    }
    if (explicitMotionControlSlots) {
      if (asset.generation_kind === "video") {
        if (motionControlVideoAsset) {
          clearSourceAsset();
        } else if (motionControlVideoAttachment) {
          removeAttachment(motionControlVideoAttachment.id);
        }
        void addGalleryAssetAsAttachment(asset, null, ["videos"]);
        setSelectedMediaLightboxOpen(false);
        setSelectedAssetId(null);
        setFormMessage({ tone: "warning", text: "The selected asset is now staged as the driving video." });
        return;
      }
      stageSourceAsset(asset);
      setSelectedMediaLightboxOpen(false);
      setMobileComposerCollapsed(!isCoarsePointerDevice());
      setSelectedAssetId(null);
      setFormMessage({ tone: "warning", text: "The selected asset is now staged as the source image." });
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
    stageSourceAsset(asset);
    if (animate && asset.generation_kind !== "video") {
      const currentModelSupportsAnimate = Boolean(
        currentModel?.generation_kind === "video" &&
          (currentModel?.task_modes?.includes("image_to_video") || maxImageInputs > 0),
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

  function addImageFilesToOrderedSlot(
    fileList: FileList | File[] | null,
    slotIndex: number,
    input?: HTMLInputElement | null,
    replaceFilled = false,
  ) {
    if (slotIndex > orderedImageInputs.length) {
      setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
      resetFileInputValue(input ?? null);
      return;
    }
    addFiles(fileList, {
      allowedKinds: ["images"],
      insertImageIndex: slotIndex,
      replaceImageIndex: replaceFilled ? slotIndex : null,
    });
    resetFileInputValue(input ?? null);
  }

  function clearOrderedImageInput(slot: (typeof orderedImageInputs)[number] | null) {
    if (!slot) {
      return;
    }
    if (slot.source === "asset") {
      clearSourceAsset();
      return;
    }
    if (slot.source === "reference") {
      const match = attachments.find((attachment) => attachment.id === slot.attachmentId);
      if (match) {
        removeAttachment(match.id);
      }
      return;
    }
    removeAttachment(slot.attachment.id);
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

  async function restoreComposerFromPlan({
    plan,
    fallbackPrimaryInput,
    fallbackReferenceInputs,
    sourceAssetId,
    missingModelMessage,
    successMessage,
    partialFailureMessage,
    closeAssetInspector = false,
    closeFailedJobInspector = false,
  }: {
    plan: ReturnType<typeof buildStudioRetryRestorePlan> | null;
    fallbackPrimaryInput?: ReturnType<typeof buildStudioJobPrimaryInput> | null;
    fallbackReferenceInputs?: ReturnType<typeof buildStudioJobReferenceInputs>;
    sourceAssetId?: string | number | null;
    missingModelMessage: string;
    successMessage: string;
    partialFailureMessage: string;
    closeAssetInspector?: boolean;
    closeFailedJobInspector?: boolean;
  }) {
    const targetModel = plan?.targetModel ?? null;
    if (!targetModel) {
      setFormMessage({ tone: "danger", text: missingModelMessage });
      return;
    }
    const targetPreset = plan?.targetPreset ?? null;

    clearComposer();
    setModelKey(targetModel.key);
    if (targetPreset) {
      applyPresetSelection(targetPreset.preset_id ?? targetPreset.key, { preferredModelKey: targetModel.key });
    } else {
      setSelectedPresetId("");
    }
    setSelectedPromptIds(plan?.selectedPromptIds ?? []);
    setPrompt(plan?.prompt ?? "");
    setOptionValues(plan?.optionValues ?? {});
    setOutputCount(plan?.outputCount ?? 1);
    setValidation(null);
    setBusyState("idle");
    setOpenPicker(null);
    setEnhanceDialogOpen(false);
    setEnhancePreview(null);
    setEnhanceError(null);
    setIsDragActive(false);
    clearSourceAsset();

    if (closeFailedJobInspector) {
      setSelectedFailedJobId(null);
    }
    if (closeAssetInspector) {
      setSelectedAssetId(null);
      setSelectedMediaLightboxOpen(false);
      setSelectedReferencePreview(null);
    }
    setMobileComposerCollapsed(false);

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    setPresetInputValues(plan?.presetInputValues ?? {});

    let restoredPrimaryInput = false;
    if (sourceAssetId != null) {
      const localSourceAsset = findMediaAssetById(sourceAssetId, localAssets, favoriteAssets);
      if (localSourceAsset) {
        stageSourceAsset(localSourceAsset);
        restoredPrimaryInput = true;
      } else {
        try {
          const loadedSourceAsset = await fetchAssetById(sourceAssetId);
          setLocalAssets((current) => [loadedSourceAsset, ...current.filter((asset) => asset.asset_id !== loadedSourceAsset.asset_id)]);
          stageSourceAsset(loadedSourceAsset);
          restoredPrimaryInput = true;
        } catch {
          // fall through to local file-based source restore below
        }
      }
    }

    const primaryInput = plan?.primaryInput ?? fallbackPrimaryInput ?? null;
    if (!restoredPrimaryInput && primaryInput) {
      if (primaryInput.assetId != null) {
        const localPrimaryAsset = findMediaAssetById(primaryInput.assetId, localAssets, favoriteAssets);
        if (localPrimaryAsset) {
          if (primaryInput.role) {
            await addGalleryAssetAsAttachment(localPrimaryAsset, primaryInput.role, [primaryInput.kind]);
          } else {
            stageSourceAsset(localPrimaryAsset);
          }
          restoredPrimaryInput = true;
        }
      }
      if (!restoredPrimaryInput && primaryInput.url) {
        try {
          const primaryFile = await fetchReferenceFile(primaryInput.url, "source-image", primaryInput.kind);
          addFiles([primaryFile], {
            role: primaryInput.role ?? undefined,
            allowedKinds: [primaryInput.kind],
          });
          restoredPrimaryInput = true;
        } catch {
          // leave the composer open even if the source cannot be refetched
        }
      }
    }

    if (targetPreset) {
      for (const slotRestore of plan?.presetSlotRestores ?? []) {
        if (slotRestore.assetId != null) {
          const asset = findMediaAssetById(slotRestore.assetId, localAssets, favoriteAssets);
          if (asset) {
            assignPresetSlotAsset(slotRestore.slotKey, asset);
            continue;
          }
        }
        if (slotRestore.url) {
          try {
            const file = await fetchReferenceFile(slotRestore.url, slotRestore.label, "images");
            assignPresetSlotFile(slotRestore.slotKey, file);
          } catch {
            // skip unavailable slot media
          }
        }
      }
    }

    for (const reference of plan?.referenceInputs ?? fallbackReferenceInputs ?? []) {
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
      text: restoredPrimaryInput ? successMessage : partialFailureMessage,
    });
    revealComposer({ focusPresetField: Boolean(targetPreset) });
  }

  async function retryFailedJobInStudio(job: MediaJob | null) {
    if (!job) {
      return;
    }
    await restoreComposerFromPlan({
      plan: selectedFailedJobRetryPlan,
      fallbackPrimaryInput: selectedFailedJobPrimaryInput,
      fallbackReferenceInputs: selectedFailedJobReferenceInputs,
      sourceAssetId: job.source_asset_id ?? null,
      missingModelMessage: "Studio could not find the model used by this failed job.",
      successMessage: "Loaded the failed job back into Studio. Review it and generate again.",
      partialFailureMessage: "Loaded the failed job prompt and settings, but Studio could not restage the original source image.",
      closeAssetInspector: true,
      closeFailedJobInspector: true,
    });
  }

  async function reviseSelectedAssetInStudio(asset: MediaAsset | null) {
    if (!asset) {
      return;
    }
    await restoreComposerFromPlan({
      plan: selectedAssetRevisionPlan,
      sourceAssetId: selectedAssetJob?.source_asset_id ?? asset.source_asset_id ?? null,
      missingModelMessage: "Studio could not reconstruct this asset into an editable composer state.",
      successMessage: "Loaded this asset back into Studio with its original prompt, references, and settings.",
      partialFailureMessage: "Loaded this asset prompt and settings, but Studio could not restage some of the original reference media.",
      closeAssetInspector: true,
      closeFailedJobInspector: false,
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
            onOpenLibrary={openContextualReferenceLibrary}
            showLibraryButton={canOpenReferenceLibrary}
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
                  externalTopContent={
                    multiImageReferenceStrip || seedanceReferenceStrip ? (
                      <div className="hidden lg:block">{multiImageReferenceStrip ?? seedanceReferenceStrip}</div>
                    ) : null
                  }
                  mobileInputsContent={mobileInputsSection}
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
                                : slotState?.referenceId
                                  ? slotState.referenceRecord?.thumb_url ?? slotState.referenceRecord?.stored_url ?? slotState.previewUrl
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
                          onChange={(event) => {
                            setPrompt(event.target.value);
                            setPromptReferenceDismissed(false);
                            syncPromptCursorIndex(event.currentTarget);
                          }}
                          onFocus={(event) => {
                            setPromptHasFocus(true);
                            setPromptReferenceDismissed(false);
                            syncPromptCursorIndex(event.currentTarget);
                          }}
                          onBlur={() => {
                            setPromptHasFocus(false);
                          }}
                          onClick={(event) => syncPromptCursorIndex(event.currentTarget)}
                          onKeyUp={(event) => syncPromptCursorIndex(event.currentTarget)}
                          onSelect={(event) => syncPromptCursorIndex(event.currentTarget)}
                          onKeyDown={(event) => {
                            if (!promptReferencePickerOpen || !promptReferenceChoices.length) {
                              return;
                            }
                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              setPromptReferenceActiveIndex((current) => (current + 1) % promptReferenceChoices.length);
                              return;
                            }
                            if (event.key === "ArrowUp") {
                              event.preventDefault();
                              setPromptReferenceActiveIndex((current) =>
                                current === 0 ? promptReferenceChoices.length - 1 : current - 1,
                              );
                              return;
                            }
                            if (event.key === "Enter" || event.key === "Tab") {
                              event.preventDefault();
                              applyPromptReferenceChoice(promptReferenceChoices[promptReferenceActiveIndex] ?? null);
                              return;
                            }
                            if (event.key === "Escape") {
                              setPromptReferenceDismissed(true);
                            }
                          }}
                          onDragOver={(event) => {
                            if (event.dataTransfer?.files?.length) {
                              event.preventDefault();
                            }
                          }}
                          onDrop={(event) => {
                            if (event.dataTransfer?.files?.length) {
                              event.preventDefault();
                              event.stopPropagation();
                            }
                          }}
                          placeholder={
                            multiShotsEnabled
                              ? "3 | Wide shot of the skyline\n2 | Hero steps into frame on the rooftop"
                              : "Describe the scene you imagine"
                          }
                          className={cn(
                            "scrollbar-none w-full resize-none rounded-[26px] border border-white/8 bg-white/[0.04] px-4 py-[18px] text-[0.86rem] leading-6 text-white outline-none placeholder:text-white/38 focus:border-[rgba(216,141,67,0.3)]",
                            "min-h-[146px] md:min-h-[136px]",
                          )}
                        />
                        {promptReferencePickerOpen ? (
                          <div className="absolute bottom-3 left-3 z-20 w-[min(19rem,calc(100%-4.5rem))] rounded-[18px] border border-white/10 bg-[rgba(17,20,19,0.96)] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.34)] backdrop-blur-xl">
                            <div className="grid gap-1">
                              {promptReferenceChoices.map((choice, index) => (
                                <button
                                  key={choice.id}
                                  type="button"
                                  data-testid={`studio-prompt-reference-option-${index + 1}`}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                  }}
                                  onClick={() => applyPromptReferenceChoice(choice)}
                                  className={cn(
                                    "flex items-center gap-3 rounded-[12px] px-2 py-2 text-left text-[0.8rem] font-medium text-white/82 transition hover:bg-white/[0.08] hover:text-white",
                                    promptReferenceActiveIndex === index ? "bg-white/[0.08] text-white" : "",
                                  )}
                                >
                                  <span
                                    className="inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-[10px] border border-white/10 bg-white/[0.05] bg-cover bg-center bg-no-repeat"
                                    style={choice.visualUrl ? { backgroundImage: `url("${choice.visualUrl}")` } : undefined}
                                  >
                                    {!choice.visualUrl ? (
                                      <span className="flex h-full w-full items-center justify-center text-white/48">
                                        <ImageIcon className="size-4" />
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
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
              <div
                className={cn(
                  "relative z-30 flex flex-wrap items-center gap-2 pb-1 text-[0.77rem]",
                  structuredPresetActive ? "pt-[6px]" : "",
                )}
              >
                    {!structuredPresetActive || showStructuredPresetModelPicker ? (
                      <>
                        <PillSelect
                          pickerId="model"
                          open={openPicker === "model"}
                          onToggle={() => setOpenPicker(openPicker === "model" ? null : "model")}
                          onClose={() => setOpenPicker(null)}
                          widthClassName={pickerWidth("model")}
                          icon={Clapperboard}
                          label={composerModelLabel(currentModel?.label)}
                          selectedValue={modelKey ?? ""}
                          menuTitle="Model"
                          choices={
                            structuredPresetActive && showStructuredPresetModelPicker
                              ? structuredPresetModelChoices
                              : enabledStudioModels.map((model) => ({
                                  value: model.key,
                                  label: composerModelLabel(model.label),
                                }))
                          }
                          onSelect={(value) => {
                            if (structuredPresetActive && showStructuredPresetModelPicker) {
                              setModelKey(value);
                              setValidation(null);
                              return;
                            }
                            setModelKey(value);
                            setSelectedPresetId("");
                            setSelectedPromptIds([]);
                            setValidation(null);
                            setPresetInputValues({});
                            setPresetSlotStates({});
                          }}
                        />

                        {!structuredPresetActive && (selectedPresetId || modelPresets.length) ? (
                          <PillSelect
                            pickerId="preset"
                            open={openPicker === "preset"}
                            onToggle={() => setOpenPicker(openPicker === "preset" ? null : "preset")}
                            onClose={() => setOpenPicker(null)}
                            widthClassName={pickerWidth("preset")}
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
                      </>
                    ) : null}

                    {modelMaxOutputs > 1 ? (
                      <PillSelect
                        pickerId="output-count"
                        open={openPicker === "output-count"}
                        onToggle={() => setOpenPicker(openPicker === "output-count" ? null : "output-count")}
                        onClose={() => setOpenPicker(null)}
                        widthClassName={pickerWidth("output-count")}
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
                        <PillSelect
                          key={optionKey}
                          pickerId={optionKey}
                          open={openPicker === optionKey}
                          onToggle={() => setOpenPicker(openPicker === optionKey ? null : optionKey)}
                          onClose={() => setOpenPicker(null)}
                          widthClassName={pickerWidth(optionKey)}
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

      {referenceLibraryTarget ? (
        <StudioReferenceLibrary
          title={referenceLibraryTarget.title}
          kind="image"
          onClose={() => setReferenceLibraryTarget(null)}
          onSelect={(reference) => void handleReferenceLibrarySelect(reference)}
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
                    showReviseAction={Boolean(selectedAssetRevisionPlan?.targetModel)}
                    onDownload={() => void handleAssetDownload(selectedAsset)}
                    onDismiss={() => void dismissAsset(selectedAsset.asset_id)}
                    onAnimate={() => useAssetAsSource(selectedAsset, true)}
                    onUseImage={() => useAssetAsSource(selectedAsset, false)}
                    onRevise={() => void reviseSelectedAssetInStudio(selectedAsset)}
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

                <div className="hidden min-h-0 content-start gap-4 rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:grid lg:overflow-y-auto lg:p-5">
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
                  showReviseAction={Boolean(selectedAssetRevisionPlan?.targetModel)}
                  onDownload={() => void handleAssetDownload(selectedAsset)}
                  onDismiss={() => void dismissAsset(selectedAsset.asset_id)}
                  onAnimate={() => useAssetAsSource(selectedAsset, true)}
                  onUseImage={() => useAssetAsSource(selectedAsset, false)}
                  onRevise={() => void reviseSelectedAssetInStudio(selectedAsset)}
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
        <StudioFailedJobInspector
          job={selectedFailedJob}
          prompt={selectedFailedJobPrompt}
          imageReferences={selectedFailedJobImageReferences}
          onClose={() => setSelectedFailedJobId(null)}
          onDismiss={() => void dismissJob(selectedFailedJob.job_id)}
          onRetry={() => void retryFailedJobInStudio(selectedFailedJob)}
          onOpenReference={setSelectedReferencePreview}
          statusLabel={jobStatusLabel(selectedFailedJob.status)}
        />
      ) : null}

      {selectedAsset && selectedMediaLightboxOpen ? (
        <StudioLightbox
          selectedAsset={selectedAsset}
          selectedAssetDisplayVisual={selectedAssetDisplayVisual}
          selectedAssetPlaybackVisual={selectedAssetPlaybackVisual}
          selectedAssetLightboxVisual={selectedAssetLightboxVisual}
          lightboxVideoRef={lightboxVideoRef}
          onNavigate={navigateSelectedGalleryAsset}
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
