import { useEffect, useMemo, useRef, useState } from "react";

import {
  FLOATING_COMPOSER_STATUS_FADE_MS,
  FLOATING_COMPOSER_STATUS_MS,
  type AttachmentRecord,
  type ComposerStatusMessage,
} from "@/lib/media-studio-contract";
import {
  buildChoiceList,
  buildOrderedImageInputs,
  buildNormalizedStudioOptions,
  displayChoiceLabel,
  inferInputPattern,
  isCoarsePointerDevice,
  isPresetSlotFilled,
  isSeedanceModel,
  isRecord,
  mediaDisplayUrl,
  mediaThumbnailUrl,
  modelSupportsFirstLastFrames,
  modelSupportsImageDrivenInputs,
  modelSupportsMotionControl,
  modelSupportsStructuredImagePreset,
  modelInputLimit,
  MULTI_SHOT_MODEL_KEYS,
  normalizeStructuredPresetImageSlots,
  normalizeStructuredPresetTextFields,
  optionBooleanValue,
  optionEntries,
  parseMultiShotScript,
  parseOptionChoice,
  pickerWidth,
  renderStructuredPresetPrompt,
  resolveStandardComposerSlots,
  resolveEnhancementPreviewVisual,
  resolveComposerSourceAsset,
  resolveStudioPresetTargetModel,
  seedanceReferenceTokenGuide,
  serializeOptionChoice,
  isStudioPresetVisible,
  studioPresetSupportedModels,
  stripUnsupportedStudioOptions,
  studioValidationReady,
} from "@/lib/media-studio-helpers";
import { deriveStudioPricingOptions, estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";
import { findMediaAssetById, presetRequirementMessage, selectedPromptObjects } from "@/lib/studio-gallery";
import { readStudioComposerDraft, type StudioComposerDraft } from "@/lib/studio-composer-draft";
import { resolveImageMaxBytes } from "@/lib/studio-composer-file-utils";
import { deriveStudioEnhancementState } from "@/lib/studio-enhancement-state";
import { insertStudioPromptSnippet } from "@/lib/studio-prompt-snippets";
import { useStudioAttachments } from "@/hooks/studio/use-studio-attachments";
import { useStudioComposerDraftEffects } from "@/hooks/studio/use-studio-composer-draft-effects";
import { useStudioComposerGuardEffects } from "@/hooks/studio/use-studio-composer-guard-effects";
import { useStudioComposerState } from "@/hooks/studio/use-studio-composer-state";
import { useStudioComposerSubmit } from "@/hooks/studio/use-studio-composer-submit";
import type {
  MediaAsset,
  MediaBatch,
  MediaEnhancementConfig,
  MediaJob,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
  MediaReference,
  MediaSystemPrompt,
} from "@/lib/types";

type UseStudioComposerParams = {
  models: MediaModelSummary[];
  presets: MediaPreset[];
  prompts: MediaSystemPrompt[];
  enhancementConfigs: MediaEnhancementConfig[];
  queueSettings: MediaQueueSettings | null;
  queuePolicies: MediaModelQueuePolicy[];
  pricingSnapshot?: Record<string, unknown> | null;
  remainingCredits?: number | null;
  localBatches: MediaBatch[];
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
  projectId: string | null;
  sourceAssetId: string | number | null;
  setSourceAssetId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setOptimisticBatches: React.Dispatch<React.SetStateAction<MediaBatch[]>>;
  setLocalJobs: React.Dispatch<React.SetStateAction<MediaJob[]>>;
  upsertBatch: (batch: MediaBatch) => void;
  pollJob: (jobId: string) => Promise<void>;
  pollBatch: (batchId: string) => Promise<void>;
  formMessage: ComposerStatusMessage | null;
  setFormMessage: React.Dispatch<React.SetStateAction<ComposerStatusMessage | null>>;
  showActivity: (
    payload: { tone: "healthy" | "warning" | "danger"; message: string; spinning?: boolean },
    options?: { autoHideMs?: number },
  ) => void;
  refreshCreditBalance: () => Promise<void>;
};

export type StudioComposerController = ReturnType<typeof useStudioComposer>;

export function useStudioComposer({
  models,
  presets,
  prompts,
  enhancementConfigs,
  queueSettings,
  queuePolicies,
  pricingSnapshot,
  remainingCredits,
  localBatches,
  localAssets,
  favoriteAssets,
  projectId,
  sourceAssetId,
  setSourceAssetId,
  setOptimisticBatches,
  setLocalJobs,
  upsertBatch,
  pollJob,
  pollBatch,
  formMessage,
  setFormMessage,
  showActivity,
  refreshCreditBalance,
}: UseStudioComposerParams) {
  const initialDraftRef = useRef<StudioComposerDraft | null>(null);
  const draftRestoreStartedRef = useRef(false);
  const [draftPersistenceEnabled, setDraftPersistenceEnabled] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const autoValidateTimerRef = useRef<number | null>(null);
  const validationRequestIdRef = useRef(0);
  const floatingComposerHideTimerRef = useRef<number | null>(null);
  const floatingComposerClearTimerRef = useRef<number | null>(null);
  const formMessageHideTimerRef = useRef<number | null>(null);
  const queuePolicyByModelKey = useMemo(
    () => new Map(queuePolicies.map((policy) => [policy.model_key, policy])),
    [queuePolicies],
  );
  const studioReadyModels = useMemo(
    () => models.filter((model) => model.studio_exposed !== false),
    [models],
  );
  const enabledModels = useMemo(
    () => studioReadyModels.filter((model) => queuePolicyByModelKey.get(model.key)?.enabled ?? true),
    [queuePolicyByModelKey, studioReadyModels],
  );
  const composerState = useStudioComposerState({
    initialDraft: initialDraftRef.current,
    enabledModels,
    studioReadyModels,
    models,
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
    stagedSourceAssetSnapshot,
    isDragActive,
    validation,
    busyState,
    floatingComposerStatus,
    mobileComposerCollapsed,
    outputCount,
    openPicker,
    lastStructuredPresetModelKey,
  } = composerState.values;
  const {
    setModelKey,
    setSelectedPresetId,
    setSelectedPromptIds,
    setPrompt,
    setPresetInputValues,
    setPresetSlotStates,
    setOptionValues,
    setEnhanceDialogOpen,
    setEnhanceBusy,
    setEnhancePreview,
    setEnhanceError,
    setAttachments,
    setStagedSourceAssetSnapshot,
    setIsDragActive,
    setValidation,
    setBusyState,
    setFloatingComposerStatus,
    setMobileComposerCollapsed,
    setOutputCount,
    setOpenPicker,
    setLastStructuredPresetModelKey,
  } = composerState.setters;

  useEffect(() => {
    if (draftRestoreStartedRef.current) {
      return;
    }
    draftRestoreStartedRef.current = true;
    const draft = readStudioComposerDraft();
    if (draft) {
      setSourceAssetId(draft.sourceAssetId ?? null);
      setModelKey(draft.modelKey);
      setSelectedPresetId(draft.selectedPresetId ?? "");
      setSelectedPromptIds(draft.selectedPromptIds ?? []);
      setPrompt(draft.prompt ?? "");
      setPresetInputValues(draft.presetInputValues ?? {});
      setPresetSlotStates(draft.presetSlotStates ?? {});
      setOptionValues(draft.optionValues ?? {});
      setAttachments(draft.attachments ?? []);
      setStagedSourceAssetSnapshot(draft.stagedSourceAssetSnapshot ?? null);
      setOutputCount(draft.outputCount ?? 1);
      setLastStructuredPresetModelKey(draft.lastNanoPresetModelKey ?? "nano-banana-2");
    }
    setDraftPersistenceEnabled(true);
  }, [
    setAttachments,
    setLastStructuredPresetModelKey,
    setModelKey,
    setOptionValues,
    setOutputCount,
    setPresetInputValues,
    setPresetSlotStates,
    setPrompt,
    setSelectedPresetId,
    setSelectedPromptIds,
    setSourceAssetId,
    setStagedSourceAssetSnapshot,
  ]);

  const currentModel = models.find((model) => model.key === modelKey) ?? null;
  const currentPreset =
    presets.find((preset) => preset.preset_id === selectedPresetId || preset.key === selectedPresetId) ?? null;
  const currentPresetSelectionKey = currentPreset?.preset_id ?? currentPreset?.key ?? selectedPresetId;
  const resolvedSourceAsset = findMediaAssetById(sourceAssetId, localAssets, favoriteAssets) ?? null;
  const currentSourceAsset = resolveComposerSourceAsset(
    sourceAssetId,
    stagedSourceAssetSnapshot,
    localAssets,
    favoriteAssets,
  );
  const {
    currentModelEnhancementConfig,
    activeEnhancementEngineConfig,
    enhanceSupportsText,
    enhanceSupportsImage,
    enhanceEnabledForModel,
    enhanceHasSavedSystemPrompt,
    enhanceConfiguredForModel,
    enhanceSetupHref,
    enhanceProviderLabel,
    enhanceProviderModelId,
    enhanceImageAnalysisText,
    enhanceImageAnalysisStatus,
    enhanceModeLabel,
    enhanceReadinessLabel,
    enhanceHelperText,
  } = deriveStudioEnhancementState({ modelKey, enhancementConfigs, enhancePreview });
  const currentQueuePolicy = queuePolicyByModelKey.get(modelKey) ?? null;
  const currentModelEnabled = currentQueuePolicy?.enabled ?? true;
  const currentModelExposed = currentModel?.studio_exposed !== false;
  const currentModelSupportsStructuredPresets =
    modelSupportsStructuredImagePreset(currentModel, false) || modelSupportsStructuredImagePreset(currentModel, true);
  const seedanceComposer = isSeedanceModel(modelKey);
  const maxConcurrentJobs = Math.max(1, queueSettings?.max_concurrent_jobs ?? 10);
  const modelMaxOutputs = Math.max(1, currentQueuePolicy?.max_outputs_per_run ?? 1);
  const rawMaxImageInputs = modelInputLimit(currentModel, "image_inputs");
  const maxVideoInputs = modelInputLimit(currentModel, "video_inputs");
  const maxAudioInputs = modelInputLimit(currentModel, "audio_inputs");
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "images");
  const videoAttachments = attachments.filter((attachment) => attachment.kind === "videos");
  const audioAttachments = attachments.filter((attachment) => attachment.kind === "audios");
  const seedanceFirstFrameAttachment =
    attachments.find((attachment) => attachment.kind === "images" && attachment.role === "first_frame") ?? null;
  const seedanceLastFrameAttachment =
    attachments.find((attachment) => attachment.kind === "images" && attachment.role === "last_frame") ?? null;
  const seedanceReferenceImages = attachments.filter(
    (attachment) => attachment.kind === "images" && attachment.role === "reference",
  );
  const seedanceReferenceVideos = attachments.filter(
    (attachment) => attachment.kind === "videos" && attachment.role === "reference",
  );
  const seedanceReferenceAudios = attachments.filter(
    (attachment) => attachment.kind === "audios" && attachment.role === "reference",
  );
  const sourceAssetIsImage = currentSourceAsset?.generation_kind === "image";
  const sourceAssetIsVideo = currentSourceAsset?.generation_kind === "video";
  const stagedImageCount = imageAttachments.length + (sourceAssetIsImage ? 1 : 0);
  const stagedVideoCount = videoAttachments.length + (sourceAssetIsVideo ? 1 : 0);
  const stagedAudioCount = audioAttachments.length;
  useStudioComposerDraftEffects({
    initialDraft: initialDraftRef.current,
    persistenceEnabled: draftPersistenceEnabled,
    sourceAssetId,
    modelKey,
    selectedPresetId,
    selectedPromptIds,
    prompt,
    presetInputValues,
    presetSlotStates,
    optionValues,
    attachments,
    stagedSourceAssetSnapshot,
    outputCount,
    lastStructuredPresetModelKey,
    setAttachments,
    setPresetSlotStates,
  });

  function stageSourceAsset(asset: MediaAsset | null) {
    setStagedSourceAssetSnapshot(asset);
    setSourceAssetId(asset?.asset_id ?? null);
  }

  function clearSourceAsset() {
    setStagedSourceAssetSnapshot(null);
    setSourceAssetId(null);
  }

  const structuredPresetTextFields = useMemo(() => normalizeStructuredPresetTextFields(currentPreset), [currentPreset]);
  const structuredPresetImageSlots = useMemo(() => normalizeStructuredPresetImageSlots(currentPreset), [currentPreset]);
  const currentPresetSupportedModelKeys = useMemo(
    () => new Set(studioPresetSupportedModels(currentPreset, models)),
    [currentPreset, models],
  );
  const currentPresetCompatibleWithModel =
    Boolean(currentPreset) && currentPresetSupportedModelKeys.has(modelKey);
  const currentPresetDefaultOptions =
    currentPresetCompatibleWithModel && isRecord(currentPreset?.default_options_json) ? currentPreset.default_options_json : null;
  const structuredPresetActive =
    currentModelSupportsStructuredPresets &&
    currentPresetCompatibleWithModel &&
    (structuredPresetTextFields.length > 0 || structuredPresetImageSlots.length > 0);
  const effectiveSeedanceMode = seedanceComposer ? inferInputPattern(currentModel, attachments, currentSourceAsset) : "prompt_only";
  const inputPattern = inferInputPattern(currentModel, attachments, currentSourceAsset);
  const modelHasImageDrivenInputs = modelSupportsImageDrivenInputs(currentModel);
  const modelHasFirstLastFrameInputs = modelSupportsFirstLastFrames(currentModel);
  const modelHasMotionControlInputs = modelSupportsMotionControl(currentModel);
  const maxImageInputs = modelHasImageDrivenInputs ? rawMaxImageInputs : 0;
  const orderedImageInputs = useMemo(
    () => buildOrderedImageInputs(currentSourceAsset, imageAttachments, sourceAssetIsImage),
    [currentSourceAsset, imageAttachments, sourceAssetIsImage],
  );
  const standardComposerLayout = useMemo(
    () =>
      structuredPresetActive
        ? { slots: [], summaryLabel: null, usesExplicitSlots: false }
        : resolveStandardComposerSlots({
            model: currentModel,
            attachments,
            sourceAsset: currentSourceAsset,
          }),
    [attachments, currentModel, currentSourceAsset, structuredPresetActive],
  );
  const explicitVideoImageSlots =
    standardComposerLayout.usesExplicitSlots &&
    standardComposerLayout.slots.length > 0 &&
    standardComposerLayout.slots.every((slot) => slot.kind === "image");
  const explicitMotionControlSlots = standardComposerLayout.slots.some((slot) => slot.role === "driving_video");
  const visibleExplicitVideoImageSlots = standardComposerLayout.slots.filter((slot) => slot.kind === "image" && slot.visible).length;
  const multiShotsEnabled = MULTI_SHOT_MODEL_KEYS.has(modelKey) && optionBooleanValue(optionValues["multi_shots"]);
  const multiShotScript = useMemo(() => parseMultiShotScript(prompt, optionValues["duration"]), [optionValues, prompt]);
  const multiShotScriptError = multiShotsEnabled ? multiShotScript.errors[0] ?? null : null;
  const selectedPromptList = selectedPromptObjects(selectedPromptIds, prompts);
  const availableStudioPresets = useMemo(
    () => presets.filter((preset) => isStudioPresetVisible(preset, models)),
    [models, presets],
  );
  const modelPresets = currentModelSupportsStructuredPresets
    ? availableStudioPresets.filter((preset) => studioPresetSupportedModels(preset, models).includes(modelKey))
    : [];
  const structuredPresetPromptPreview = structuredPresetActive
    ? renderStructuredPresetPrompt(currentPreset?.prompt_template ?? "", presetInputValues, presetSlotStates, structuredPresetImageSlots)
    : "";
  const presetRequirementError = structuredPresetActive
    ? (() => {
        for (const field of structuredPresetTextFields) {
          const value = String(presetInputValues[field.key] ?? field.defaultValue ?? "").trim();
          if (field.required && !value) {
            return `The preset ${currentPreset?.label} requires the text field ${field.label}.`;
          }
        }
        for (const slot of structuredPresetImageSlots) {
          const slotState = presetSlotStates[slot.key];
          const slotFilled = isPresetSlotFilled(slotState);
          if (slot.required && !slotFilled) {
            return `The preset ${currentPreset?.label} requires the image slot ${slot.label}.`;
          }
        }
        return null;
      })()
    : currentPresetCompatibleWithModel
      ? presetRequirementMessage(currentPreset, attachments, currentSourceAsset)
      : null;
  const firstPresetSlotPreview =
    structuredPresetImageSlots.map((slot) => presetSlotStates[slot.key]?.previewUrl).find((value) => Boolean(value)) ?? null;
  const enhancementPreviewVisual = resolveEnhancementPreviewVisual({
    structuredPresetActive,
    firstPresetSlotPreview,
    orderedImageInputs,
    currentSourceAsset,
    imageAttachmentPreviewUrls: imageAttachments.map((attachment) => attachment.previewUrl),
  });
  const seedanceReferenceGuideTokens = useMemo(() => seedanceReferenceTokenGuide(attachments), [attachments]);
  const seedanceReferenceGuideText = seedanceReferenceGuideTokens.length
    ? `Reference staged assets in the prompt with ${seedanceReferenceGuideTokens.join(", ")}.`
    : "Reference uploads can be mentioned in the prompt with @image1, @video1, or @audio1 once staged.";
  const compactOptionEntries = optionEntries(currentModel);
  const optionSignature = useMemo(() => JSON.stringify(optionValues), [optionValues]);
  const pricingOptions = useMemo(() => {
    const normalized = buildNormalizedStudioOptions(
      currentModel,
      optionValues,
      currentPresetDefaultOptions,
    );
    return deriveStudioPricingOptions({
      modelKey,
      options: normalized,
      attachments,
      sourceAsset: currentSourceAsset,
    });
  }, [attachments, currentModel, currentPresetDefaultOptions, currentSourceAsset, modelKey, optionValues]);
  const selectedPromptSignature = useMemo(() => selectedPromptIds.join("|"), [selectedPromptIds]);
  const attachmentSignature = useMemo(
    () =>
      attachments
        .map(
          (attachment) =>
            `${attachment.id}:${attachment.file?.name ?? attachment.referenceId ?? ""}:${attachment.file?.size ?? 0}:${attachment.kind}:${attachment.role ?? ""}`,
        )
        .join("|"),
    [attachments],
  );
  const localPricingEstimate = useMemo(
    () => estimateFromPricingSnapshot(pricingSnapshot, modelKey, pricingOptions, outputCount),
    [modelKey, outputCount, pricingOptions, pricingSnapshot],
  );
  const { estimatedCredits, estimatedCostUsd, generatePriceLabel } = useMemo(
    () => resolveStudioPricingDisplay(validation, localPricingEstimate, outputCount),
    [outputCount, validation, localPricingEstimate],
  );
  const formattedRemainingCredits =
    typeof remainingCredits === "number"
      ? `${remainingCredits.toFixed(remainingCredits % 1 === 0 ? 0 : 1)}`
      : null;
  const generateButtonLabel =
    busyState === "submit" ? "Generating..." : generatePriceLabel ? `Generate · ${generatePriceLabel}` : "Generate";
  const pricingHelperText = generatePriceLabel
    ? modelMaxOutputs > 1
      ? `Generate shows the total for ${outputCount} output${outputCount === 1 ? "" : "s"}.`
      : "Generate shows the total for this request."
    : null;
  const currentImageMaxBytes = useMemo(() => resolveImageMaxBytes(currentModel), [currentModel]);
  const validationReady = studioValidationReady(validation);
  const inferredInputPattern = inferInputPattern(currentModel, attachments, currentSourceAsset);
  const composerHasSubmittableInput = structuredPresetActive
    ? Boolean(structuredPresetPromptPreview)
    : multiShotsEnabled
      ? multiShotScript.shots.length > 0 && !multiShotScriptError
      : Boolean(prompt.trim());
  const canSubmit = busyState === "idle" && !presetRequirementError && composerHasSubmittableInput;
  const composerStatusMessage =
    busyState === "validate"
      ? ({ tone: "warning", text: "Checking your request and refreshing the estimate." } as const)
      : busyState === "submit"
        ? ({ tone: "warning", text: "Sending your render to Studio." } as const)
        : formMessage;
  const imageSlotLabels =
    standardComposerLayout.slots.filter((slot) => slot.kind === "image").map((slot) => slot.label);
  const canUseSourceAsset = !seedanceComposer && (maxImageInputs > 0 || maxVideoInputs > 0);
  const canOpenReferenceLibrary =
    (structuredPresetActive && structuredPresetImageSlots.length > 0) || seedanceComposer || maxImageInputs > 0;
  const imageLimitLabel = maxImageInputs > 0 ? `${stagedImageCount} / ${maxImageInputs} images` : null;
  const canAddMoreImages = maxImageInputs > 0 && stagedImageCount < maxImageInputs;
  const canAddMoreVideos = maxVideoInputs > 0 && stagedVideoCount < maxVideoInputs;
  const canAddMoreAudios = maxAudioInputs > 0 && stagedAudioCount < maxAudioInputs;

  useStudioComposerGuardEffects({
    models,
    enabledModels,
    studioReadyModels,
    currentModel,
    currentModelExposed,
    currentModelEnabled,
    currentModelSupportsStructuredPresets,
    modelKey,
    modelMaxOutputs,
    selectedPresetId,
    currentPresetId: currentPreset?.preset_id ?? null,
    currentPresetDefaultOptions,
    currentPresetCompatibleWithModel,
    structuredPresetTextFields,
    seedanceComposer,
    sourceAssetId,
    resolvedSourceAsset,
    currentSourceAsset,
    maxImageInputs,
    maxVideoInputs,
    maxAudioInputs,
    attachments,
    presetSlotStates,
    setModelKey,
    setSelectedPresetId,
    setSelectedPromptIds,
    setValidation,
    setFormMessage,
    setStagedSourceAssetSnapshot,
    setSourceAssetId,
    setLastStructuredPresetModelKey,
    setOutputCount,
    setOptionValues,
    setPresetInputValues,
    setPresetSlotStates,
    setAttachments,
  });

  useEffect(() => {
    function closePicker(event: MouseEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("[data-studio-picker]")) {
        return;
      }
      setOpenPicker(null);
    }
    window.addEventListener("mousedown", closePicker);
    return () => window.removeEventListener("mousedown", closePicker);
  }, []);

  useEffect(() => {
    return () => {
      if (autoValidateTimerRef.current) {
        window.clearTimeout(autoValidateTimerRef.current);
      }
      if (formMessageHideTimerRef.current) {
        window.clearTimeout(formMessageHideTimerRef.current);
      }
      if (floatingComposerHideTimerRef.current) {
        window.clearTimeout(floatingComposerHideTimerRef.current);
      }
      if (floatingComposerClearTimerRef.current) {
        window.clearTimeout(floatingComposerClearTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (formMessageHideTimerRef.current) {
      window.clearTimeout(formMessageHideTimerRef.current);
      formMessageHideTimerRef.current = null;
    }
    if (busyState !== "idle" || !formMessage?.text) {
      return;
    }
    formMessageHideTimerRef.current = window.setTimeout(() => {
      setFormMessage((current) => (current?.text === formMessage.text ? null : current));
      formMessageHideTimerRef.current = null;
    }, 4200);
  }, [busyState, formMessage, setFormMessage]);

  function showFloatingComposerBanner(message: ComposerStatusMessage | null, autoHideMs = FLOATING_COMPOSER_STATUS_MS) {
    if (floatingComposerHideTimerRef.current) {
      window.clearTimeout(floatingComposerHideTimerRef.current);
      floatingComposerHideTimerRef.current = null;
    }
    if (floatingComposerClearTimerRef.current) {
      window.clearTimeout(floatingComposerClearTimerRef.current);
      floatingComposerClearTimerRef.current = null;
    }
    if (!message?.text) {
      setFloatingComposerStatus(null);
      return;
    }
    setFloatingComposerStatus({ ...message, visible: true });
    floatingComposerHideTimerRef.current = window.setTimeout(() => {
      setFloatingComposerStatus((current) => (current ? { ...current, visible: false } : null));
      floatingComposerClearTimerRef.current = window.setTimeout(() => {
        setFloatingComposerStatus(null);
      }, FLOATING_COMPOSER_STATUS_FADE_MS);
    }, autoHideMs);
  }

  function updateOption(optionKey: string, value: unknown) {
    setOptionValues((current) => ({ ...current, [optionKey]: value }));
  }

  function insertPromptSnippet(snippet: string) {
    insertStudioPromptSnippet({ snippet, input: promptInputRef.current, prompt, setPrompt });
  }

  const {
    addFiles,
    addRestoredFiles,
    addGalleryAssetAsAttachment,
    addReferenceMediaAsAttachment,
    assignPresetSlotFile,
    assignPresetSlotAsset,
    assignPresetSlotReference,
    clearPresetSlot,
    removeAttachment,
    clearPresetSlotStateValues,
  } = useStudioAttachments({
    seedanceComposer,
    seedanceFirstFrameAttachment,
    seedanceLastFrameAttachment,
    seedanceReferenceImages,
    seedanceReferenceVideos,
    seedanceReferenceAudios,
    maxImageInputs,
    maxVideoInputs,
    maxAudioInputs,
    stagedImageCount,
    stagedVideoCount,
    stagedAudioCount,
    setFormMessage,
    setAttachments,
    setPresetSlotStates,
  });

  function clearComposer() {
    for (const attachment of attachments) {
      if (attachment.previewUrl && attachment.file) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    }
    setAttachments([]);
    clearPresetSlotStateValues();
    setPresetInputValues({});
    clearSourceAsset();
    setPrompt("");
    setSelectedPresetId("");
    setSelectedPromptIds([]);
    setOptionValues(buildNormalizedStudioOptions(currentModel, {}, null));
    setOutputCount(1);
    setValidation(null);
    setFormMessage(null);
    setEnhanceDialogOpen(false);
    setEnhancePreview(null);
    setEnhanceError(null);
    setOpenPicker(null);
  }

  function applyPresetSelection(
    value: string,
    options: {
      preferredModelKey?: string | null;
    } = {},
  ) {
    setValidation(null);
    setFormMessage(null);

    if (!value) {
      setSelectedPresetId("");
      setPresetInputValues({});
      clearPresetSlotStateValues();
      return;
    }

    const targetPreset = presets.find((preset) => preset.preset_id === value || preset.key === value) ?? null;
    if (!targetPreset) {
      return;
    }

    const nextModelKey =
      resolveStudioPresetTargetModel(targetPreset, options.preferredModelKey ?? modelKey, lastStructuredPresetModelKey, models) ?? modelKey;
    if (nextModelKey !== modelKey) {
      setModelKey(nextModelKey);
    }

    const hasStructuredInputs =
      ((targetPreset.input_schema_json as Array<Record<string, unknown>> | undefined)?.length ?? 0) > 0 ||
      ((targetPreset.input_slots_json as Array<Record<string, unknown>> | undefined)?.length ?? 0) > 0;

    setSelectedPresetId(targetPreset.preset_id ?? targetPreset.key);

    if (hasStructuredInputs) {
      for (const attachment of attachments) {
        if (attachment.previewUrl && attachment.file) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      setAttachments([]);
      clearSourceAsset();
    }

    if (!hasStructuredInputs && targetPreset.prompt_template?.trim()) {
      setPrompt(targetPreset.prompt_template);
    }

    if (targetPreset.default_options_json && Object.keys(targetPreset.default_options_json).length) {
      setOptionValues((current) => ({ ...current, ...targetPreset.default_options_json }));
    }
  }

  function togglePrompt(promptId: string) {
    setSelectedPromptIds((current) =>
      current.includes(promptId) ? current.filter((value) => value !== promptId) : [...current, promptId],
    );
  }

  const { requestEnhancementPreview, openEnhanceDialog, requestValidation, submitMedia } = useStudioComposerSubmit({
    autoValidateTimerRef,
    validationRequestIdRef,
    currentModelEnabled,
    currentModel,
    currentPreset,
    currentPresetCompatibleWithModel,
    currentPresetDefaultOptions,
    selectedPresetId,
    modelKey,
    inferredInputPattern,
    optionValues,
    prompt,
    structuredPresetActive,
    structuredPresetPromptPreview,
    outputCount,
    selectedPromptIds,
    seedanceComposer,
    effectiveSeedanceMode,
    multiShotsEnabled,
    multiShotScript,
    multiShotScriptError,
    presetRequirementError,
    projectId,
    presetInputValues,
    structuredPresetImageSlots,
    presetSlotStates,
    currentImageMaxBytes,
    sourceAssetId,
    attachments,
    enhanceSupportsImage,
    enhanceSupportsText,
    enhanceEnabledForModel,
    enhanceHasSavedSystemPrompt,
    enhanceConfiguredForModel,
    enhancementPreviewVisual,
    validationReady,
    maxConcurrentJobs,
    localBatches,
    setValidation,
    setFormMessage,
    setBusyState,
    setEnhanceDialogOpen,
    setEnhancePreview,
    setEnhanceError,
    setEnhanceBusy,
    setOptimisticBatches,
    setLocalJobs,
    upsertBatch,
    setMobileComposerCollapsed,
    showActivity,
    showFloatingComposerBanner,
    refreshCreditBalance,
    pollJob,
    pollBatch,
  });

  useEffect(() => {
    if (busyState !== "idle") {
      return;
    }
    setValidation(null);
    if (autoValidateTimerRef.current) {
      window.clearTimeout(autoValidateTimerRef.current);
    }
    autoValidateTimerRef.current = window.setTimeout(() => {
      void requestValidation({ silent: true });
    }, 180);
    return () => {
      if (autoValidateTimerRef.current) {
        window.clearTimeout(autoValidateTimerRef.current);
      }
    };
  }, [
    modelKey,
    prompt,
    optionSignature,
    selectedPresetId,
    selectedPromptSignature,
    sourceAssetId,
    attachmentSignature,
    structuredPresetActive,
    structuredPresetPromptPreview,
    JSON.stringify(presetInputValues),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(presetSlotStates).map(([key, value]) => [key, value.assetId ?? value.referenceId ?? value.file?.name ?? ""]),
      ),
    ),
  ]);

  return {
    refs: {
      promptInputRef,
    },
    state: {
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
    },
    derived: {
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
      enhanceHelperText,
      enhanceImageAnalysisText,
      enhanceImageAnalysisStatus,
      structuredPresetTextFields,
      structuredPresetImageSlots,
      structuredPresetActive,
      canOpenReferenceLibrary,
      inputPattern,
      standardComposerLayout,
      explicitVideoImageSlots,
      explicitMotionControlSlots,
      visibleExplicitVideoImageSlots,
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
      pricingOptions,
      estimatedCredits,
      estimatedCostUsd,
      generatePriceLabel,
      pricingHelperText,
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
      modelHasFirstLastFrameInputs,
      modelHasMotionControlInputs,
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
    },
    actions: {
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
      insertPromptSnippet,
      removeAttachment,
      clearComposer,
      applyPresetSelection,
      togglePrompt,
      requestEnhancementPreview,
      openEnhanceDialog,
      showFloatingComposerBanner,
      requestValidation,
      submitMedia,
      pickerWidth,
      buildChoiceList,
      displayChoiceLabel,
      parseOptionChoice,
      serializeOptionChoice,
    },
  };
}
