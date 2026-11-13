"use client";

import { resolveStudioComposerInputRail } from "@/lib/studio-model-support";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { useGlobalActivity } from "@/components/global-activity";
import { StudioContextPanels } from "@/components/studio/studio-context-panels";
import {
  StudioMobileInputsContent,
  StudioSeedanceReferenceStrip,
  StudioSourceAttachmentStrip,
} from "@/components/studio/studio-composer-input-strips";
import type { StudioAddFilesHandler } from "@/components/studio/studio-composer-input-types";
import { useSeedanceComposerInputs } from "@/components/studio/studio-seedance-inputs";
import { StudioMultiImageReferenceStrip } from "@/components/studio/studio-multi-image-reference-strip";
import { StudioCreateStage } from "@/components/studio/studio-create-stage";
import { StudioGallery } from "@/components/studio/studio-gallery";
import { StudioFailedJobInspector } from "@/components/studio/studio-failed-job-inspector";
import { StudioHeaderChrome } from "@/components/studio/studio-header-chrome";
import { StudioEnhanceDialog } from "@/components/studio/studio-enhance-dialog";
import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import { StudioLightbox } from "@/components/studio/studio-lightbox";
import { StudioAssetInspector } from "@/components/studio/studio-asset-inspector";
import { StudioComposer } from "@/components/studio/studio-composer";
import {
  StudioComposerControls,
  StudioComposerModelPicker,
  StudioComposerOutputPicker,
  StudioComposerPresetPicker,
} from "@/components/studio/studio-composer-controls";
import { StudioPresetBrowser } from "@/components/studio/studio-preset-browser";
import { StudioPromptComposerBody } from "@/components/studio/studio-prompt-composer-body";
import { StudioReferenceLibrary } from "@/components/studio/studio-reference-library";
import { StudioSettingsModal } from "@/components/studio/studio-settings-modal";
import type { StudioStandardSlotRailProps } from "@/components/studio/studio-standard-slot-rail";
import { StudioStructuredPresetComposer } from "@/components/studio/studio-structured-preset-composer";
import {
  buildStudioHarnessAttachment,
  buildStudioHarnessMotionVideoAttachment,
  type StudioHarnessFixtureState,
  type StudioTestFixtureControls,
  useStudioShellHandoffSnapshot,
  useStudioTestHarness,
} from "@/components/studio/studio-test-harness";
import { StudioProjectBrowser } from "@/components/studio/studio-project-browser";
import { useStudioAssetActions } from "@/hooks/studio/use-studio-asset-actions";
import { useStudioSourceAsset } from "@/hooks/studio/use-studio-source-asset";
import { useStudioComposer } from "@/hooks/studio/use-studio-composer";
import { useStudioGalleryFeed } from "@/hooks/studio/use-studio-gallery-feed";
import { useStudioInspectorState } from "@/hooks/studio/use-studio-inspector-state";
import { useStudioPolling } from "@/hooks/studio/use-studio-polling";
import { useStudioProjectWorkspace } from "@/hooks/studio/use-studio-project-workspace";
import {
  studioReferenceLibraryKind,
  useStudioReferenceLibrary,
} from "@/hooks/studio/use-studio-reference-library";
import { useStudioRestoreCoordination } from "@/hooks/studio/use-studio-restore-coordination";
import { useStudioSelection } from "@/hooks/studio/use-studio-selection";
import {
  fetchStudioPresetDetail,
  mergeStudioPresetDetail,
  studioComposerModelChoice,
  useStudioShellCatalog,
} from "@/hooks/studio/use-studio-shell-catalog";
import {
  type ComposerStatusMessage,
  type GalleryKindFilter,
  INITIAL_ASSET_PAGE_SIZE,
  type MediaStudioProps,
} from "@/lib/media-studio-contract";
import { findMediaAssetById } from "@/lib/studio-gallery";
import {
  applyPromptReferenceMention,
  MULTI_SHOT_MODEL_KEYS,
  detectPromptReferenceMention,
  isCoarsePointerDevice,
  mediaDisplayUrl,
  mediaThumbnailUrl,
  modelInputLimit,
  resolveImageToVideoAnimationModel,
  orderedImageInputVisual,
  type StudioComposerSlot,
  studioPresetSupportedModels,
  jobStatusLabel,
} from "@/lib/media-studio-helpers";
import {
  buildGraphStudioHref,
  buildStudioScopedHref,
} from "@/lib/studio-navigation";
import {
  mobileComposerCollapsedForProgrammaticExpand,
  revealStudioComposer,
  type StudioComposerRevealOptions,
} from "@/lib/studio-composer-reveal";
import type {
  MediaAsset,
  MediaJob,
  MediaPreset,
  MediaValidationResponse,
} from "@/lib/types";
import { installStudioDebugConsole, studioDebug } from "@/lib/studio-debug";
import {
  buildAssetReferencePreview,
  buildAttachmentPreview,
  orderedImageInputPreview,
} from "@/lib/studio-reference-previews";
import { resolveStudioShortcutAction } from "@/lib/studio-shortcuts";

