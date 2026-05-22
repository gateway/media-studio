"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Check,
  Coins,
  Clapperboard,
  FolderPlus,
  Image as ImageIcon,
  LoaderCircle,
  type LucideIcon,
  Monitor,
  Play,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { useGlobalActivity } from "@/components/global-activity";
import { StudioContextPanels } from "@/components/studio/studio-context-panels";
import {
  StudioMobileInputsContent,
  StudioMultiImageReferenceStrip,
  StudioSeedanceReferenceStrip,
  StudioSourceAttachmentStrip,
} from "@/components/studio/studio-composer-input-strips";
import { StudioCreateStage } from "@/components/studio/studio-create-stage";
import { StudioGallery } from "@/components/studio/studio-gallery";
import { StudioFailedJobInspector } from "@/components/studio/studio-failed-job-inspector";
import { StudioHeaderChrome } from "@/components/studio/studio-header-chrome";
import { StudioEnhanceDialog } from "@/components/studio/studio-enhance-dialog";
import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { StudioAssetInspector } from "@/components/studio/studio-asset-inspector";
import { StudioComposer } from "@/components/studio/studio-composer";
import { StudioComposerControls } from "@/components/studio/studio-composer-controls";
import { StudioMetricPill } from "@/components/studio/studio-metric-pill";
import { StudioPresetBrowser } from "@/components/studio/studio-preset-browser";
import { StudioPromptComposerBody } from "@/components/studio/studio-prompt-composer-body";
import { StudioReferenceLibrary } from "@/components/studio/studio-reference-library";
import { StudioSettingsModal } from "@/components/studio/studio-settings-modal";
import { StudioStructuredPresetComposer } from "@/components/studio/studio-structured-preset-composer";
import { useStudioTestHarness } from "@/components/studio/studio-test-harness";
import { StudioProjectBrowser } from "@/components/studio/studio-project-browser";
import { useStudioAssetActions } from "@/hooks/studio/use-studio-asset-actions";
import { useStudioComposer } from "@/hooks/studio/use-studio-composer";
import { useStudioGalleryFeed } from "@/hooks/studio/use-studio-gallery-feed";
import { useStudioInspectorState } from "@/hooks/studio/use-studio-inspector-state";
import { useStudioPolling } from "@/hooks/studio/use-studio-polling";
import { useStudioProjectWorkspace } from "@/hooks/studio/use-studio-project-workspace";
import { useStudioReferenceLibrary } from "@/hooks/studio/use-studio-reference-library";
import { useStudioRestoreCoordination } from "@/hooks/studio/use-studio-restore-coordination";
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
  applyPromptReferenceMention,
  batchPhaseMessage,
  classifyFile,
  detectPromptReferenceMention,
  HIDDEN_STUDIO_OPTION_KEYS,
  inferInputPattern,
  isCoarsePointerDevice,
  isMobileDownloadDevice,
  isRecord,
  mediaDisplayUrl,
  mediaPlaybackUrl,
  mediaPreviewUrl,
  mediaThumbnailUrl,
  mediaVariantUrl,
  modelInputLimit,
  resolveImageToVideoAnimationModel,
  MULTI_SHOT_MODEL_KEYS,
  normalizeStructuredPresetImageSlots,
  normalizeStructuredPresetTextFields,
  optionBooleanValue,
  optionChoices,
  optionEntries,
  orderedImageInputVisual,
  parseMultiShotScript,
  prefetchAssetThumbs,
  PresetSlotState,
  presetThumbnailVisual,
  prettifyModelLabel,
  renderStructuredPresetPrompt,
  sanitizeStudioOptions,
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
import { buildStudioScopedHref } from "@/lib/studio-navigation";
import type {
  MediaAsset,
  MediaBatch,
  MediaEnhancePreviewResponse,
  MediaJob,
  MediaModelSummary,
  MediaValidationResponse,
} from "@/lib/types";
import { estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";
import { installStudioDebugConsole, studioDebug } from "@/lib/studio-debug";
import {
  buildAssetReferencePreview,
  buildAttachmentPreview,
  orderedImageInputPreview,
} from "@/lib/studio-reference-previews";
import { resolveStudioShortcutAction } from "@/lib/studio-shortcuts";
import { cn } from "@/lib/utils";

function composerModelLabel(label: string | null | undefined) {
  if (!label) return "Model";
  if (label === "Seedance 2.0 Standard") return "Seedance 2.0";
  return label;
}

function composerModelIcon(model: MediaModelSummary | null | undefined): LucideIcon {
  if (!model) {
    return Clapperboard;
  }
  const taskModes = model.task_modes ?? [];
  const capabilities = model.capability_summary ?? [];
  const isVideoModel =
    model.generation_kind === "video" ||
    taskModes.some((mode) => mode.includes("video") || mode === "motion_control") ||
    capabilities.includes("video");
  return isVideoModel ? Clapperboard : ImageIcon;
}

function composerModelChoice(model: MediaModelSummary) {
  const isVideoModel = composerModelIcon(model) === Clapperboard;
  return {
    value: model.key,
    label: composerModelLabel(model.label),
    groupLabel: isVideoModel ? "Video" : "Images",
    groupOrder: isVideoModel ? 2 : 1,
  };
}

export function MediaStudio({
  apiHealthy,
  models,
  presets,
  prompts,
  enhancementConfigs,
  queueSettings,
  queuePolicies,
  projects,
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
  initialSelectedProjectId = null,
  immersive = false,
  closeHref = "/media",
}: MediaStudioProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showActivity } = useGlobalActivity();
  const [isRefreshing, startRefresh] = useTransition();
  const [hasMounted, setHasMounted] = useState(false);
  const [localRemainingCredits, setLocalRemainingCredits] = useState<number | null>(remainingCredits ?? null);
  const [studioSettingsOpen, setStudioSettingsOpen] = useState(false);
  const [presetBrowserOpen, setPresetBrowserOpen] = useState(false);
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
  const [formMessage, setFormMessage] = useState<ComposerStatusMessage | null>(null);
  const [selectedFailedJobId, setSelectedFailedJobId] = useState<string | null>(null);
  const [promptCursorIndex, setPromptCursorIndex] = useState<number | null>(null);
  const [promptHasFocus, setPromptHasFocus] = useState(false);
  const [promptReferenceDismissed, setPromptReferenceDismissed] = useState(false);
  const [promptReferenceActiveIndex, setPromptReferenceActiveIndex] = useState(0);
  const [pendingGalleryStep, setPendingGalleryStep] = useState<"next" | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const lastComposerDebugSignatureRef = useRef<string | null>(null);
  const settleRefreshTimerRef = useRef<number | null>(null);
  const settleRefreshPendingRef = useRef(false);
  const pollJobProxyRef = useRef<(jobId: string) => Promise<void>>(async () => {});
  const pollBatchProxyRef = useRef<(batchId: string) => Promise<void>>(async () => {});
  const openEnhanceDialogProxyRef = useRef<() => void>(() => undefined);
  const requestEnhancementPreviewProxyRef = useRef<() => Promise<void>>(async () => undefined);
  const applyEnhancementPromptProxyRef = useRef<() => boolean>(() => false);
  const enabledStudioModels = useMemo(
    () =>
      models.filter((model) => {
        if (model.studio_exposed === false) {
          return false;
        }
        const policy = queuePolicies.find((entry) => entry.model_key === model.key);
        return policy?.enabled ?? true;
      }),
    [models, queuePolicies],
  );
  const modelIconByKey = useMemo(
    () => new Map(models.map((model) => [model.key, composerModelIcon(model)])),
    [models],
  );
  const {
    localProjects,
    selectedProjectId,
    selectedProject,
    setLocalProjects,
    setSelectedProjectId,
    studioHrefForProject,
    openProjectWorkspace,
    createProjectInStudio,
    updateProjectInStudio,
    archiveProjectInStudio,
    unarchiveProjectInStudio,
    deleteProjectInStudio,
  } = useStudioProjectWorkspace({
    projects,
    initialSelectedProjectId,
    onBeforeProjectChange: clearGallerySelection,
    onCloseProjectBrowser: () => setProjectBrowserOpen(false),
  });
  useEffect(() => {
    setLocalRemainingCredits(remainingCredits ?? null);
  }, [remainingCredits]);

  const refreshCreditBalance = useCallback(async () => {
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
  }, []);
  const refreshRoute = useCallback(() => {
    startRefresh(() => router.refresh());
  }, [router, startRefresh]);
  const refreshStudioDataWithSettleDelay = useCallback(() => {
    if (!settleRefreshPendingRef.current) {
      settleRefreshPendingRef.current = true;
      refreshRoute();
    }
    if (settleRefreshTimerRef.current != null) {
      window.clearTimeout(settleRefreshTimerRef.current);
    }
    settleRefreshTimerRef.current = window.setTimeout(() => {
      settleRefreshTimerRef.current = null;
      settleRefreshPendingRef.current = false;
      refreshRoute();
    }, 1400);
  }, [refreshRoute]);

  useEffect(() => {
    return () => {
      if (settleRefreshTimerRef.current != null) {
        window.clearTimeout(settleRefreshTimerRef.current);
      }
    };
  }, []);
  const gallery = useStudioGalleryFeed({
    batches,
    jobs,
    assets,
    activeProjectId: selectedProjectId,
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
  const mobileAddTileClassName = "h-[58px] w-[58px] rounded-[18px]";
  const mobileAddTilePlusIconClassName = "size-5";
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
  const inspector = useStudioInspectorState({
    pathname,
    selectedProjectId,
    selectedFailedJobId,
    selectedAsset,
    selectedAssetJob,
    selectedAssetPresetSlots,
    selectedAssetPresetSlotValues,
    localJobs,
    localBatches,
    localAssets,
    favoriteAssets,
    localProjects,
    models,
    presets,
    resetInspector,
    setSelectedFailedJobId,
  });
  const {
    selectedFailedJob,
    selectedFailedJobBatch,
    selectedAssetBatch,
    selectedAssetProject,
    selectedFailedJobPrompt,
    selectedFailedJobReferenceInputs,
    selectedFailedJobPrimaryInput,
    selectedFailedJobRetryPlan,
    selectedFailedJobImageReferences,
    selectedAssetReferencePreviews,
    selectedAssetRevisionPlan,
    closeAssetInspector,
  } = inspector;

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
    projectId: selectedProjectId,
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
    enhanceHasSavedSystemPrompt,
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
    addRestoredFiles,
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
  } = composer.actions;

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
    refreshRoute,
    refreshCreditBalance,
    watchBatches: localBatches,
    watchJobs: localJobs,
  });
  const { favoriteAssetIdBusy } = polling.state;
  const { pollJob, pollBatch, retryJob, dismissJob, dismissAsset, toggleAssetFavorite } = polling.actions;
  const { copyPromptStatus, downloadActionLabel, copyPromptFromAsset, downloadAsset } = useStudioAssetActions({
    hasMounted,
    onMessage: setFormMessage,
    showActivity,
  });
  const mobileComposerExpanded = !mobileComposerCollapsed;
  const structuredPresetModelChoices = useMemo(() => {
    if (!structuredPresetActive) {
      return [];
    }
    const supportedModelKeys = new Set(studioPresetSupportedModels(currentPreset, models));
    return models
      .filter((model) => supportedModelKeys.has(model.key))
      .map(composerModelChoice);
  }, [currentPreset, models, structuredPresetActive]);
  const showStructuredPresetModelPicker = structuredPresetActive && structuredPresetModelChoices.length > 1;
  const selectedProjectMetric = selectedProject ? (
    <div className="studio-project-metric hidden md:flex items-center overflow-hidden rounded-[14px]">
      <button
        type="button"
        onClick={() => openProjectWorkspace(selectedProject.project_id)}
        className="inline-flex h-10 items-center gap-2 px-3 text-[0.72rem] font-semibold transition"
        aria-label={`Open project ${selectedProject.name}`}
      >
        <span className="studio-project-metric-icon inline-flex h-5 w-5 items-center justify-center rounded-full">
          <FolderPlus className="size-3.5" />
        </span>
        <span>{selectedProject.name}</span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          openProjectWorkspace(null);
        }}
        className="studio-project-metric-close inline-flex h-10 items-center justify-center px-3 transition"
        aria-label="Exit project workspace"
        title="Exit project workspace"
      >
        <X className="size-3.5" />
      </button>
    </div>
  ) : null;

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
  const standardComposerSlots = standardComposerLayout.slots.filter((slot) => slot.visible);
  const standardComposerSectionTitle = standardComposerSlots.some((slot) => slot.role === "driving_video")
    ? "Motion inputs"
    : standardComposerSlots.some((slot) => slot.role === "start_frame" || slot.role === "end_frame")
      ? "Frames"
      : standardComposerSlots.length > 0
        ? "Input"
        : "Inputs";
  const {
    selectedReferencePreview,
    referenceLibraryTarget,
    setSelectedReferencePreview,
    setReferenceLibraryTarget,
    openReferencePreview,
    openContextualReferenceLibrary,
    handleReferenceLibrarySelect,
  } = useStudioReferenceLibrary({
    canOpenReferenceLibrary,
    structuredPresetActive,
    structuredPresetImageSlots,
    presetSlotStates,
    seedanceComposer,
    seedanceFirstFrameAttachment,
    seedanceLastFrameAttachment,
    effectiveSeedanceMode,
    standardComposerUsesExplicitSlots: standardComposerLayout.usesExplicitSlots,
    standardComposerSlots,
    orderedImageInputCount: orderedImageInputs.length,
    dedicatedImageReferenceRailActive,
    setOpenPicker,
    setFormMessage,
    assignPresetSlotReference,
    clearSourceAsset,
    addReferenceMediaAsAttachment,
    orderedImageInputSourceAt: (slotIndex) => orderedImageInputs[slotIndex]?.source ?? null,
  });
  useStudioTestHarness({
    setModelKey,
    setLocalAssets,
    setLocalJobs,
    setLocalBatches: gallery.actions.setLocalBatches,
    setSelectedFailedJobId,
    setSelectedAssetId,
    setSelectedMediaLightboxOpen,
    activateGalleryKindFilter,
    setGalleryModelFilter,
    openContextualReferenceLibrary,
    openEnhanceDialogRef: openEnhanceDialogProxyRef,
    requestEnhancementPreviewRef: requestEnhancementPreviewProxyRef,
    applyEnhancementPromptRef: applyEnhancementPromptProxyRef,
  });
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
    <StudioMultiImageReferenceStrip
      imageLimitLabel={imageLimitLabel}
      orderedImageInputs={orderedImageInputs}
      canAddMoreImages={canAddMoreImages}
      isDragActive={isDragActive}
      buildOrderedImageInputPreview={orderedImageInputPreview}
      onOpenPreview={openReferencePreview}
      onClearOrderedImageInput={clearOrderedImageInput}
      onSetDragActive={setIsDragActive}
      onDropIntoSlot={(event, slotIndex) => void handleSourceTileDrop(event, slotIndex)}
      onAddImageFilesToOrderedSlot={addImageFilesToOrderedSlot}
    />
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
      // Replacing an image slot has to clear a source-asset-backed slot before the
      // file add runs, otherwise the ordered attachment insert would duplicate it.
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

  const sourceAttachmentStrip = !structuredPresetActive &&
    !dedicatedImageReferenceRailActive &&
    (seedanceComposer || standardComposerLayout.usesExplicitSlots || genericSourceInputsAvailable) ? (
    <StudioSourceAttachmentStrip
      seedanceComposer={seedanceComposer}
      standardComposerUsesExplicitSlots={standardComposerLayout.usesExplicitSlots}
      genericSourceInputsAvailable={genericSourceInputsAvailable}
      isDragActive={isDragActive}
      seedanceFirstFrameAttachment={seedanceFirstFrameAttachment}
      seedanceLastFrameAttachment={seedanceLastFrameAttachment}
      standardComposerSlots={standardComposerSlots}
      orderedImageInputs={orderedImageInputs}
      currentSourceAsset={currentSourceAsset}
      canUseSourceAsset={canUseSourceAsset}
      attachments={attachments}
      genericSourceAddTileVisible={genericSourceAddTileVisible}
      imageLimitLabel={imageLimitLabel}
      maxVideoInputs={maxVideoInputs}
      maxAudioInputs={maxAudioInputs}
      explicitVideoImageSlots={explicitVideoImageSlots}
      explicitMotionControlSlots={explicitMotionControlSlots}
      stagedVideoCount={stagedVideoCount}
      stagedAudioCount={stagedAudioCount}
      mobileAddTileClassName={mobileAddTileClassName}
      mobileAddTilePlusIconClassName={mobileAddTilePlusIconClassName}
      buildAttachmentPreview={buildAttachmentPreview}
      buildAssetReferencePreview={buildAssetReferencePreview}
      standardComposerSlotPreview={standardComposerSlotPreview}
      standardComposerSlotVisual={standardComposerSlotVisual}
      onSetDragActive={setIsDragActive}
      onSetFormWarning={(text) => setFormMessage({ tone: "warning", text })}
      onDropIntoSourceSlot={(event, slotIndex, slot) => void handleSourceTileDrop(event, slotIndex, slot)}
      onOpenPreview={openReferencePreview}
      onRemoveAttachment={removeAttachment}
      onClearSourceAsset={clearSourceAsset}
      onClearStandardComposerSlot={clearStandardComposerSlot}
      onPickStandardComposerSlotFiles={addFilesToStandardComposerSlot}
      onAddFiles={addFiles}
      onResetFileInput={resetFileInputValue}
    />
  ) : null;
  const seedanceReferenceStrip =
    seedanceComposer ? (
      <StudioSeedanceReferenceStrip
        isDragActive={isDragActive}
        referenceImages={seedanceReferenceImages}
        referenceVideos={seedanceReferenceVideos}
        referenceAudios={seedanceReferenceAudios}
        buildAttachmentPreview={buildAttachmentPreview}
        onSetDragActive={setIsDragActive}
        onReferenceDrop={(event, kind) => void handleSeedanceReferenceDrop(event, kind)}
        onOpenPreview={openReferencePreview}
        onRemoveAttachment={removeAttachment}
        onAddFiles={addFiles}
        onResetFileInput={resetFileInputValue}
      />
    ) : null;
  const mobileInputsSection = !structuredPresetActive ? (
    <StudioMobileInputsContent
      dedicatedImageReferenceRailActive={dedicatedImageReferenceRailActive}
      seedanceComposer={seedanceComposer}
      standardComposerUsesExplicitSlots={standardComposerLayout.usesExplicitSlots}
      sourceAttachmentStripVisible={Boolean(sourceAttachmentStrip)}
      effectiveSeedanceMode={effectiveSeedanceMode}
      imageLimitLabel={imageLimitLabel}
      orderedImageInputs={orderedImageInputs}
      canAddMoreImages={canAddMoreImages}
      isDragActive={isDragActive}
      seedanceFirstFrameAttachment={seedanceFirstFrameAttachment}
      seedanceLastFrameAttachment={seedanceLastFrameAttachment}
      seedanceReferenceImages={seedanceReferenceImages}
      seedanceReferenceVideos={seedanceReferenceVideos}
      seedanceReferenceAudios={seedanceReferenceAudios}
      standardComposerSectionTitle={standardComposerSectionTitle}
      standardComposerSummaryLabel={standardComposerLayout.summaryLabel}
      standardComposerSlots={standardComposerSlots}
      currentSourceAsset={currentSourceAsset}
      canUseSourceAsset={canUseSourceAsset}
      attachments={attachments}
      genericSourceAddTileVisible={genericSourceAddTileVisible}
      stagedVideoCount={stagedVideoCount}
      stagedAudioCount={stagedAudioCount}
      mobileAddTileClassName={mobileAddTileClassName}
      mobileAddTilePlusIconClassName={mobileAddTilePlusIconClassName}
      buildOrderedImageInputPreview={orderedImageInputPreview}
      buildAttachmentPreview={buildAttachmentPreview}
      buildAssetReferencePreview={buildAssetReferencePreview}
      standardComposerSlotPreview={standardComposerSlotPreview}
      standardComposerSlotVisual={standardComposerSlotVisual}
      onSetDragActive={setIsDragActive}
      onSetFormWarning={(text) => setFormMessage({ tone: "warning", text })}
      onDropIntoSourceSlot={(event, slotIndex, slot) => void handleSourceTileDrop(event, slotIndex, slot)}
      onSeedanceReferenceDrop={(event, kind) => void handleSeedanceReferenceDrop(event, kind)}
      onOpenPreview={openReferencePreview}
      onClearOrderedImageInput={clearOrderedImageInput}
      onClearSourceAsset={clearSourceAsset}
      onRemoveAttachment={removeAttachment}
      onClearStandardComposerSlot={clearStandardComposerSlot}
      onPickStandardComposerSlotFiles={addFilesToStandardComposerSlot}
      onAddFiles={addFiles}
      onAddImageFilesToOrderedSlot={addImageFilesToOrderedSlot}
      onResetFileInput={resetFileInputValue}
    />
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

  const isTypingTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  }, []);

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
    isTypingTarget,
  ]);

  useEffect(() => {
    if (!selectedAsset || selectedMediaLightboxOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeAssetInspector();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeAssetInspector, selectedAsset, selectedMediaLightboxOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const action = resolveStudioShortcutAction({
        key: event.key,
        hasModifier: false,
        typing: isTypingTarget(event.target),
        overlayOpen: lockingOverlayOpen,
      });
      if (action === "open-graph") {
        event.preventDefault();
        void router.push("/graph-studio");
        return;
      }
      if (action === "open-projects") {
        event.preventDefault();
        setProjectBrowserOpen(true);
        return;
      }
      if (action === "open-presets") {
        event.preventDefault();
        setPresetBrowserOpen(true);
        return;
      }
      if (action === "open-settings") {
        event.preventDefault();
        void router.push(buildStudioScopedHref("/settings", selectedProjectId));
        return;
      }
      if (action === "open-library") {
        event.preventDefault();
        openContextualReferenceLibrary();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isTypingTarget,
    lockingOverlayOpen,
    openContextualReferenceLibrary,
    router,
    selectedProjectId,
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

  function useAssetAsSource(asset: MediaAsset | null, animate = false) {
    if (!asset) {
      return;
    }
    if (!animate && !seedanceComposer && !structuredPresetActive && !canUseSourceAsset && !explicitVideoImageSlots && !dedicatedImageReferenceRailActive) {
      setFormMessage({ tone: "warning", text: "The selected model is text-to-video only, so Studio is hiding source image inputs." });
      return;
    }
    if (animate && asset.generation_kind === "image") {
      const animateTargetModel = resolveImageToVideoAnimationModel(models, currentModel);
      if (!animateTargetModel) {
        setFormMessage({ tone: "warning", text: "No image-to-video model is available for this image." });
        return;
      }
      stageSourceAsset(asset);
      if (animateTargetModel.key !== modelKey) {
        setModelKey(animateTargetModel.key);
      }
      closeAssetInspector();
      setMobileComposerCollapsed(!isCoarsePointerDevice());
      setFormMessage({ tone: "warning", text: "The selected image is now staged for the animate flow." });
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
        closeAssetInspector();
        setFormMessage({ tone: "warning", text: "The selected asset is now staged as the driving video." });
        return;
      }
      stageSourceAsset(asset);
      closeAssetInspector();
      setMobileComposerCollapsed(!isCoarsePointerDevice());
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
      closeAssetInspector();
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
      closeAssetInspector();
      setFormMessage({ tone: "warning", text: `${asset.prompt_summary ? "Image" : "Selected asset"} assigned to ${nextSlot.label}.` });
      return;
    }
    // Plain source-image flows keep one dedicated source asset outside the generic
    // attachment strip so slot zero is not duplicated when explicit slot contracts
    // later stage image attachments into ordered positions.
    stageSourceAsset(asset);
    closeAssetInspector();
    // Desktop keeps the docked composer anchored to the viewport.
    setMobileComposerCollapsed(!isCoarsePointerDevice());
    setFormMessage({
      tone: "warning",
      text: animate
        ? "The selected image is now staged for the animate flow."
        : "The selected asset is now attached as a source reference.",
    });
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

  const { retryFailedJobInStudio, reviseSelectedAssetInStudio } = useStudioRestoreCoordination({
    inspector,
    composer,
    selectedAssetJob,
    models,
    presets,
    localAssets,
    favoriteAssets,
    selectedProjectId,
    setSelectedProjectId,
    studioHrefForProject,
    setLocalAssets,
    setLocalJobs,
    upsertBatch,
    setSelectedFailedJobId,
    setSelectedAssetId,
    setSelectedMediaLightboxOpen,
    clearSelectedReferencePreview: () => setSelectedReferencePreview(null),
    setFormMessage,
    revealComposer,
  });

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

  return (
    <div className={immersive ? "min-h-dvh" : "space-y-7"}>
      <StudioCreateStage immersive={immersive}>
          <StudioHeaderChrome
            immersive={immersive}
            apiHealthy={apiHealthy}
            galleryModelFilter={galleryModelFilter}
            models={models}
            favoritesOnly={favoritesOnly}
            galleryKindFilter={galleryKindFilter}
            projectWorkspaceActive={Boolean(selectedProject)}
            metrics={
              !selectedAsset ? (
                <div className="hidden items-center gap-2 md:flex">
                  {selectedProjectMetric}
                  {formattedRemainingCredits ? <StudioMetricPill icon={Coins} value={formattedRemainingCredits} /> : null}
                  {estimatedCredits ? <StudioMetricPill icon={Coins} value={estimatedCredits} accent="highlight" /> : null}
                </div>
              ) : null
            }
            onGalleryModelFilterChange={handleGalleryModelFilterChange}
            onActivateGalleryKindFilter={handleGalleryKindFilterChange}
            onToggleFavoritesFilter={handleFavoritesFilterToggle}
            onOpenProjects={() => setProjectBrowserOpen(true)}
            onOpenPresets={() => setPresetBrowserOpen(true)}
            onOpenLibrary={openContextualReferenceLibrary}
            onOpenSettings={() => void router.push(buildStudioScopedHref("/settings", selectedProjectId))}
          />

          <StudioGallery
            apiHealthy={apiHealthy}
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
                  structuredPresetActive={structuredPresetActive}
                  presetLabel={currentPreset?.label ?? null}
                  externalTopContent={
                    multiImageReferenceStrip || seedanceReferenceStrip ? (
                      <div className="hidden space-y-3 md:block">
                        {multiImageReferenceStrip ?? seedanceReferenceStrip}
                      </div>
                    ) : null
                  }
                  mobileInputsContent={mobileInputsSection}
                  sourceAttachmentStrip={sourceAttachmentStrip}
                  floatingComposerStatus={floatingComposerStatus}
                  onToggleCollapsed={() => setMobileComposerCollapsed((current) => !current)}
                >
                  {structuredPresetActive ? (
                    <StudioStructuredPresetComposer
                      preset={currentPreset}
                      imageSlots={structuredPresetImageSlots}
                      textFields={structuredPresetTextFields}
                      slotStates={presetSlotStates}
                      inputValues={presetInputValues}
                      localAssets={localAssets ?? []}
                      favoriteAssets={favoriteAssets ?? []}
                      onPresetInputValuesChange={setPresetInputValues}
                      onAssignSlotFile={assignPresetSlotFile}
                      onClearSlot={clearPresetSlot}
                      onDropSlot={handlePresetSlotDrop}
                      onOpenPreview={openReferencePreview}
                      onResetFileInput={resetFileInputValue}
                    />
	                  ) : (
	                    <StudioPromptComposerBody
	                      promptInputRef={promptInputRef}
	                      prompt={prompt}
	                      multiShotsEnabled={multiShotsEnabled}
	                      promptReferencePickerOpen={promptReferencePickerOpen}
	                      promptReferenceChoices={promptReferenceChoices}
	                      promptReferenceActiveIndex={promptReferenceActiveIndex}
	                      enhanceEnabledForModel={enhanceEnabledForModel}
	                      enhanceConfiguredForModel={enhanceConfiguredForModel}
	                      enhanceHasSavedSystemPrompt={enhanceHasSavedSystemPrompt}
	                      onPromptChange={setPrompt}
	                      onPromptFocusChange={setPromptHasFocus}
	                      onPromptReferenceDismissedChange={setPromptReferenceDismissed}
	                      onPromptCursorSync={syncPromptCursorIndex}
	                      onPromptReferenceActiveIndexChange={setPromptReferenceActiveIndex}
	                      onApplyPromptReferenceChoice={applyPromptReferenceChoice}
	                      onOpenEnhanceDialog={openEnhanceDialog}
	                      onOpenEnhancementSetup={openEnhancementSetup}
	                    />
	                  )}
              <StudioComposerControls
                structuredPresetActive={structuredPresetActive}
                showStructuredPresetModelPicker={showStructuredPresetModelPicker}
                openPicker={openPicker}
                modelIconByKey={modelIconByKey}
                currentModel={currentModel}
                currentModelIcon={composerModelIcon(currentModel)}
                currentModelLabel={composerModelLabel(currentModel?.label)}
                modelKey={modelKey}
                modelChoices={
                  structuredPresetActive && showStructuredPresetModelPicker
                    ? structuredPresetModelChoices
                    : enabledStudioModels.map(composerModelChoice)
                }
                selectedPresetId={selectedPresetId}
                modelPresets={modelPresets}
                modelMaxOutputs={modelMaxOutputs}
                outputCount={outputCount}
                compactOptionEntries={compactOptionEntries}
                optionValues={optionValues}
                inferredInputPattern={inferredInputPattern}
                canSubmit={canSubmit}
                generateButtonLabel={generateButtonLabel}
                onOpenPickerChange={setOpenPicker}
                onModelChange={setModelKey}
                onResetModelScopedSelection={() => {
                  setSelectedPresetId("");
                  setSelectedPromptIds([]);
                  setPresetInputValues({});
                  setPresetSlotStates({});
                }}
                onValidationChange={setValidation}
                onPresetSelection={applyPresetSelection}
                onOutputCountChange={setOutputCount}
                onOptionChange={updateOption}
                onClear={clearComposer}
                onSubmit={() => void submitMedia("submit")}
              />
	              {(selectedPromptList.length || multiShotsEnabled) ? (
                <div className="mt-4 grid gap-3 border-t border-[var(--border-soft)] pt-4">
                  <div className="grid gap-2">
                    {multiShotsEnabled ? (
                      <div className="studio-composer-muted-tile rounded-[20px] px-4 py-3 text-sm text-[var(--text-muted)]">
                        {multiShotScriptError ? (
                          <span className="text-[var(--feedback-danger-text)]">{multiShotScriptError}</span>
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
                            className="studio-composer-muted-tile rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
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
      </StudioCreateStage>

      <StudioEnhanceDialog
        open={enhanceDialogOpen}
        previewVisual={enhancementPreviewVisual}
        userPrompt={(structuredPresetActive ? structuredPresetPromptPreview : prompt) || ""}
        enhancedPrompt={enhancePreview?.final_prompt_used || enhancePreview?.enhanced_prompt || null}
        imageAnalysisText={enhanceImageAnalysisText}
        currentModelLabel={currentModel?.label ?? null}
        currentPresetLabel={currentPreset?.label ?? null}
        providerLabel={enhanceProviderLabel}
        providerModelId={enhanceProviderModelId ?? null}
        modeLabel={enhanceModeLabel}
        readinessLabel={enhanceReadinessLabel}
        imageAnalysisStatus={enhanceImageAnalysisStatus}
        configuredForModel={enhanceConfiguredForModel}
        hasSavedSystemPrompt={enhanceHasSavedSystemPrompt}
        busy={enhanceBusy}
        error={enhanceError}
        warnings={enhancePreview?.warnings ?? []}
        onClose={() => setEnhanceDialogOpen(false)}
        onRequestPreview={() => {
          void requestEnhancementPreview();
        }}
        onOpenSetup={openEnhancementSetup}
        onUsePrompt={() => {
          applyEnhancementPrompt();
        }}
      />

      {presetBrowserOpen ? (
        <StudioPresetBrowser
          presets={availableStudioPresets}
          models={models}
          onClose={() => setPresetBrowserOpen(false)}
          onSelectPreset={(preset) => loadPresetIntoStudio(preset.preset_id ?? preset.key)}
        />
      ) : null}

      {projectBrowserOpen ? (
        <StudioProjectBrowser
          projects={localProjects}
          selectedProjectId={selectedProjectId}
          onClose={() => setProjectBrowserOpen(false)}
          onSelectProject={openProjectWorkspace}
          onCreateProject={createProjectInStudio}
          onUpdateProject={updateProjectInStudio}
          onArchiveProject={archiveProjectInStudio}
          onUnarchiveProject={unarchiveProjectInStudio}
          onDeleteProject={deleteProjectInStudio}
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
        <StudioSettingsModal
          models={models}
          presets={presets}
          enhancementConfigs={enhancementConfigs}
          initialSelectedModelKey={modelKey}
          onClose={() => setStudioSettingsOpen(false)}
        />
      ) : null}

      {selectedAsset ? (
        <StudioAssetInspector
          selectedAsset={selectedAsset}
          selectedAssetDisplayVisual={selectedAssetDisplayVisual}
          selectedAssetPlaybackVisual={selectedAssetPlaybackVisual}
          selectedAssetPrompt={selectedAssetPrompt}
          selectedAssetStructuredPresetActive={selectedAssetStructuredPresetActive}
          selectedAssetPresetLabel={selectedAssetPreset?.label || selectedAsset.preset_key || "Preset"}
          selectedAssetPresetDescription={selectedAssetPreset?.description ?? null}
          selectedAssetPresetSlots={selectedAssetPresetSlots}
          selectedAssetPresetSlotValues={selectedAssetPresetSlotValues}
          selectedAssetPresetFields={selectedAssetPresetFields}
          selectedAssetPresetInputValues={selectedAssetPresetInputValues}
          selectedAssetProjectLabel={selectedAssetProject?.name ?? null}
          selectedAssetReferencePreviews={selectedAssetReferencePreviews}
          favoriteAssetIdBusy={favoriteAssetIdBusy}
          copyPromptStatus={copyPromptStatus}
          mobileInspectorPromptOpen={mobileInspectorPromptOpen}
          mobileInspectorInfoOpen={mobileInspectorInfoOpen}
          downloadActionLabel={downloadActionLabel}
          showReviseAction={Boolean(selectedAssetRevisionPlan?.targetModel)}
          onClose={closeAssetInspector}
          onOpenLightbox={openSelectedMediaLightbox}
          onCopyPrompt={() => {
            void copyPromptFromAsset(selectedAssetPrompt);
          }}
          onToggleFavorite={toggleAssetFavorite}
          onOpenProject={openProjectWorkspace}
          onOpenReference={setSelectedReferencePreview}
          onMobileInspectorPromptOpenChange={setMobileInspectorPromptOpen}
          onMobileInspectorInfoOpenChange={setMobileInspectorInfoOpen}
          onDownload={() => void downloadAsset(selectedAsset)}
          onDismiss={() => void dismissAsset(selectedAsset.asset_id)}
          onAnimate={() => useAssetAsSource(selectedAsset, true)}
          onUseImage={() => useAssetAsSource(selectedAsset, false)}
          onRevise={() => void reviseSelectedAssetInStudio(selectedAsset)}
        />
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
        <StudioContextPanels
          localJobs={localJobs}
          currentModel={currentModel}
          selectedPromptList={selectedPromptList}
          validation={validation}
        />
      ) : null}
    </div>
  );
}