const STUDIO_COMPOSER_COLLAPSED_STORAGE_KEY =
  "media-studio:desktop-composer-collapsed";
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
  initialAssetsHasMore = false,
  initialAssetsNextOffset = null,
  initialAssetsNextCursor = null,
  latestAsset,
  remainingCredits,
  pricingSnapshot,
  initialSelectedAssetId = null,
  initialSelectedProjectId = null,
  immersive = false,
}: MediaStudioProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showActivity } = useGlobalActivity();
  const [, startRefresh] = useTransition();
  const [hasMounted, setHasMounted] = useState(false);
  const [desktopComposerCollapsed, setDesktopComposerCollapsed] =
    useState(false);
  const [localRemainingCredits, setLocalRemainingCredits] = useState<
    number | null
  >(remainingCredits ?? null);
  const [studioSettingsOpen, setStudioSettingsOpen] = useState(false);
  const [presetBrowserOpen, setPresetBrowserOpen] = useState(false);
  const studioLibraryTriggerRef = useRef<HTMLButtonElement>(null);
  const [hydratedStudioPresets, setHydratedStudioPresets] = useState<
    MediaPreset[]
  >([]);
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
  const [referencesExpanded, setReferencesExpanded] = useState(false);
  const [formMessage, setFormMessage] = useState<ComposerStatusMessage | null>(
    null,
  );
  const [selectedFailedJobId, setSelectedFailedJobId] = useState<string | null>(
    null,
  );
  const [studioHarnessFixtureState, setStudioHarnessFixtureState] =
    useState<StudioHarnessFixtureState | null>(null);
  const [promptCursorIndex, setPromptCursorIndex] = useState<number | null>(
    null,
  );
  const [promptHasFocus, setPromptHasFocus] = useState(false);
  const [promptReferenceDismissed, setPromptReferenceDismissed] =
    useState(false);
  const [promptReferenceActiveIndex, setPromptReferenceActiveIndex] =
    useState(0);
  const [pendingGalleryStep, setPendingGalleryStep] = useState<"next" | null>(
    null,
  );
  const { sourceAssetId, setSourceAssetId, prepareSourceReplacement } =
    useStudioSourceAsset();
  const graphReturnTargetRef = useRef<{
    pathname: string;
    href: string;
  } | null>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const overlayUnlockScrollOverrideRef = useRef<number | null>(null);
  const lastComposerDebugSignatureRef = useRef<string | null>(null);
  const settleRefreshTimerRef = useRef<number | null>(null);
  const settleRefreshPendingRef = useRef(false);
  const pollJobProxyRef = useRef<(jobId: string) => Promise<void>>(
    async () => {},
  );
  const pollBatchProxyRef = useRef<(batchId: string) => Promise<void>>(
    async () => {},
  );
  const openEnhanceDialogProxyRef = useRef<() => void>(() => undefined);
  const requestEnhancementPreviewProxyRef = useRef<() => Promise<void>>(
    async () => undefined,
  );
  const applyEnhancementPromptProxyRef = useRef<() => boolean>(() => false);
  const appliedStudioHarnessFixtureRef = useRef<string | null>(null);
  const { studioPresetCatalog, enabledStudioModelChoices, modelIconByKey } =
    useStudioShellCatalog({
      models,
      presets,
      hydratedPresets: hydratedStudioPresets,
      queuePolicies,
    });
  const {
    localProjects,
    selectedProjectId,
    selectedProject,
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
        raw?: {
          available_credits?: number | null;
          remaining_credits?: number | null;
        } | null;
      };
      const balances = [
        payload.available_credits,
        payload.remaining_credits,
        payload.raw?.available_credits,
        payload.raw?.remaining_credits,
      ];
      for (const balance of balances) {
        if (typeof balance === "number") {
          setLocalRemainingCredits(balance);
          return;
        }
      }
      setLocalRemainingCredits(null);
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
    initialAssetsNextCursor,
    latestAsset,
    onMessage: (message) => {
      setFormMessage(message);
      showFloatingComposerBanner(message, 5200);
    },
  });
  const selection = useStudioSelection({
    initialSelectedAssetId,
    localAssets: gallery.state.localAssets,
    favoriteAssets: gallery.state.favoriteAssets,
    localJobs: gallery.state.localJobs,
    presets: studioPresetCatalog,
    onHydratedJob: (job) => {
      gallery.actions.setLocalJobs((current) =>
        [job, ...current.filter((entry) => entry.job_id !== job.job_id)].slice(
          0,
          24,
        ),
      );
    },
  });

  const {
    localBatches,
    localJobs,
    localAssets,
    galleryModelFilter,
    galleryKindFilter,
    favoritesOnly,
    favoriteAssets,
  } = gallery.state;
  const { activeGalleryHasMore, activeGalleryLoadingMore, galleryTiles } =
    gallery.derived;
  const visibleGalleryAssetIds = useMemo(
    () =>
      galleryTiles
        .map((tile) => tile.asset?.asset_id)
        .filter((assetId): assetId is string | number => assetId != null),
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
  const mobileAddTilePlusIconClassName = "size-5";
  const { lightboxVideoRef } = selection.refs;
  const {
    setSelectedAssetId,
    setSelectedMediaLightboxOpen,
    setMobileInspectorPromptOpen,
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
    presets: studioPresetCatalog,
    resetInspector,
    setSelectedFailedJobId,
  });
  const {
    selectedFailedJob,
    selectedAssetProject,
    selectedFailedJobPrompt,
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
    presets: studioPresetCatalog,
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
    enhancementPreviewVisual,
    compactOptionEntries,
    requestOptions,
    estimatedCredits,
    formattedRemainingCredits,
    generateButtonLabel,
    modelMaxOutputs,
    canSubmit,
    composerStatusMessage,
    seedanceFirstFrameAttachment,
    seedanceLastFrameAttachment,
    seedanceReferenceImages,
    seedanceReferenceVideos,
    seedanceReferenceAudios,
    canUseSourceAsset,
    maxImageInputs,
    maxVideoInputs,
    maxAudioInputs,
  } = composer.derived;
  const { promptInputRef } = composer.refs;
  const {
    setModelKey,
    setSelectedPresetId,
    setSelectedPromptIds,
    setPrompt,
    setPresetInputValues,
    setPresetSlotStates,
    setOptionValues,
    setEnhanceDialogOpen,
    setAttachments,
    setIsDragActive,
    setValidation,
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
  }, [
    busyState,
    composerStatusMessage,
    currentModel?.input_patterns,
    modelKey,
  ]);

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
  const { pollJob, pollBatch, dismissJob, dismissAsset, toggleAssetFavorite } =
    polling.actions;
  const {
    copyPromptStatus,
    downloadActionLabel,
    copyPromptFromAsset,
    downloadAsset,
  } = useStudioAssetActions({
    hasMounted,
    onMessage: setFormMessage,
    showActivity,
  });
  const mobileComposerExpanded = !mobileComposerCollapsed;
  const structuredPresetModelChoices = useMemo(() => {
    if (!structuredPresetActive) {
      return [];
    }
    const supportedModelKeys = new Set(
      studioPresetSupportedModels(currentPreset, models),
    );
    return models
      .filter((model) => supportedModelKeys.has(model.key))
      .map(studioComposerModelChoice);
  }, [currentPreset, models, structuredPresetActive]);
  const expandStudioComposer = useCallback(() => {
    setDesktopComposerCollapsed(false);
    setMobileComposerCollapsed((collapsed) =>
      mobileComposerCollapsedForProgrammaticExpand(
        isCoarsePointerDevice(),
        collapsed,
      ),
    );
  }, [setMobileComposerCollapsed]);

  function revealComposer(options: StudioComposerRevealOptions = {}) {
    setDesktopComposerCollapsed(false);
    setMobileComposerCollapsed((collapsed) =>
      mobileComposerCollapsedForProgrammaticExpand(
        isCoarsePointerDevice(),
        collapsed,
      ),
    );

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const composerRoot = composerShellRef.current;
        if (!composerRoot) {
          return;
        }

        revealStudioComposer(
          {
            composerRoot,
            promptInput: promptInputRef.current,
          },
          options,
        );
      });
    });
  }

  function applyEnhancementPrompt() {
    const nextPrompt =
      enhancePreview?.final_prompt_used || enhancePreview?.enhanced_prompt;
    if (!nextPrompt) {
      return false;
    }
    setDesktopComposerCollapsed(false);
    setPrompt(nextPrompt);
    setEnhanceDialogOpen(false);
    setFormMessage({
      tone: "healthy",
      text: "Loaded the enhanced prompt into the composer.",
    });
    return true;
  }
  openEnhanceDialogProxyRef.current = openEnhanceDialog;
  requestEnhancementPreviewProxyRef.current = requestEnhancementPreview;
  applyEnhancementPromptProxyRef.current = applyEnhancementPrompt;

  const openEnhancementSetup = () => {
    void router.push(enhanceSetupHref);
  };

  async function loadPresetIntoStudio(
    presetIdOrKey: string,
    presetDetail?: MediaPreset | null,
  ) {
    try {
      const hydratedPreset =
        presetDetail ?? (await fetchStudioPresetDetail(presetIdOrKey));
      setHydratedStudioPresets((current) =>
        mergeStudioPresetDetail(current, hydratedPreset),
      );
      applyPresetSelection(hydratedPreset.preset_id ?? hydratedPreset.key, {
        preferredModelKey: modelKey,
        presetOverride: hydratedPreset,
      });
    } catch (error) {
      setFormMessage({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Unable to load preset details.",
      });
      return;
    }
    overlayUnlockScrollOverrideRef.current = 0;
    setPresetBrowserOpen(false);
    setSelectedAssetId(null);
    setSelectedFailedJobId(null);
    setSelectedMediaLightboxOpen(false);
    setSelectedReferencePreview(null);
    setOpenPicker(null);
    revealComposer({ focusPresetField: true, scroll: false });
    setFormMessage({
      tone: "healthy",
      text: "Preset loaded into the composer.",
    });
  }

  useEffect(() => {
    pollJobProxyRef.current = pollJob;
    pollBatchProxyRef.current = pollBatch;
  }, [pollBatch, pollJob]);
  const composerInputRail = resolveStudioComposerInputRail({
    structuredPresetActive,
    seedanceComposer,
    standardComposerUsesExplicitSlots: standardComposerLayout.usesExplicitSlots,
    maxImageInputs,
    maxVideoInputs,
    maxAudioInputs,
  });
  const dedicatedImageReferenceRailActive = composerInputRail === "multi-image";
  const standardComposerSlots = standardComposerLayout.slots.filter(
    (slot) => slot.visible,
  );
  const standardComposerSectionTitle = standardComposerSlots.some(
    (slot) => slot.role === "driving_video",
  )
    ? "Motion inputs"
    : standardComposerSlots.some(
          (slot) => slot.role === "start_frame" || slot.role === "end_frame",
        )
      ? "Frames"
      : standardComposerSlots.length > 0
        ? "Input"
        : "Inputs";
  const {
    selectedReferencePreview,
    referenceLibraryTarget,
    referenceLibraryReturnFocus,
    setSelectedReferencePreview,
    setReferenceLibraryTarget,
    openReferencePreview,
    openContextualReferenceLibrary,
    handleReferenceLibrarySelect,
    openComposerReferenceLibrary,
    openPresetSlotReferenceLibrary,
    openStandardSlotReferenceLibrary,
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
    orderedImageInputs,
    dedicatedImageReferenceRailActive,
    setOpenPicker,
    setFormMessage,
    assignPresetSlotReference,
    addReferenceMediaAsAttachment,
    orderedImageReplacement,
  });
  const studioHarnessFixtures = useMemo<StudioTestFixtureControls>(() => {
    const closeStudioOverlays = () => {
      setSelectedFailedJobId(null);
      setSelectedAssetId(null);
      setSelectedMediaLightboxOpen(false);
      setSelectedReferencePreview(null);
      setReferenceLibraryTarget(null);
      setReferencesExpanded(false);
      setPresetBrowserOpen(false);
      setProjectBrowserOpen(false);
    };
    const prepareComposerFixture = () => {
      closeStudioOverlays();
      setDesktopComposerCollapsed(false);
      setMobileComposerCollapsed(false);
      setSelectedPresetId("");
      setSelectedPromptIds([]);
      setPresetInputValues({});
      setPresetSlotStates({});
      setOptionValues({});
      setValidation(null);
      setOpenPicker(null);
      setPromptReferenceDismissed(false);
      setPromptHasFocus(false);
      setPromptCursorIndex(null);
      setStudioHarnessFixtureState(null);
    };
    const findMultiImageModel = () =>
      models.find(
        (model) =>
          model.studio_exposed !== false &&
          !model.key.startsWith("seedance") &&
          modelInputLimit(model, "image_inputs") > 1 &&
          modelInputLimit(model, "video_inputs") === 0 &&
          modelInputLimit(model, "audio_inputs") === 0,
      );
    const findSeedanceModel = () =>
      models.find(
        (model) =>
          model.studio_exposed !== false &&
          model.key.startsWith("seedance-2.0"),
      );
    const findStandardModel = () =>
      models.find(
        (model) =>
          model.studio_exposed !== false &&
          modelInputLimit(model, "image_inputs") > 0 &&
          modelInputLimit(model, "image_inputs") <= 2 &&
          modelInputLimit(model, "video_inputs") === 0 &&
          modelInputLimit(model, "audio_inputs") === 0 &&
          !model.key.startsWith("seedance"),
      );
    const findMotionControlModel = (preferredKey = "kling-3.0-motion") =>
      models.find(
        (model) => model.studio_exposed !== false && model.key === preferredKey,
      ) ??
      models.find(
        (model) =>
          model.studio_exposed !== false &&
          (model.input_patterns ?? []).includes("motion_control"),
      );

    return {
      reset: () => {
        setStudioHarnessFixtureState(null);
        setPromptHasFocus(false);
        setPromptCursorIndex(null);
        setPromptReferenceDismissed(false);
        clearComposer();
        closeStudioOverlays();
        setDesktopComposerCollapsed(false);
        setMobileComposerCollapsed((collapsed) =>
          mobileComposerCollapsedForProgrammaticExpand(
            isCoarsePointerDevice(),
            collapsed,
          ),
        );
      },
      mountPromptReferencePicker: () => {
        const targetModel = findMultiImageModel();
        if (!targetModel) {
          return {
            ok: false,
            reason: "No non-Seedance multi-image Studio model is available.",
          };
        }
        prepareComposerFixture();
        clearSourceAsset();
        setModelKey(targetModel.key);
        setAttachments([
          buildStudioHarnessAttachment(1, "images"),
          buildStudioHarnessAttachment(2, "images"),
        ]);
        const nextPrompt = "Blend this concept with @image";
        setPrompt(nextPrompt);
        setPromptCursorIndex(nextPrompt.length);
        setPromptHasFocus(true);
        return { ok: true };
      },
      mountComposerEnhanceSetup: () => {
        prepareComposerFixture();
        setPrompt("Enhance this neon observatory scene.");
        setStudioHarnessFixtureState({ composerEnhanceMode: "setup" });
        return { ok: true };
      },
      mountComposerEnhanceDisabled: () => {
        prepareComposerFixture();
        setPrompt("Enhance this glass castle portrait.");
        setStudioHarnessFixtureState({ composerEnhanceMode: "disabled" });
        return { ok: true };
      },
      mountContextPanels: () => {
        closeStudioOverlays();
        setStudioHarnessFixtureState({ contextPanels: true });
        setLocalJobs([
          {
            job_id: "studio-fixture-job-1",
            model_key: currentModel?.key ?? modelKey,
            status: "completed",
            raw_prompt:
              "Fixture job used only to mount Studio context panel chrome.",
            created_at: "2026-06-18T00:00:00.000Z",
            provider_task_id: "local-fixture",
          } as MediaJob,
        ]);
        if (prompts[0]?.prompt_id) {
          setSelectedPromptIds([prompts[0].prompt_id]);
        }
        setValidation({
          state: "ready",
          resolved_system_prompt: {
            rendered_system_prompt:
              "Fixture preflight text for context-panel visual verification.",
          },
        } as MediaValidationResponse);
        return { ok: true };
      },
      mountGalleryEmptyState: () => {
        closeStudioOverlays();
        setStudioHarnessFixtureState({ galleryEmpty: true });
        setLocalAssets([]);
        setLocalJobs([]);
        gallery.actions.setLocalBatches([]);
        setOptimisticBatches([]);
        activateGalleryKindFilter("all");
        setGalleryModelFilter("all");
        return { ok: true };
      },
      mountMotionControlVideo: (preferredKey = "kling-3.0-motion") => {
        const targetModel = findMotionControlModel(preferredKey);
        if (!targetModel) {
          return {
            ok: false,
            reason: "No motion-control Studio model is available.",
          };
        }
        prepareComposerFixture();
        setModelKey(targetModel.key);
        setAttachments([
          buildStudioHarnessAttachment(1, "images"),
          buildStudioHarnessMotionVideoAttachment(),
        ]);
        setOptionValues({ character_orientation: "image", mode: "720p" });
        setOutputCount(1);
        setPrompt(
          "Motion-control fixture with a 20.083333 second driving video.",
        );
        return { ok: true };
      },
      mountMobileInputs: (mode = "multi-image") => {
        prepareComposerFixture();
        if (mode === "seedance") {
          const targetModel = findSeedanceModel();
          if (!targetModel) {
            return {
              ok: false,
              reason: "No Seedance Studio model is available.",
            };
          }
          setModelKey(targetModel.key);
          setAttachments([
            buildStudioHarnessAttachment(1, "images", "first_frame"),
            buildStudioHarnessAttachment(2, "images", "reference"),
            buildStudioHarnessAttachment(3, "videos", "reference"),
            buildStudioHarnessAttachment(4, "audios", "reference"),
          ]);
          setPrompt("Seedance fixture using @image1 @video1 @audio1.");
          return { ok: true };
        }
        if (mode === "standard") {
          const targetModel = findStandardModel();
          if (!targetModel) {
            return {
              ok: false,
              reason: "No standard image-input Studio model is available.",
            };
          }
          setModelKey(targetModel.key);
          setAttachments([]);
          setPrompt("Standard input fixture.");
          return { ok: true };
        }
        const targetModel = findMultiImageModel();
        if (!targetModel) {
          return {
            ok: false,
            reason: "No multi-image Studio model is available.",
          };
        }
        setModelKey(targetModel.key);
        setAttachments([
          buildStudioHarnessAttachment(1, "images"),
          buildStudioHarnessAttachment(2, "images"),
        ]);
        setPrompt("Multi-image mobile fixture.");
        return { ok: true };
      },
    };
  }, [
    activateGalleryKindFilter,
    clearComposer,
    clearSourceAsset,
    currentModel?.key,
    gallery.actions,
    modelKey,
    models,
    prompts,
    setAttachments,
    setGalleryModelFilter,
    setLocalAssets,
    setLocalJobs,
    setMobileComposerCollapsed,
    setModelKey,
    setOpenPicker,
    setOptimisticBatches,
    setOptionValues,
    setOutputCount,
    setPresetInputValues,
    setPresetSlotStates,
    setPrompt,
    setSelectedAssetId,
    setSelectedFailedJobId,
    setSelectedMediaLightboxOpen,
    setSelectedPresetId,
    setSelectedPromptIds,
    setValidation,
    setReferenceLibraryTarget,
    setSelectedReferencePreview,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const hostname = window.location.hostname;
    const localHost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    if (!localHost) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("studioTestHarness") !== "1") {
      return;
    }
    const fixtureKey = params.get("studioFixture");
    if (!fixtureKey || appliedStudioHarnessFixtureRef.current === fixtureKey) {
      return;
    }
    appliedStudioHarnessFixtureRef.current = fixtureKey;
    window.requestAnimationFrame(() => {
      if (fixtureKey === "prompt-reference") {
        studioHarnessFixtures.mountPromptReferencePicker();
        return;
      }
      if (fixtureKey === "enhance-setup") {
        studioHarnessFixtures.mountComposerEnhanceSetup();
        return;
      }
      if (fixtureKey === "enhance-disabled") {
        studioHarnessFixtures.mountComposerEnhanceDisabled();
        return;
      }
      if (fixtureKey === "context-panels") {
        studioHarnessFixtures.mountContextPanels();
        return;
      }
      if (fixtureKey === "gallery-empty") {
        studioHarnessFixtures.mountGalleryEmptyState();
        return;
      }
      if (fixtureKey === "motion-control-video") {
        studioHarnessFixtures.mountMotionControlVideo();
        return;
      }
      if (fixtureKey === "motion-control-video-2-6") {
        studioHarnessFixtures.mountMotionControlVideo("kling-2.6-motion");
        return;
      }
      if (fixtureKey === "reference-library") {
        setReferenceLibraryTarget({
          type: "browse",
          title: "Reference Library fixture",
        });
        return;
      }
      if (fixtureKey === "mobile-seedance") {
        studioHarnessFixtures.mountMobileInputs("seedance");
        return;
      }
      if (fixtureKey === "mobile-standard") {
        studioHarnessFixtures.mountMobileInputs("standard");
        return;
      }
      if (fixtureKey === "mobile-inputs") {
        studioHarnessFixtures.mountMobileInputs("multi-image");
      }
    });
  }, [setReferenceLibraryTarget, studioHarnessFixtures]);
  const studioHandoffSnapshot = useStudioShellHandoffSnapshot({
    projectId: selectedProjectId,
    assetIds: localAssets.map((asset) => asset.asset_id),
    selectedAssetId,
    modelKey,
    selectedPresetId,
    prompt,
    attachmentCount: attachments.length,
    openPicker,
    kindFilter: galleryKindFilter,
    modelFilter: galleryModelFilter,
    favoritesOnly,
    hasMore: activeGalleryHasMore,
    loadingMore: activeGalleryLoadingMore,
    tileCount: galleryTiles.length,
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
    handoffSnapshot: studioHandoffSnapshot,
    fixtures: studioHarnessFixtures,
  });
  const promptReferenceMention =
    dedicatedImageReferenceRailActive && promptHasFocus
      ? detectPromptReferenceMention(
          prompt,
          promptCursorIndex ??
            promptInputRef.current?.selectionStart ??
            prompt.length,
        )
      : null;
  const promptReferenceChoices = useMemo(() => {
    if (!dedicatedImageReferenceRailActive) {
      return [];
    }
    const normalizedQuery = (promptReferenceMention?.query ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return orderedImageInputs
      .map((slot, index) => {
        const label = `Image reference ${index + 1}`;
        const preview = orderedImageInputPreview(
          slot,
          label,
          `prompt-reference-${index + 1}`,
        );
        return {
          id: `image-reference-${index + 1}`,
          label,
          token: `[image reference ${index + 1}]`,
          search: `${label.toLowerCase()} ref ${index + 1} image ${index + 1}`,
          preview,
          visualUrl:
            orderedImageInputVisual(slot) ??
            preview?.posterUrl ??
            preview?.url ??
            null,
        };
      })
      .filter(
        (choice) => !normalizedQuery || choice.search.includes(normalizedQuery),
      );
  }, [
    dedicatedImageReferenceRailActive,
    orderedImageInputs,
    promptReferenceMention?.query,
  ]);
  const promptReferencePickerOpen = Boolean(
    promptReferenceMention &&
    promptReferenceChoices.length > 0 &&
    !promptReferenceDismissed,
  );

  useEffect(() => {
    setPromptReferenceActiveIndex(0);
    setPromptReferenceDismissed(false);
  }, [
    promptReferenceMention?.start,
    promptReferenceMention?.query,
    promptReferenceChoices.length,
  ]);

  function syncPromptCursorIndex(target: HTMLTextAreaElement | null) {
    if (!target) {
      return;
    }
    setPromptCursorIndex(target.selectionStart ?? target.value.length);
  }

  function applyPromptReferenceChoice(
    choice: (typeof promptReferenceChoices)[number] | null,
  ) {
    if (!choice || !promptReferenceMention) {
      return;
    }
    const nextPromptState = applyPromptReferenceMention(
      prompt,
      promptReferenceMention,
      choice.token,
    );
    expandStudioComposer();
    setPrompt(nextPromptState.prompt);
    setPromptCursorIndex(nextPromptState.caretIndex);
    window.requestAnimationFrame(() => {
      const input = promptInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.setSelectionRange(
        nextPromptState.caretIndex,
        nextPromptState.caretIndex,
      );
    });
  }

  const referenceManagerProps = {
    modelLabel: currentModel?.label ?? "Selected model",
    expanded: referencesExpanded,
    suspended: Boolean(selectedReferencePreview || referenceLibraryTarget),
    onExpandedChange: setReferencesExpanded,
    isDragActive,
    onSetDragActive: setIsDragActive,
    onOpenPreview: openReferencePreview,
    feedback: formMessage,
  };
  const multiImageReferenceStrip = dedicatedImageReferenceRailActive ? (
    <StudioMultiImageReferenceStrip
      {...referenceManagerProps}
      imageLimit={maxImageInputs}
      onOpenLibrary={(returnFocusTo, replacement) =>
        openComposerReferenceLibrary(
          "images",
          "reference",
          returnFocusTo,
          replacement && orderedImageReplacement(replacement),
        )
      }
      orderedImageInputs={orderedImageInputs}
      buildOrderedImageInputPreview={orderedImageInputPreview}
      onClearOrderedImageInput={clearOrderedImageInput}
      onDropIntoSlot={(event, slotIndex) =>
        void handleSourceTileDrop(event, slotIndex)
      }
      onAddImageFilesToOrderedSlot={addImageFilesToOrderedSlot}
      onReplaceImageFile={replaceOrderedImageFile}
    />
  ) : null;
  const motionControlVideoAsset =
    currentSourceAsset?.generation_kind === "video" ? currentSourceAsset : null;
  const motionControlVideoAttachment = motionControlVideoAsset
    ? null
    : (attachments.find((attachment) => attachment.kind === "videos") ?? null);
  const motionControlVideoVisual = motionControlVideoAsset
    ? (mediaThumbnailUrl(motionControlVideoAsset) ??
      mediaDisplayUrl(motionControlVideoAsset))
    : (motionControlVideoAttachment?.previewUrl ??
      motionControlVideoAttachment?.referenceRecord?.thumb_url ??
      motionControlVideoAttachment?.referenceRecord?.stored_url ??
      null);

  function drivingVideoReplacement() {
    return motionControlVideoAsset
      ? {
          claimSourceAsset: prepareSourceReplacement(
            motionControlVideoAsset.asset_id,
            clearSourceAsset,
          ),
        }
      : { replaceAttachmentId: motionControlVideoAttachment?.id };
  }

  function standardComposerSlotPreview(
    slot: StudioComposerSlot,
    previewKey: string,
  ) {
    if (slot.kind === "image") {
      return orderedImageInputPreview(
        orderedImageInputs[slot.slotIndex] ?? null,
        slot.label,
        previewKey,
      );
    }
    if (slot.role === "driving_video") {
      return motionControlVideoAsset
        ? buildAssetReferencePreview(motionControlVideoAsset, slot.label)
        : buildAttachmentPreview(
            motionControlVideoAttachment,
            slot.label,
            previewKey,
          );
    }
    return null;
  }

  function standardComposerSlotVisual(slot: StudioComposerSlot) {
    if (slot.kind === "image") {
      return orderedImageInputVisual(
        orderedImageInputs[slot.slotIndex] ?? null,
      );
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
      const currentSlot = orderedImageInputs[slot.slotIndex];
      if (replaceFilled && currentSlot) {
        replaceOrderedImageFile(fileList, currentSlot, input ?? null);
      } else {
        addImageFilesToOrderedSlot(fileList, slot.slotIndex, input);
      }
      return;
    }
    if (slot.role === "driving_video") {
      addFiles(fileList, {
        allowedKinds: ["videos"],
        ...(replaceFilled ? drivingVideoReplacement() : {}),
      }).catch(reportActionError);
      resetFileInputValue(input ?? null);
    }
  }

  const standardSlotRailProps: StudioStandardSlotRailProps = {
    slots: standardComposerSlots,
    isDragActive,
    buildPreview: standardComposerSlotPreview,
    resolveVisualUrl: standardComposerSlotVisual,
    isAssetBackedImageSlot: (slot) =>
      slot.kind === "image" &&
      orderedImageInputs[slot.slotIndex]?.source === "asset",
    onSetDragActive: setIsDragActive,
    onSlotDrop: (event, slot) =>
      handleSourceTileDrop(event, slot.slotIndex, slot),
    onOpenPreview: openReferencePreview,
    onOpenSlotLibrary: (slot, trigger) =>
      slot.kind === "video"
        ? openComposerReferenceLibrary(
            "videos",
            null,
            trigger,
            drivingVideoReplacement(),
          )
        : openStandardSlotReferenceLibrary(slot, trigger),
    onClearSlot: clearStandardComposerSlot,
    onPickFiles: addFilesToStandardComposerSlot,
  };

  const stageComposerFiles: StudioAddFilesHandler = (files, options) => {
    addFiles(files, options).catch(reportActionError);
  };
  const composerMediaInteractionProps = {
    isDragActive,
    seedanceFirstFrameAttachment,
    seedanceLastFrameAttachment,
    buildAttachmentPreview,
    standardSlotRailProps,
    onDropIntoSourceSlot: handleSourceTileDrop,
    onSetDragActive: setIsDragActive,
    onSetFormWarning: (text: string) =>
      setFormMessage({ tone: "warning", text }),
    onOpenPreview: openReferencePreview,
    onRemoveAttachment: removeAttachment,
    onAddFiles: stageComposerFiles,
    onResetFileInput: resetFileInputValue,
  };

  const sourceAttachmentStrip =
    composerInputRail === "seedance" || composerInputRail === "standard" ? (
      <StudioSourceAttachmentStrip
        inputRail={composerInputRail}
        {...composerMediaInteractionProps}
        onOpenFrameLibrary={(role, returnFocusTo, replacement) =>
          openComposerReferenceLibrary(
            "images",
            role,
            returnFocusTo,
            replacement,
          )
        }
      />
    ) : null;
  const seedanceReferenceStrip =
    composerInputRail === "seedance" ? (
      <StudioSeedanceReferenceStrip
        {...referenceManagerProps}
        referenceImages={seedanceReferenceImages}
        referenceVideos={seedanceReferenceVideos}
        referenceAudios={seedanceReferenceAudios}
        maxImageReferences={maxImageInputs}
        maxVideoReferences={maxVideoInputs}
        maxAudioReferences={maxAudioInputs}
        buildAttachmentPreview={buildAttachmentPreview}
        onReferenceDrop={handleSeedanceReferenceDrop}
        onOpenLibrary={openComposerReferenceLibrary}
        onRemoveAttachment={removeAttachment}
        onAddFiles={stageComposerFiles}
        onResetFileInput={resetFileInputValue}
      />
    ) : null;
  const referenceInputs = multiImageReferenceStrip ?? seedanceReferenceStrip;
  const mobileInputsSection =
    !structuredPresetActive && !dedicatedImageReferenceRailActive ? (
      <StudioMobileInputsContent
        inputRail={composerInputRail}
        effectiveSeedanceMode={effectiveSeedanceMode}
        standardComposerSectionTitle={standardComposerSectionTitle}
        standardComposerSummaryLabel={standardComposerLayout.summaryLabel}
        mobileAddTilePlusIconClassName={mobileAddTilePlusIconClassName}
        {...composerMediaInteractionProps}
      />
    ) : null;

  const composerInputs = useSeedanceComposerInputs({
    seedance: seedanceComposer,
    effectiveMode: effectiveSeedanceMode,
    referenceInputs,
    sourceAttachmentStrip,
    mobileInputsContent: mobileInputsSection,
  });

  useEffect(() => {
    setHasMounted(true);
    setDesktopComposerCollapsed(
      window.localStorage.getItem(STUDIO_COMPOSER_COLLAPSED_STORAGE_KEY) ===
        "1",
    );
  }, []);

  useEffect(() => {
    if (!hasMounted) {
      return;
    }
    window.localStorage.setItem(
      STUDIO_COMPOSER_COLLAPSED_STORAGE_KEY,
      desktopComposerCollapsed ? "1" : "0",
    );
  }, [desktopComposerCollapsed, hasMounted]);

  useEffect(() => {
    setOutputCount((current) =>
      Math.min(Math.max(1, current), modelMaxOutputs),
    );
  }, [modelMaxOutputs, setOutputCount]);

  const lockingOverlayOpen =
    Boolean(selectedAssetId) ||
    studioSettingsOpen ||
    presetBrowserOpen ||
    (Boolean(referenceInputs) && referencesExpanded) ||
    selectedMediaLightboxOpen ||
    Boolean(selectedReferencePreview) ||
    Boolean(referenceLibraryTarget);

  const isTypingTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tagName = target.tagName.toLowerCase();
    return (
      target.isContentEditable ||
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select"
    );
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
    const previousHtmlOverscroll =
      document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      const restoreScrollY = overlayUnlockScrollOverrideRef.current ?? scrollY;
      overlayUnlockScrollOverrideRef.current = null;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior =
        previousHtmlOverscroll;
      window.scrollTo(0, restoreScrollY);
    };
  }, [lockingOverlayOpen]);

  const selectedGalleryIndex = visibleGalleryAssetIds.findIndex(
    (assetId) =>
      selectedAsset !== null &&
      String(assetId) === String(selectedAsset.asset_id),
  );
  const hasNextGalleryPage =
    activeGalleryHasMore &&
    selectedGalleryIndex === visibleGalleryAssetIds.length - 1;
  const navigateSelectedGalleryAsset = useCallback(
    (direction: 1 | -1) => {
      const galleryLength = visibleGalleryAssetIds.length;
      if (selectedGalleryIndex < 0 || galleryLength < 2) {
        return false;
      }
      if (direction === 1 && hasNextGalleryPage) {
        if (!activeGalleryLoadingMore && pendingGalleryStep == null) {
          setPendingGalleryStep("next");
          loadMoreActiveGalleryAssets().catch(reportActionError);
        }
        return true;
      }
      const nextIndex =
        (selectedGalleryIndex + direction + galleryLength) % galleryLength;
      const nextAssetId = visibleGalleryAssetIds[nextIndex];
      if (
        String(nextAssetId) ===
        String(visibleGalleryAssetIds[selectedGalleryIndex])
      ) {
        return false;
      }
      setSelectedFailedJobId(null);
      setSelectedAssetId(nextAssetId);
      return true;
    },
    [
      activeGalleryLoadingMore,
      hasNextGalleryPage,
      loadMoreActiveGalleryAssets,
      pendingGalleryStep,
      selectedGalleryIndex,
      setSelectedAssetId,
      visibleGalleryAssetIds,
    ],
  );

  useEffect(() => {
    if (selectedGalleryIndex < 0) {
      setPendingGalleryStep(null);
      return;
    }
    if (pendingGalleryStep === "next") {
      const nextAssetId = visibleGalleryAssetIds[selectedGalleryIndex + 1];
      if (nextAssetId != null) {
        setPendingGalleryStep(null);
        setSelectedFailedJobId(null);
        setSelectedAssetId(nextAssetId);
      } else if (!activeGalleryHasMore && !activeGalleryLoadingMore) {
        setPendingGalleryStep(null);
      }
      return;
    }
    if (visibleGalleryAssetIds.length < 2) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        [
          event.defaultPrevented,
          event.altKey,
          event.ctrlKey,
          event.metaKey,
          event.shiftKey,
        ].includes(true)
      ) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (navigateSelectedGalleryAsset(event.key === "ArrowRight" ? 1 : -1)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeGalleryHasMore,
    activeGalleryLoadingMore,
    isTypingTarget,
    navigateSelectedGalleryAsset,
    pendingGalleryStep,
    selectedGalleryIndex,
    setSelectedAssetId,
    visibleGalleryAssetIds,
  ]);

  const openGraphStudio = useCallback(() => {
    void router.push(
      graphReturnTargetRef.current?.href ?? buildGraphStudioHref(),
    );
  }, [router]);

  useEffect(() => {
    if (graphReturnTargetRef.current?.pathname !== pathname) {
      const params = new URLSearchParams(window.location.search);
      graphReturnTargetRef.current = {
        pathname,
        href: buildGraphStudioHref(params.get("graphTab")),
      };
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        [
          event.defaultPrevented,
          event.altKey,
          event.ctrlKey,
          event.metaKey,
          event.shiftKey,
        ].includes(true)
      ) {
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
        openGraphStudio();
        return;
      }
      if (action === "open-projects") {
        event.preventDefault();
        setOpenPicker(null);
        setProjectBrowserOpen(true);
        return;
      }
      if (action === "open-presets") {
        event.preventDefault();
        setOpenPicker(null);
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
    pathname,
    openGraphStudio,
    openContextualReferenceLibrary,
    router,
    selectedProjectId,
    setOpenPicker,
  ]);

  function handleSourceTileDrop(
    event: React.DragEvent<HTMLElement>,
    slotIndex = 0,
    standardSlot?: StudioComposerSlot | null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    const galleryAssetId = event.dataTransfer.getData(
      "application/x-bumblebee-media-asset-id",
    );
    const asset = findMediaAssetById(
      galleryAssetId || null,
      localAssets,
      favoriteAssets,
    );
    if (galleryAssetId && !asset) {
      setFormMessage({
        tone: "danger",
        text: "The dragged gallery asset could not be found.",
      });
      return;
    }
    const filledReference = dedicatedImageReferenceRailActive
      ? orderedImageInputs[slotIndex]
      : undefined;
    if (standardSlot) {
      if (asset) {
        if (standardSlot.kind === "image") {
          if (asset.generation_kind !== "image") {
            setFormMessage({
              tone: "danger",
              text: `${standardSlot.label} only accepts image assets.`,
            });
            return;
          }
          if (slotIndex > orderedImageInputs.length) {
            setFormMessage({
              tone: "warning",
              text: "Fill the earlier image slot first.",
            });
            return;
          }
          const currentSlot = orderedImageInputs[slotIndex];
          if (slotIndex === 0) {
            if (currentSlot && currentSlot.source !== "asset") {
              clearOrderedImageInput(currentSlot);
            }
            stageAssetAsSource(asset, false);
            return;
          }
          addGalleryAssetAsAttachment(
            asset,
            null,
            ["images"],
            currentSlot
              ? orderedImageReplacement(currentSlot)
              : { insertImageIndex: slotIndex },
          ).catch(reportActionError);
          return;
        }
        if (asset.generation_kind !== "video") {
          setFormMessage({
            tone: "danger",
            text: `${standardSlot.label} only accepts video assets.`,
          });
          return;
        }
        addGalleryAssetAsAttachment(
          asset,
          null,
          ["videos"],
          drivingVideoReplacement(),
        ).catch(reportActionError);
        return;
      }
      addFilesToStandardComposerSlot(
        standardSlot,
        event.dataTransfer.files,
        null,
        true,
      );
      return;
    }
    if (seedanceComposer && slotIndex > 0 && !seedanceFirstFrameAttachment) {
      setFormMessage({
        tone: "warning",
        text: "Add a start frame before the end frame.",
      });
      return;
    }
    const seedanceFrameRole = slotIndex === 0 ? "first_frame" : "last_frame";
    const seedanceFrame =
      slotIndex === 0
        ? seedanceFirstFrameAttachment
        : seedanceLastFrameAttachment;
    if (asset) {
      if (asset.generation_kind !== "image") {
        setFormMessage({
          tone: "danger",
          text: "Only image cards can be staged as source media.",
        });
        return;
      }
      if (slotIndex > orderedImageInputs.length) {
        setFormMessage({
          tone: "warning",
          text: "Fill the earlier image slot first.",
        });
        return;
      }
      if (seedanceComposer) {
        addGalleryAssetAsAttachment(asset, seedanceFrameRole, ["images"], {
          replaceAttachmentId: seedanceFrame?.id,
        }).catch(reportActionError);
        return;
      }
      if (filledReference) {
        addGalleryAssetAsAttachment(
          asset,
          null,
          ["images"],
          orderedImageReplacement(filledReference),
        ).catch(reportActionError);
        return;
      }
      if (slotIndex === 0) {
        stageAssetAsSource(asset, false);
        return;
      }
      addGalleryAssetAsAttachment(asset).catch(reportActionError);
      return;
    }
    if (seedanceComposer) {
      addFiles(event.dataTransfer.files, {
        role: seedanceFrameRole,
        allowedKinds: ["images"],
        replaceAttachmentId: seedanceFrame?.id,
      }).catch(reportActionError);
      return;
    }
    if (
      (dedicatedImageReferenceRailActive || explicitVideoImageSlots) &&
      slotIndex > orderedImageInputs.length
    ) {
      setFormMessage({
        tone: "warning",
        text: "Fill the earlier image slot first.",
      });
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
    if (filledReference) {
      void addFiles(Array.from(event.dataTransfer.files).slice(0, 1), {
        allowedKinds: ["images"],
        ...orderedImageReplacement(filledReference),
      }).catch(reportActionError);
      return;
    }
    addFiles(
      event.dataTransfer.files,
      dedicatedImageReferenceRailActive
        ? { allowedKinds: ["images"], insertImageIndex: slotIndex }
        : undefined,
    ).catch(reportActionError);
  }

  function handleSeedanceReferenceDrop(
    event: React.DragEvent<HTMLElement>,
    allowedKind: "images" | "videos" | "audios",
  ) {
    event.preventDefault();
    setIsDragActive(false);
    const galleryAssetId = event.dataTransfer.getData(
      "application/x-bumblebee-media-asset-id",
    );
    if (galleryAssetId) {
      const asset =
        findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      if (!asset) {
        setFormMessage({
          tone: "danger",
          text: "The dragged gallery asset could not be found.",
        });
        return;
      }
      addGalleryAssetAsAttachment(asset, "reference", [allowedKind]).catch(
        reportActionError,
      );
      return;
    }
    addFiles(event.dataTransfer.files, {
      role: "reference",
      allowedKinds: [allowedKind],
    }).catch(reportActionError);
  }

  function handlePresetSlotDrop(
    event: React.DragEvent<HTMLElement>,
    slotKey: string,
  ) {
    event.preventDefault();
    expandStudioComposer();
    const galleryAssetId = event.dataTransfer.getData(
      "application/x-bumblebee-media-asset-id",
    );
    if (galleryAssetId) {
      const asset =
        findMediaAssetById(galleryAssetId, localAssets, favoriteAssets) ?? null;
      assignPresetSlotAsset(slotKey, asset);
      return;
    }
    const droppedFile =
      Array.from(event.dataTransfer.files).find((file) =>
        file.type.startsWith("image/"),
      ) ?? null;
    assignPresetSlotFile(slotKey, droppedFile);
  }

  function handleGalleryAssetDragStart(
    event: React.DragEvent<HTMLDivElement>,
    asset: MediaAsset | null,
  ) {
    if (!asset) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(
      "application/x-bumblebee-media-asset-id",
      String(asset.asset_id),
    );
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
    if (
      !animate &&
      !seedanceComposer &&
      !structuredPresetActive &&
      !canUseSourceAsset &&
      !explicitVideoImageSlots &&
      !dedicatedImageReferenceRailActive
    ) {
      setFormMessage({
        tone: "warning",
        text: "The selected model is text-to-video only, so Studio is hiding source image inputs.",
      });
      return;
    }
    setDesktopComposerCollapsed(false);
    if (animate && asset.generation_kind === "image") {
      const animateTargetModel = resolveImageToVideoAnimationModel(
        models,
        currentModel,
      );
      if (!animateTargetModel) {
        setFormMessage({
          tone: "warning",
          text: "No image-to-video model is available for this image.",
        });
        return;
      }
      stageSourceAsset(asset);
      if (animateTargetModel.key !== modelKey) {
        setModelKey(animateTargetModel.key);
      }
      closeAssetInspector();
      setMobileComposerCollapsed(!isCoarsePointerDevice());
      setFormMessage({
        tone: "warning",
        text: "The selected image is now staged for the animate flow.",
      });
      return;
    }
    if (explicitMotionControlSlots) {
      stageSourceAsset(asset);
      closeAssetInspector();
      setMobileComposerCollapsed(!isCoarsePointerDevice());
      setFormMessage({
        tone: "warning",
        text: "The selected asset is now staged as the source image.",
      });
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
    if (
      structuredPresetActive &&
      !animate &&
      asset.generation_kind === "image" &&
      structuredPresetImageSlots.length
    ) {
      const nextSlot =
        structuredPresetImageSlots.find((slot) => {
          const slotState = presetSlotStates[slot.key];
          return !slotState?.assetId && !slotState?.file;
        }) ?? structuredPresetImageSlots[0];
      assignPresetSlotAsset(nextSlot.key, asset);
      closeAssetInspector();
      setFormMessage({
        tone: "warning",
        text: `${asset.prompt_summary ? "Image" : "Selected asset"} assigned to ${nextSlot.label}.`,
      });
      return;
    }
    // Keep the gallery asset in ordered slot zero so subsequent image attachments
    // are staged after it without duplicating the source.
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
  ) {
    if (slotIndex > orderedImageInputs.length) {
      setFormMessage({
        tone: "warning",
        text: "Fill the earlier image slot first.",
      });
      resetFileInputValue(input ?? null);
      return;
    }
    expandStudioComposer();
    addFiles(fileList, {
      allowedKinds: ["images"],
      insertImageIndex: slotIndex,
    }).catch(reportActionError);
    resetFileInputValue(input ?? null);
  }

  function replaceOrderedImageFile(
    files: FileList | File[] | null,
    slot: (typeof orderedImageInputs)[number],
    input: HTMLInputElement | null,
  ) {
    expandStudioComposer();
    addFiles(files, {
      allowedKinds: ["images"],
      ...orderedImageReplacement(slot),
    }).catch(reportActionError);
    resetFileInputValue(input);
  }

  function orderedImageReplacement(slot: (typeof orderedImageInputs)[number]) {
    return slot.source === "asset"
      ? {
          claimSourceAsset: prepareSourceReplacement(
            slot.asset.asset_id,
            clearSourceAsset,
          ),
        }
      : {
          replaceAttachmentId:
            slot.source === "reference"
              ? slot.attachmentId
              : slot.attachment.id,
        };
  }

  function clearOrderedImageInput(
    slot: (typeof orderedImageInputs)[number] | null,
  ) {
    if (!slot) {
      return;
    }
    expandStudioComposer();
    if (slot.source === "asset") {
      clearSourceAsset();
      return;
    }
    if (slot.source === "reference") {
      const match = attachments.find(
        (attachment) => attachment.id === slot.attachmentId,
      );
      if (match) {
        removeAttachment(match.id);
      }
      return;
    }
    removeAttachment(slot.attachment.id);
  }

  const { retryFailedJobInStudio, reviseSelectedAssetInStudio } =
    useStudioRestoreCoordination({
      inspector,
      composer,
      selectedAssetJob,
      models,
      presets: studioPresetCatalog,
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

  const renderedGalleryTiles = studioHarnessFixtureState?.galleryEmpty
    ? []
    : galleryTiles;
  const renderedGalleryHasMore = studioHarnessFixtureState?.galleryEmpty
    ? false
    : activeGalleryHasMore;
  const renderedGalleryLoadingMore = studioHarnessFixtureState?.galleryEmpty
    ? false
    : activeGalleryLoadingMore;

  const stageAssetAsSource = useAssetAsSource;

  function reportActionError(error: unknown) {
    setFormMessage({
      tone: "danger",
      text:
        error instanceof Error
          ? error.message
          : "Studio could not complete this action.",
    });
  }

  const modelPickerLeadsComposer = immersive && !structuredPresetActive;
  const modelPicker = (
    <StudioComposerModelPicker
      model={currentModel}
      modelKey={modelKey}
      modelIcons={modelIconByKey}
      choices={enabledStudioModelChoices}
      presetModelChoices={structuredPresetModelChoices}
      structuredPresetActive={structuredPresetActive}
      leading={modelPickerLeadsComposer}
      open={openPicker === "model"}
      onOpenChange={(open) => {
        if (open) expandStudioComposer();
        setOpenPicker(open ? "model" : null);
      }}
      onSelect={(value) => {
        expandStudioComposer();
        setModelKey(value);
        if (!structuredPresetActive) {
          setSelectedPresetId("");
          setSelectedPromptIds([]);
          setPresetInputValues({});
          setPresetSlotStates({});
        }
        setValidation(null);
      }}
    />
  );
  const outputPicker = (
    <StudioComposerOutputPicker
      entries={compactOptionEntries}
      value={requestOptions.output_format}
      stillFormat={optionValues.studio_still_format}
      onSelect={(format) => {
        expandStudioComposer();
        setOpenPicker(null);
        updateOption("output_format", format);
      }}
    />
  );
  const modelAndOutput = <>{modelPicker}{outputPicker}</>;
  const [leadingModelPicker, inlineModelPicker] = modelPickerLeadsComposer
    ? [modelAndOutput, null]
    : [null, modelAndOutput];

  const composerPresetPicker = (
    <StudioComposerPresetPicker
      modelKey={modelKey}
      modelPresets={modelPresets}
      selectedPresetId={selectedPresetId}
      structuredPresetActive={structuredPresetActive}
      inBrowser={immersive}
      open={openPicker === "preset"}
      onOpenChange={(open) => {
        if (open) expandStudioComposer();
        setOpenPicker(open ? "preset" : null);
      }}
      onSelect={(value, options) => {
        expandStudioComposer();
        applyPresetSelection(value, options);
        if (immersive) setPresetBrowserOpen(false);
      }}
    />
  );

  const renderStudioHeader = (actions?: ReactNode) => (
    <StudioHeaderChrome
      immersive={immersive}
      placement={actions ? "browser" : "fixed"}
      actions={actions}
      libraryTriggerRef={actions ? undefined : studioLibraryTriggerRef}
      apiHealthy={apiHealthy}
      galleryModelFilter={galleryModelFilter}
      models={models}
      favoritesOnly={favoritesOnly}
      galleryKindFilter={galleryKindFilter}
      project={selectedProject}
      remainingCredits={localRemainingCredits}
      onOpenProjectWorkspace={(projectId) => {
        setPresetBrowserOpen(false);
        openProjectWorkspace(projectId);
      }}
      onOpenStudio={() => {
        setPresetBrowserOpen(false);
        clearGallerySelection();
      }}
      onOpenGraph={() => {
        setPresetBrowserOpen(false);
        openGraphStudio();
      }}
      onGalleryModelFilterChange={handleGalleryModelFilterChange}
      onActivateGalleryKindFilter={handleGalleryKindFilterChange}
      onToggleFavoritesFilter={handleFavoritesFilterToggle}
      onOpenProjects={() => {
        setPresetBrowserOpen(false);
        setProjectBrowserOpen(true);
      }}
      onOpenPresets={() => setPresetBrowserOpen(true)}
      onOpenLibrary={() => {
        setPresetBrowserOpen(false);
        openContextualReferenceLibrary();
      }}
      onOpenSettings={() =>
        void router.push(buildStudioScopedHref("/settings", selectedProjectId))
      }
    />
  );

  return (
    <div className={immersive ? "min-h-dvh" : "space-y-7"}>
      <StudioCreateStage
        immersive={immersive}
        composerCollapsed={desktopComposerCollapsed}
        inspectorOpen={Boolean(selectedAsset)}
      >
        <div hidden={presetBrowserOpen}>{renderStudioHeader()}</div>

        <StudioGallery
          apiHealthy={apiHealthy}
          immersive={immersive}
          galleryTiles={renderedGalleryTiles}
          activeGalleryHasMore={renderedGalleryHasMore}
          firstGalleryPageFailed={gallery.state.firstGalleryPageFailed}
          activeGalleryLoadingMore={renderedGalleryLoadingMore}
          selectedAssetId={selectedAssetId}
          favoriteAssetIdBusy={favoriteAssetIdBusy}
          galleryLoadMoreRef={galleryLoadMoreRef}
          onLoadMore={() => {
            loadMoreActiveGalleryAssets().catch(reportActionError);
          }}
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
          onToggleFavorite={(asset) => {
            toggleAssetFavorite(asset).catch(reportActionError);
          }}
        />

        {!selectedAsset ? (
          <>
            <div id="studio-composer-shell" ref={composerShellRef}>
              <StudioComposer
                immersive={immersive}
                composerCollapsed={desktopComposerCollapsed}
                mobileComposerCollapsed={mobileComposerCollapsed}
                mobileComposerExpanded={mobileComposerExpanded}
                currentModelLabel={currentModel?.label ?? "Select a model"}
                formattedRemainingCredits={formattedRemainingCredits}
                estimatedCredits={estimatedCredits}
                structuredPresetActive={structuredPresetActive}
                presetLabel={currentPreset?.label ?? null}
                modelPicker={leadingModelPicker}
                {...composerInputs}
                floatingComposerStatus={floatingComposerStatus}
                onToggleCollapsed={() =>
                  setMobileComposerCollapsed((current) => !current)
                }
                onToggleComposerCollapsed={() =>
                  setDesktopComposerCollapsed((current) => !current)
                }
              >
                {structuredPresetActive ? (
                  <StudioStructuredPresetComposer
                    preset={currentPreset}
                    onOpenPresets={() => setPresetBrowserOpen(true)}
                    imageSlots={structuredPresetImageSlots}
                    textFields={structuredPresetTextFields}
                    slotStates={presetSlotStates}
                    inputValues={presetInputValues}
                    localAssets={localAssets ?? []}
                    favoriteAssets={favoriteAssets ?? []}
                    onPresetInputValuesChange={(nextValues) => {
                      expandStudioComposer();
                      setPresetInputValues(nextValues);
                    }}
                    onAssignSlotFile={(slotKey, file) => {
                      expandStudioComposer();
                      assignPresetSlotFile(slotKey, file);
                    }}
                    onClearSlot={(slotKey) => {
                      expandStudioComposer();
                      clearPresetSlot(slotKey);
                    }}
                    onOpenSlotLibrary={openPresetSlotReferenceLibrary}
                    onDropSlot={handlePresetSlotDrop}
                    onOpenPreview={openReferencePreview}
                    onResetFileInput={resetFileInputValue}
                  />
                ) : (
                  <StudioPromptComposerBody
                    promptInputRef={promptInputRef}
                    prompt={prompt}
                    multiShotsEnabled={multiShotsEnabled}
                    multiShot={
                      MULTI_SHOT_MODEL_KEYS.has(modelKey) &&
                      compactOptionEntries.some(
                        ([key]) => key === "multi_shots",
                      )
                        ? {
                            script: multiShotScript,
                            error: multiShotScriptError,
                            duration: optionValues["duration"],
                            onToggle: () => {
                              expandStudioComposer();
                              updateOption("multi_shots", !multiShotsEnabled);
                            },
                          }
                        : undefined
                    }
                    promptReferencePickerOpen={promptReferencePickerOpen}
                    promptReferenceChoices={promptReferenceChoices}
                    promptReferenceActiveIndex={promptReferenceActiveIndex}
                    enhanceEnabledForModel={
                      studioHarnessFixtureState?.composerEnhanceMode
                        ? true
                        : enhanceEnabledForModel
                    }
                    enhanceConfiguredForModel={
                      studioHarnessFixtureState?.composerEnhanceMode === "setup"
                        ? false
                        : studioHarnessFixtureState?.composerEnhanceMode ===
                            "disabled"
                          ? true
                          : enhanceConfiguredForModel
                    }
                    enhanceHasSavedSystemPrompt={
                      studioHarnessFixtureState?.composerEnhanceMode ===
                      "disabled"
                        ? false
                        : studioHarnessFixtureState?.composerEnhanceMode
                          ? true
                          : enhanceHasSavedSystemPrompt
                    }
                    onPromptChange={(nextPrompt) => {
                      expandStudioComposer();
                      setPrompt(nextPrompt);
                    }}
                    onPromptFocusChange={setPromptHasFocus}
                    onPromptReferenceDismissedChange={
                      setPromptReferenceDismissed
                    }
                    onPromptCursorSync={syncPromptCursorIndex}
                    onPromptReferenceActiveIndexChange={
                      setPromptReferenceActiveIndex
                    }
                    onApplyPromptReferenceChoice={applyPromptReferenceChoice}
                    onOpenEnhanceDialog={openEnhanceDialog}
                    onOpenEnhancementSetup={openEnhancementSetup}
                  />
                )}
                <StudioComposerControls
                  structuredPresetActive={structuredPresetActive}
                  modelPicker={inlineModelPicker}
                  openPicker={openPicker}
                  modelKey={modelKey}
                  presetPicker={immersive ? null : composerPresetPicker}
                  imageGenerateAction={
                    modelPickerLeadsComposer &&
                    currentModel?.generation_kind === "image"
                  }
                  showEstimate={immersive}
                  estimatedCredits={estimatedCredits}
                  modelMaxOutputs={modelMaxOutputs}
                  outputCount={outputCount}
                  compactOptionEntries={compactOptionEntries}
                  optionValues={requestOptions}
                  draftOptionValues={optionValues}
                  canSubmit={canSubmit}
                  generateButtonLabel={generateButtonLabel}
                  onOpenPickerChange={(pickerId) => {
                    if (pickerId) {
                      expandStudioComposer();
                    }
                    setOpenPicker(pickerId);
                  }}
                  onOutputCountChange={(nextOutputCount) => {
                    expandStudioComposer();
                    setOutputCount(nextOutputCount);
                  }}
                  onOptionChange={(optionKey, value) => {
                    expandStudioComposer();
                    updateOption(optionKey, value);
                  }}
                  onClear={() => {
                    expandStudioComposer();
                    clearComposer();
                  }}
                  onSubmit={() => {
                    expandStudioComposer();
                    void submitMedia("submit");
                  }}
                />
                {selectedPromptList.length ? (
                  <div className="mt-4 grid gap-3 border-t border-[var(--border-soft)] pt-4">
                    <div className="grid gap-2">
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
        userPrompt={
          (structuredPresetActive ? structuredPresetPromptPreview : prompt) ||
          ""
        }
        enhancedPrompt={
          enhancePreview?.final_prompt_used ||
          enhancePreview?.enhanced_prompt ||
          null
        }
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
          composerPresetPicker={immersive ? composerPresetPicker : null}
          navigation={immersive ? renderStudioHeader : undefined}
          returnFocusFallback={studioLibraryTriggerRef}
          returnToHref={
            typeof window === "undefined"
              ? pathname
              : `${window.location.pathname}${window.location.search}`
          }
          onClose={() => {
            setOpenPicker(null);
            setPresetBrowserOpen(false);
          }}
          onSelectPreset={(preset) => {
            loadPresetIntoStudio(preset.preset_id ?? preset.key, preset).catch(
              reportActionError,
            );
          }}
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
          kind={studioReferenceLibraryKind(referenceLibraryTarget)}
          returnFocusFallback={referenceLibraryReturnFocus}
          onClose={() => setReferenceLibraryTarget(null)}
          onSelect={handleReferenceLibrarySelect}
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
          suspended={[selectedMediaLightboxOpen, selectedReferencePreview].some(
            Boolean,
          )}
          selectedAsset={selectedAsset}
          selectedAssetModelLabel={
            models.find((model) => model.key === selectedAsset.model_key)?.label
          }
          selectedAssetDisplayVisual={selectedAssetDisplayVisual}
          selectedAssetPlaybackVisual={selectedAssetPlaybackVisual}
          selectedAssetPrompt={selectedAssetPrompt}
          selectedAssetStructuredPresetActive={
            selectedAssetStructuredPresetActive
          }
          selectedAssetPresetLabel={
            selectedAssetPreset?.label || selectedAsset.preset_key || "Preset"
          }
          selectedAssetPresetLoadKey={
            selectedAssetPreset?.preset_id ??
            selectedAssetPreset?.key ??
            selectedAsset.preset_key ??
            null
          }
          selectedAssetPresetDescription={
            selectedAssetPreset?.description ?? null
          }
          selectedAssetPresetSlots={selectedAssetPresetSlots}
          selectedAssetPresetSlotValues={selectedAssetPresetSlotValues}
          selectedAssetPresetFields={selectedAssetPresetFields}
          selectedAssetPresetInputValues={selectedAssetPresetInputValues}
          selectedAssetProjectLabel={selectedAssetProject?.name ?? null}
          selectedAssetReferencePreviews={selectedAssetReferencePreviews}
          favoriteAssetIdBusy={favoriteAssetIdBusy}
          copyPromptStatus={copyPromptStatus}
          mobileInspectorPromptOpen={mobileInspectorPromptOpen}
          downloadActionLabel={downloadActionLabel}
          showReviseAction={Boolean(selectedAssetRevisionPlan?.targetModel)}
          onClose={closeAssetInspector}
          onOpenLightbox={openSelectedMediaLightbox}
          onCopyPrompt={() => {
            copyPromptFromAsset(selectedAssetPrompt).catch(reportActionError);
          }}
          onToggleFavorite={(asset) => {
            toggleAssetFavorite(asset).catch(reportActionError);
          }}
          onUsePreset={(presetIdOrKey) => {
            closeAssetInspector();
            loadPresetIntoStudio(presetIdOrKey).catch(reportActionError);
          }}
          onOpenProject={openProjectWorkspace}
          onOpenReference={setSelectedReferencePreview}
          onMobileInspectorPromptOpenChange={setMobileInspectorPromptOpen}
          onDownload={() => {
            downloadAsset(selectedAsset).catch(reportActionError);
          }}
          onDismiss={() => {
            dismissAsset(selectedAsset.asset_id).catch(reportActionError);
          }}
          onAnimate={() => stageAssetAsSource(selectedAsset, true)}
          onUseImage={() => stageAssetAsSource(selectedAsset, false)}
          onRevise={() => {
            reviseSelectedAssetInStudio(selectedAsset).catch(reportActionError);
          }}
        />
      ) : null}

      {selectedFailedJob ? (
        <StudioFailedJobInspector
          job={selectedFailedJob}
          prompt={selectedFailedJobPrompt}
          imageReferences={selectedFailedJobImageReferences}
          onClose={() => setSelectedFailedJobId(null)}
          onDismiss={() => {
            dismissJob(selectedFailedJob.job_id).catch(reportActionError);
          }}
          onRetry={() => {
            retryFailedJobInStudio(selectedFailedJob).catch(reportActionError);
          }}
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
          src={selectedReferencePreview.fullUrl ?? selectedReferencePreview.url}
          alt={selectedReferencePreview.label}
          kind={selectedReferencePreview.kind}
          posterSrc={selectedReferencePreview.posterUrl}
          onClose={() => setSelectedReferencePreview(null)}
        />
      ) : null}

      {!immersive || studioHarnessFixtureState?.contextPanels ? (
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
