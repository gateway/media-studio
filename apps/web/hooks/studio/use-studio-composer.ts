import { useEffect, useMemo, useRef, useState } from "react";

import {
  FLOATING_COMPOSER_STATUS_FADE_MS,
  FLOATING_COMPOSER_STATUS_MS,
  type AttachmentRecord,
  type ComposerStatusMessage,
  type FloatingComposerStatus,
} from "@/lib/media-studio-contract";
import {
  buildChoiceList,
  buildNormalizedStudioOptions,
  classifyFile,
  displayChoiceLabel,
  inferInputPattern,
  isNanoPresetModel,
  isSeedanceModel,
  isRecord,
  mediaDisplayUrl,
  mediaDownloadName,
  mediaDownloadUrl,
  mediaInlineUrl,
  mediaPlaybackUrl,
  mediaThumbnailUrl,
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
  seedanceReferenceTokenGuide,
  serializeOptionChoice,
  stripUnsupportedStudioOptions,
  studioValidationReady,
  type PresetSlotState,
} from "@/lib/media-studio-helpers";
import { estimateFromPricingSnapshot, resolveStudioPricingDisplay } from "@/lib/studio-pricing";
import {
  createOptimisticBatch,
  findMediaAssetById,
  presetRequirementMessage,
  selectedPromptObjects,
} from "@/lib/studio-gallery";
import type {
  MediaAsset,
  MediaBatch,
  MediaEnhancementConfig,
  MediaEnhancePreviewResponse,
  MediaJob,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
  MediaSystemPrompt,
  MediaValidationResponse,
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
}: UseStudioComposerParams) {
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const autoValidateTimerRef = useRef<number | null>(null);
  const validationRequestIdRef = useRef(0);
  const floatingComposerHideTimerRef = useRef<number | null>(null);
  const floatingComposerClearTimerRef = useRef<number | null>(null);
  const formMessageHideTimerRef = useRef<number | null>(null);
  const [modelKey, setModelKey] = useState(models[0]?.key ?? "nano-banana-2");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [presetInputValues, setPresetInputValues] = useState<Record<string, string>>({});
  const [presetSlotStates, setPresetSlotStates] = useState<Record<string, PresetSlotState>>({});
  const [optionValues, setOptionValues] = useState<Record<string, unknown>>({});
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhancePreview, setEnhancePreview] = useState<MediaEnhancePreviewResponse | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [validation, setValidation] = useState<MediaValidationResponse | null>(null);
  const [busyState, setBusyState] = useState<"idle" | "validate" | "submit">("idle");
  const [floatingComposerStatus, setFloatingComposerStatus] = useState<FloatingComposerStatus | null>(null);
  const [mobileComposerCollapsed, setMobileComposerCollapsed] = useState(true);
  const [outputCount, setOutputCount] = useState(1);
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const currentModel = models.find((model) => model.key === modelKey) ?? null;
  const currentPreset =
    presets.find((preset) => preset.preset_id === selectedPresetId || preset.key === selectedPresetId) ?? null;
  const currentSourceAsset = findMediaAssetById(sourceAssetId, localAssets, favoriteAssets) ?? null;
  const globalEnhancementConfig =
    enhancementConfigs.find((config) => config.model_key === "__studio_enhancement__") ??
    enhancementConfigs.find(
      (config) => Boolean(config.provider_model_id || (config.provider_kind && config.provider_kind !== "builtin")),
    ) ??
    null;
  const currentModelEnhancementConfig =
    enhancementConfigs.find((config) => config.model_key === modelKey) ?? null;
  const activeEnhancementEngineConfig =
    currentModelEnhancementConfig &&
    (Boolean(currentModelEnhancementConfig.provider_model_id) ||
      (currentModelEnhancementConfig.provider_kind && currentModelEnhancementConfig.provider_kind !== "builtin"))
      ? currentModelEnhancementConfig
      : globalEnhancementConfig;
  const enhanceSupportsText =
    currentModelEnhancementConfig && "supports_text_enhancement" in currentModelEnhancementConfig
      ? Boolean(currentModelEnhancementConfig.supports_text_enhancement)
      : Boolean(globalEnhancementConfig?.supports_text_enhancement);
  const enhanceSupportsImage =
    currentModelEnhancementConfig && "supports_image_analysis" in currentModelEnhancementConfig
      ? Boolean(currentModelEnhancementConfig.supports_image_analysis)
      : Boolean(globalEnhancementConfig?.supports_image_analysis);
  const enhanceEnabledForModel = enhanceSupportsText || enhanceSupportsImage;
  const enhanceProviderKind = activeEnhancementEngineConfig?.provider_kind ?? "builtin";
  const enhanceCredentialConfigured = Boolean(
    activeEnhancementEngineConfig?.provider_credential_source || activeEnhancementEngineConfig?.provider_api_key_configured,
  );
  const enhanceBaseUrlConfigured = Boolean(activeEnhancementEngineConfig?.provider_base_url_configured);
  const enhanceModelSelected = Boolean(activeEnhancementEngineConfig?.provider_model_id);
  const enhanceConfiguredForModel =
    enhanceEnabledForModel &&
    (enhanceProviderKind === "openrouter"
      ? enhanceCredentialConfigured
      : enhanceProviderKind === "local_openai"
        ? enhanceBaseUrlConfigured || enhanceCredentialConfigured || enhanceModelSelected
        : false);
  const enhanceSetupHref = "/settings#prompt-enhancement";
  const currentQueuePolicy = queuePolicies.find((policy) => policy.model_key === modelKey) ?? null;
  const seedanceComposer = isSeedanceModel(modelKey);
  const maxConcurrentJobs = Math.max(1, queueSettings?.max_concurrent_jobs ?? 10);
  const modelMaxOutputs = Math.max(
    1,
    Math.min(maxConcurrentJobs, currentQueuePolicy?.max_outputs_per_run ?? (isNanoPresetModel(modelKey) ? 3 : 1)),
  );
  const maxImageInputs = modelInputLimit(currentModel, "image_inputs");
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
  const enhanceProviderLabel =
    enhancePreview?.provider_label ??
    activeEnhancementEngineConfig?.provider_label ??
    (activeEnhancementEngineConfig?.provider_kind === "openrouter"
      ? "OpenRouter.ai"
      : activeEnhancementEngineConfig?.provider_kind === "local_openai"
        ? "Local OpenAI-Compatible"
        : "Built-in helper");
  const enhanceProviderModelId =
    enhancePreview?.provider_model_id ??
    activeEnhancementEngineConfig?.provider_model_id ??
    (activeEnhancementEngineConfig?.provider_kind === "openrouter" ? "qwen/qwen3.5-35b-a3b" : null);
  const enhanceImageAnalysisText = enhancePreview?.image_analysis
    ? typeof enhancePreview.image_analysis === "string"
      ? enhancePreview.image_analysis
      : String(
          (enhancePreview.image_analysis as Record<string, unknown>).analysis ??
            (enhancePreview.image_analysis as Record<string, unknown>).warning ??
            "No image analysis output returned.",
        )
    : null;
  const enhanceImageAnalysisStatus = enhancePreview?.image_analysis
    ? typeof enhancePreview.image_analysis === "string"
      ? "available"
      : String((enhancePreview.image_analysis as Record<string, unknown>).status ?? "available")
    : "Not checked";
  const structuredPresetTextFields = useMemo(() => normalizeStructuredPresetTextFields(currentPreset), [currentPreset]);
  const structuredPresetImageSlots = useMemo(() => normalizeStructuredPresetImageSlots(currentPreset), [currentPreset]);
  const structuredPresetActive =
    isNanoPresetModel(modelKey) && Boolean(currentPreset) && (structuredPresetTextFields.length > 0 || structuredPresetImageSlots.length > 0);
  const effectiveSeedanceMode = seedanceComposer ? inferInputPattern(currentModel, attachments, currentSourceAsset) : "prompt_only";
  const inputPattern = inferInputPattern(currentModel, attachments, currentSourceAsset);
  const explicitVideoImageSlots =
    !structuredPresetActive &&
    currentModel?.generation_kind === "video" &&
    maxImageInputs > 0 &&
    maxImageInputs <= 2 &&
    maxVideoInputs === 0 &&
    maxAudioInputs === 0;
  const orderedImageInputs = useMemo(() => {
    const items: Array<{ source: "asset"; asset: MediaAsset } | { source: "attachment"; attachment: AttachmentRecord }> = [];
    if (sourceAssetIsImage && currentSourceAsset) {
      items.push({ source: "asset", asset: currentSourceAsset });
    }
    for (const attachment of imageAttachments) {
      items.push({ source: "attachment", attachment });
    }
    return items;
  }, [currentSourceAsset, imageAttachments, sourceAssetIsImage]);
  const multiShotsEnabled = MULTI_SHOT_MODEL_KEYS.has(modelKey) && optionBooleanValue(optionValues["multi_shots"]);
  const multiShotScript = useMemo(() => parseMultiShotScript(prompt, optionValues["duration"]), [optionValues, prompt]);
  const multiShotScriptError = multiShotsEnabled ? multiShotScript.errors[0] ?? null : null;
  const selectedPromptList = selectedPromptObjects(selectedPromptIds, prompts);
  const modelPresets = isNanoPresetModel(modelKey)
    ? presets.filter((preset) => {
        if (preset.source_kind === "builtin") {
          return false;
        }
        const scopedModels = preset.applies_to_models?.length ? preset.applies_to_models : preset.model_key ? [preset.model_key] : [];
        return !scopedModels.length || scopedModels.includes(modelKey);
      })
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
          const slotFilled = Boolean(slotState?.assetId || slotState?.file);
          if (slot.required && !slotFilled) {
            return `The preset ${currentPreset?.label} requires the image slot ${slot.label}.`;
          }
        }
        return null;
      })()
    : presetRequirementMessage(currentPreset, attachments, currentSourceAsset);
  const firstPresetSlotPreview =
    structuredPresetImageSlots.map((slot) => presetSlotStates[slot.key]?.previewUrl).find((value) => Boolean(value)) ?? null;
  const enhancementPreviewVisual = structuredPresetActive
    ? firstPresetSlotPreview
    : currentSourceAsset
      ? mediaDisplayUrl(currentSourceAsset)
      : attachments.find((attachment) => attachment.kind === "images")?.previewUrl ?? null;
  const seedanceReferenceGuideTokens = useMemo(() => seedanceReferenceTokenGuide(attachments), [attachments]);
  const seedanceReferenceGuideText = seedanceReferenceGuideTokens.length
    ? `Reference staged assets in the prompt with ${seedanceReferenceGuideTokens.join(", ")}.`
    : "Reference uploads can be mentioned in the prompt with @image1, @video1, or @audio1 once staged.";
  const compactOptionEntries = optionEntries(currentModel);
  const optionSignature = useMemo(() => JSON.stringify(optionValues), [optionValues]);
  const pricingOptions = useMemo(
    () =>
      buildNormalizedStudioOptions(
        currentModel,
        optionValues,
        isRecord(currentPreset?.default_options_json) ? currentPreset.default_options_json : null,
      ),
    [currentModel, currentPreset?.default_options_json, optionValues],
  );
  const selectedPromptSignature = useMemo(() => selectedPromptIds.join("|"), [selectedPromptIds]);
  const attachmentSignature = useMemo(
    () =>
      attachments
        .map(
          (attachment) =>
            `${attachment.id}:${attachment.file.name}:${attachment.file.size}:${attachment.kind}:${attachment.role ?? ""}`,
        )
        .join("|"),
    [attachments],
  );
  const localPricingEstimate = useMemo(
    () => estimateFromPricingSnapshot(pricingSnapshot, modelKey, pricingOptions, outputCount),
    [modelKey, outputCount, pricingOptions, pricingSnapshot],
  );
  const { estimatedCredits, estimatedCostUsd, generatePriceLabel } = useMemo(
    () => resolveStudioPricingDisplay(validation, localPricingEstimate),
    [validation, localPricingEstimate],
  );
  const formattedRemainingCredits =
    typeof remainingCredits === "number"
      ? `${remainingCredits.toFixed(remainingCredits % 1 === 0 ? 0 : 1)}`
      : null;
  const generateButtonLabel =
    busyState === "submit" ? "Generating..." : generatePriceLabel ? `Generate · ${generatePriceLabel}` : "Generate";
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
      ? ({ tone: "warning", text: "Validating request and checking estimated cost." } as const)
      : busyState === "submit"
        ? ({ tone: "warning", text: "Preparing the job and sending it to the runner." } as const)
        : formMessage;
  const imageSlotLabels =
    explicitVideoImageSlots && currentModel?.input_patterns?.includes("first_last_frames")
      ? ["Start frame", "End frame"]
      : ["Source image"];
  const canUseSourceAsset = !seedanceComposer;
  const imageLimitLabel = maxImageInputs > 0 ? `${stagedImageCount} / ${maxImageInputs} images` : null;
  const canAddMoreImages = maxImageInputs > 0 && stagedImageCount < maxImageInputs;
  const canAddMoreVideos = maxVideoInputs > 0 && stagedVideoCount < maxVideoInputs;
  const canAddMoreAudios = maxAudioInputs > 0 && stagedAudioCount < maxAudioInputs;

  useEffect(() => {
    setOutputCount((current) => Math.min(Math.max(1, current), modelMaxOutputs));
  }, [modelMaxOutputs]);

  useEffect(() => {
    setOptionValues(
      buildNormalizedStudioOptions(currentModel, {}, isRecord(currentPreset?.default_options_json) ? currentPreset.default_options_json : null),
    );
  }, [currentModel, currentPreset]);

  useEffect(() => {
    setSourceAssetId(null);
  }, [attachments, seedanceComposer, setSourceAssetId]);

  useEffect(() => {
    const nextValues: Record<string, string> = {};
    for (const field of structuredPresetTextFields) {
      nextValues[field.key] = field.defaultValue ?? "";
    }
    setPresetInputValues(nextValues);
    setPresetSlotStates((current) => {
      for (const state of Object.values(current)) {
        if (state?.previewUrl) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
      return {};
    });
  }, [currentPreset?.preset_id, structuredPresetTextFields]);

  useEffect(() => {
    return () => {
      for (const attachment of attachments) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      for (const state of Object.values(presetSlotStates)) {
        if (state?.previewUrl) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
    };
  }, [attachments, presetSlotStates]);

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

  useEffect(() => {
    const sourceKind = currentSourceAsset?.generation_kind ?? null;
    if ((sourceKind === "image" && maxImageInputs <= 0) || (sourceKind === "video" && maxVideoInputs <= 0)) {
      setSourceAssetId(null);
    }
    setAttachments((current) => {
      let remainingImages = Math.max(0, maxImageInputs - (sourceKind === "image" && maxImageInputs > 0 ? 1 : 0));
      let remainingVideos = Math.max(0, maxVideoInputs - (sourceKind === "video" && maxVideoInputs > 0 ? 1 : 0));
      let remainingAudios = Math.max(0, maxAudioInputs);
      let changed = false;
      const next: AttachmentRecord[] = [];
      for (const attachment of current) {
        if (attachment.kind === "images") {
          if (remainingImages <= 0) {
            changed = true;
            if (attachment.previewUrl) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
            continue;
          }
          remainingImages -= 1;
        } else if (attachment.kind === "videos") {
          if (remainingVideos <= 0) {
            changed = true;
            if (attachment.previewUrl) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
            continue;
          }
          remainingVideos -= 1;
        } else {
          if (remainingAudios <= 0) {
            changed = true;
            continue;
          }
          remainingAudios -= 1;
        }
        next.push(attachment);
      }
      return changed ? next : current;
    });
  }, [currentSourceAsset, maxAudioInputs, maxImageInputs, maxVideoInputs, setSourceAssetId]);

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
    const input = promptInputRef.current;
    if (!input) {
      setPrompt((current) => `${current}${current.trim() ? " " : ""}${snippet}`);
      return;
    }
    const start = input.selectionStart ?? prompt.length;
    const end = input.selectionEnd ?? prompt.length;
    const spacerBefore = start > 0 && !/\s$/.test(prompt.slice(0, start)) ? " " : "";
    const spacerAfter = end < prompt.length && !/^\s/.test(prompt.slice(end)) ? " " : "";
    const insertion = `${spacerBefore}${snippet}${spacerAfter}`;
    const nextPrompt = `${prompt.slice(0, start)}${insertion}${prompt.slice(end)}`;
    setPrompt(nextPrompt);
    window.setTimeout(() => {
      input.focus();
      const cursor = start + insertion.length;
      input.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function remainingSeedanceCapacity(kind: AttachmentRecord["kind"], role: NonNullable<AttachmentRecord["role"]>) {
    if (role === "first_frame") {
      return kind === "images" && !seedanceFirstFrameAttachment ? 1 : 0;
    }
    if (role === "last_frame") {
      return kind === "images" && !seedanceLastFrameAttachment ? 1 : 0;
    }
    if (kind === "images") {
      return Math.max(0, maxImageInputs - seedanceReferenceImages.length);
    }
    if (kind === "videos") {
      return Math.max(0, maxVideoInputs - seedanceReferenceVideos.length);
    }
    return Math.max(0, maxAudioInputs - seedanceReferenceAudios.length);
  }

  function addFiles(
    fileList: FileList | File[] | null,
    config: { role?: NonNullable<AttachmentRecord["role"]>; allowedKinds?: AttachmentRecord["kind"][] } = {},
  ) {
    const incomingFiles = Array.from(fileList ?? []);
    if (!incomingFiles.length) {
      return;
    }
    const explicitRole = config.role ?? null;
    const allowedKinds = new Set(config.allowedKinds ?? []);
    let remainingImageCapacity = Math.max(0, maxImageInputs - stagedImageCount);
    let remainingVideoCapacity = Math.max(0, maxVideoInputs - stagedVideoCount);
    let remainingAudioCapacity = Math.max(0, maxAudioInputs - stagedAudioCount);
    const acceptedFiles: File[] = [];
    const acceptedMetadata: Array<{
      role?: NonNullable<AttachmentRecord["role"]> | null;
      kind: AttachmentRecord["kind"];
    }> = [];
    const rejectedKinds = new Set<string>();
    for (const file of incomingFiles) {
      const kind = classifyFile(file);
      if (allowedKinds.size > 0 && !allowedKinds.has(kind)) {
        rejectedKinds.add(kind);
        continue;
      }
      if (seedanceComposer && explicitRole) {
        const remaining = remainingSeedanceCapacity(kind, explicitRole);
        const acceptedForRole = acceptedMetadata.filter(
          (item) => item.kind === kind && item.role === explicitRole,
        ).length;
        if (remaining - acceptedForRole <= 0) {
          rejectedKinds.add(kind);
          continue;
        }
        acceptedFiles.push(file);
        acceptedMetadata.push({ kind, role: explicitRole });
        continue;
      }
      if (kind === "images") {
        if (remainingImageCapacity <= 0) {
          rejectedKinds.add("images");
          continue;
        }
        remainingImageCapacity -= 1;
        acceptedFiles.push(file);
        acceptedMetadata.push({ kind });
        continue;
      }
      if (kind === "videos") {
        if (remainingVideoCapacity <= 0) {
          rejectedKinds.add("videos");
          continue;
        }
        remainingVideoCapacity -= 1;
        acceptedFiles.push(file);
        acceptedMetadata.push({ kind });
        continue;
      }
      if (remainingAudioCapacity <= 0) {
        rejectedKinds.add("audios");
        continue;
      }
      remainingAudioCapacity -= 1;
      acceptedFiles.push(file);
      acceptedMetadata.push({ kind });
    }
    if (!acceptedFiles.length) {
      if (rejectedKinds.size) {
        setFormMessage({
          tone: "warning",
          text: `This model cannot accept more ${Array.from(rejectedKinds).join(", ")} right now.`,
        });
      }
      return;
    }
    const nextAttachments = acceptedFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      file,
      kind: acceptedMetadata[index]?.kind ?? classifyFile(file),
      role: acceptedMetadata[index]?.role ?? (seedanceComposer ? "reference" : null),
      previewUrl: file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null,
      durationSeconds: null,
    }));
    setAttachments((current) => [...current, ...nextAttachments]);
    const existingImageCount = imageAttachments.length + (sourceAssetIsImage ? 1 : 0);
    const imageReferenceTokens = nextAttachments
      .filter((attachment) => attachment.kind === "images")
      .map((_, index) => `[image reference ${existingImageCount + index + 1}]`);
    if (imageReferenceTokens.length && isNanoPresetModel(modelKey)) {
      insertPromptSnippet(imageReferenceTokens.join(" "));
    }
    if (rejectedKinds.size) {
      setFormMessage({
        tone: "warning",
        text: `Accepted what fit and skipped extra ${Array.from(rejectedKinds).join(", ")} beyond this model's limit.`,
      });
    }
  }

  async function addGalleryAssetAsAttachment(
    asset: MediaAsset | null,
    role: NonNullable<AttachmentRecord["role"]> | null = null,
    allowedKinds?: AttachmentRecord["kind"][],
  ) {
    if (!asset) {
      setFormMessage({ tone: "danger", text: "The selected gallery asset could not be staged." });
      return;
    }
    const kind =
      asset.generation_kind === "video"
        ? ("videos" as const)
        : asset.generation_kind === "audio"
          ? ("audios" as const)
          : ("images" as const);
    if (allowedKinds?.length && !allowedKinds.includes(kind)) {
      setFormMessage({
        tone: "danger",
        text:
          kind === "videos"
            ? "Only video gallery cards can be staged in that slot."
            : kind === "audios"
              ? "Only audio gallery cards can be staged in that slot."
              : "Only image gallery cards can be staged in that slot.",
      });
      return;
    }
    const assetUrl =
      (kind === "videos" ? mediaPlaybackUrl(asset) : null) ??
      mediaInlineUrl(asset) ??
      mediaDownloadUrl(asset);
    if (!assetUrl) {
      setFormMessage({ tone: "danger", text: "The selected gallery asset could not be loaded." });
      return;
    }
    try {
      const response = await fetch(assetUrl, { credentials: "same-origin" });
      if (!response.ok) {
        throw new Error("Unable to fetch gallery asset.");
      }
      const blob = await response.blob();
      const file = new File([blob], mediaDownloadName(asset), {
        type:
          blob.type ||
          (kind === "videos" ? "video/mp4" : kind === "audios" ? "audio/wav" : "image/png"),
      });
      const addConfig =
        role != null || allowedKinds?.length
          ? {
              ...(role != null ? { role } : {}),
              ...(allowedKinds?.length ? { allowedKinds } : { allowedKinds: [kind] }),
            }
          : undefined;
      addFiles([file], addConfig);
    } catch {
      setFormMessage({ tone: "danger", text: "The selected gallery asset could not be staged in that slot." });
    }
  }

  function assignPresetSlotFile(slotKey: string, file: File | null) {
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      if (!file) {
        return { ...current, [slotKey]: { assetId: null, file: null, previewUrl: null } };
      }
      return {
        ...current,
        [slotKey]: {
          assetId: null,
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        },
      };
    });
  }

  function assignPresetSlotAsset(slotKey: string, asset: MediaAsset | null) {
    if (!asset) {
      return;
    }
    if (asset.generation_kind !== "image") {
      setFormMessage({ tone: "danger", text: "Structured Nano Banana presets only accept image assets in image slots." });
      return;
    }
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        ...current,
        [slotKey]: {
          assetId: asset.asset_id,
          file: null,
          previewUrl: mediaThumbnailUrl(asset) ?? mediaDisplayUrl(asset),
        },
      };
    });
  }

  function clearPresetSlot(slotKey: string) {
    setPresetSlotStates((current) => {
      const previous = current[slotKey];
      if (previous?.previewUrl && previous.file) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        ...current,
        [slotKey]: { assetId: null, file: null, previewUrl: null },
      };
    });
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => {
      const match = current.find((attachment) => attachment.id === attachmentId);
      if (match?.previewUrl) {
        URL.revokeObjectURL(match.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }

  function clearComposer() {
    for (const attachment of attachments) {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    }
    setAttachments([]);
    setPresetSlotStates((current) => {
      for (const state of Object.values(current)) {
        if (state?.previewUrl && state.file) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
      return {};
    });
    setPresetInputValues({});
    setSourceAssetId(null);
    setPrompt("");
    setSelectedPresetId("");
    setSelectedPromptIds([]);
    setModelKey(models[0]?.key ?? "nano-banana-2");
    setOutputCount(1);
    setValidation(null);
    setFormMessage(null);
    setEnhanceDialogOpen(false);
    setEnhancePreview(null);
    setEnhanceError(null);
    setOpenPicker(null);
  }

  function togglePrompt(promptId: string) {
    setSelectedPromptIds((current) =>
      current.includes(promptId) ? current.filter((value) => value !== promptId) : [...current, promptId],
    );
  }

  function buildMediaFormData(intent: "validate" | "submit" | "enhance") {
    const formData = new FormData();
    const normalizedOptions = buildNormalizedStudioOptions(
      currentModel,
      optionValues,
      isRecord(currentPreset?.default_options_json) ? currentPreset.default_options_json : null,
    );
    const sanitizedOptions = stripUnsupportedStudioOptions(modelKey, inferredInputPattern, normalizedOptions);
    const effectivePrompt = structuredPresetActive ? structuredPresetPromptPreview : prompt;
    formData.set("intent", intent);
    formData.set("model_key", modelKey);
    formData.set("prompt", effectivePrompt);
    formData.set("output_count", String(outputCount));
    formData.set("enhance", intent === "enhance" ? "true" : "false");
    formData.set("options", JSON.stringify(sanitizedOptions));
    formData.set("system_prompt_ids", JSON.stringify(selectedPromptIds));
    if (seedanceComposer) {
      formData.set("task_mode", effectiveSeedanceMode === "prompt_only" ? "text_to_video" : "reference_to_video");
    }
    if (multiShotsEnabled && multiShotScript.shots.length) {
      formData.set("multi_prompt", JSON.stringify(multiShotScript.shots));
    }
    if (selectedPresetId) {
      const selectedPreset = presets.find((preset) => preset.preset_id === selectedPresetId || preset.key === selectedPresetId);
      if (selectedPreset?.source_kind === "builtin") {
        formData.set("preset_key", selectedPreset.key);
      } else {
        formData.set("preset_id", selectedPresetId);
      }
    }
    if (structuredPresetActive) {
      formData.set("preset_inputs_json", JSON.stringify(presetInputValues));
      const presetSlotValues: Record<string, Array<Record<string, unknown>>> = {};
      for (const slot of structuredPresetImageSlots) {
        const slotState = presetSlotStates[slot.key];
        if (!slotState) {
          continue;
        }
        if (slotState.assetId) {
          presetSlotValues[slot.key] = [{ asset_id: slotState.assetId }];
          formData.set(`preset_slot_asset:${slot.key}`, String(slotState.assetId));
        }
        if (slotState.file) {
          formData.append(`preset_slot_file:${slot.key}`, slotState.file);
        }
      }
      formData.set("preset_slot_values_json", JSON.stringify(presetSlotValues));
    }
    if (!structuredPresetActive && sourceAssetId && !seedanceComposer) {
      formData.set("source_asset_id", String(sourceAssetId));
    }
    if (!structuredPresetActive) {
      formData.set(
        "attachment_manifest",
        JSON.stringify(
          attachments.map((attachment) => ({
            id: attachment.id,
            kind: attachment.kind,
            role: attachment.role ?? null,
            duration_seconds: attachment.durationSeconds ?? null,
          })),
        ),
      );
      for (const attachment of attachments) {
        formData.append("attachments", attachment.file);
      }
    }
    return formData;
  }

  async function requestEnhancementPreview() {
    if ((!structuredPresetActive && !prompt.trim() && !attachments.length && !sourceAssetId) || (structuredPresetActive && !structuredPresetPromptPreview.trim())) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError("Add a prompt or source media before enhancing.");
      return;
    }
    if (!enhanceEnabledForModel) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError("Enhancement is not enabled for this model.");
      return;
    }
    if (!enhanceConfiguredForModel) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError("Set up prompt enhancement in Settings before using Enhance.");
      return;
    }
    if (!enhanceSupportsText && !enhancementPreviewVisual) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError("Stage an image before running image-aware enhancement.");
      return;
    }
    if (multiShotScriptError) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError(multiShotScriptError);
      return;
    }
    if (presetRequirementError) {
      setEnhanceDialogOpen(true);
      setEnhancePreview(null);
      setEnhanceError(presetRequirementError);
      return;
    }
    setEnhanceDialogOpen(true);
    setEnhanceBusy(true);
    setEnhanceError(null);
    showActivity({ tone: "warning", message: "Loading the enhancement preview.", spinning: true });
    try {
      const response = await fetch("/api/control/media-enhance", {
        method: "POST",
        body: buildMediaFormData("enhance"),
      });
      const payload = (await response.json()) as { ok: false; error?: string } | { ok: true; preview?: MediaEnhancePreviewResponse };
      if (!response.ok || !payload.ok) {
        const errorMessage = "error" in payload ? payload.error ?? "Unable to enhance the prompt." : "Unable to enhance the prompt.";
        setEnhancePreview(null);
        setEnhanceError(errorMessage);
        showActivity({ tone: "danger", message: errorMessage }, { autoHideMs: 4200 });
        return;
      }
      setEnhancePreview(payload.preview ?? null);
      showActivity({ tone: "healthy", message: "Enhancement preview ready." }, { autoHideMs: 2200 });
    } catch {
      setEnhancePreview(null);
      const errorMessage = "The dashboard could not reach the enhance preview route.";
      setEnhanceError(errorMessage);
      showActivity({ tone: "danger", message: errorMessage }, { autoHideMs: 4200 });
    } finally {
      setEnhanceBusy(false);
    }
  }

  function openEnhanceDialog() {
    setEnhanceDialogOpen(true);
    setEnhanceError(null);
    setEnhancePreview(null);
  }

  async function requestValidation({ silent = false }: { silent?: boolean } = {}) {
    if (autoValidateTimerRef.current) {
      window.clearTimeout(autoValidateTimerRef.current);
      autoValidateTimerRef.current = null;
    }
    if ((!structuredPresetActive && !prompt.trim() && !attachments.length && !sourceAssetId) || (structuredPresetActive && !structuredPresetPromptPreview.trim())) {
      setValidation(null);
      return null;
    }
    if (multiShotScriptError) {
      setValidation(null);
      if (!silent) {
        setFormMessage({ tone: "danger", text: multiShotScriptError });
      }
      return null;
    }
    if (presetRequirementError) {
      setValidation(null);
      if (!silent) {
        setFormMessage({ tone: "danger", text: presetRequirementError });
      }
      return null;
    }
    const requestId = validationRequestIdRef.current + 1;
    validationRequestIdRef.current = requestId;
    if (!silent) {
      setBusyState("validate");
      setFormMessage(null);
    }
    try {
      const response = await fetch("/api/control/media", {
        method: "POST",
        body: buildMediaFormData("validate"),
      });
      const payload = (await response.json()) as
        | { ok: false; error?: string }
        | { ok: true; validation?: MediaValidationResponse; success?: string };
      if (requestId !== validationRequestIdRef.current) {
        return null;
      }
      if (!response.ok || !payload.ok) {
        if (!silent) {
          setFormMessage({
            tone: "danger",
            text: "error" in payload ? payload.error ?? "Media request failed." : "Media request failed.",
          });
        }
        return null;
      }
      setValidation(payload.validation ?? null);
      if (!silent) {
        setFormMessage({ tone: "healthy", text: payload.success ?? "Preflight looks good." });
      }
      return payload.validation ?? null;
    } catch {
      if (!silent) {
        setFormMessage({ tone: "danger", text: "The dashboard could not reach the media route." });
      }
      return null;
    } finally {
      if (!silent) {
        setBusyState("idle");
      }
    }
  }

  async function submitMedia(intent: "validate" | "submit") {
    if (intent === "validate") {
      await requestValidation({ silent: false });
      return;
    }
    showActivity(
      {
        tone: "warning",
        message: validationReady ? "Submitting the media job." : "Checking the media request.",
        spinning: true,
      },
      { autoHideMs: 2200 },
    );
    if (!validationReady) {
      const nextValidation = await requestValidation({ silent: false });
      if (!studioValidationReady(nextValidation)) {
        return;
      }
    }
    if (multiShotScriptError) {
      setFormMessage({ tone: "danger", text: multiShotScriptError });
      return;
    }
    if (presetRequirementError) {
      setFormMessage({ tone: "danger", text: presetRequirementError });
      return;
    }
    const optimisticBatch = createOptimisticBatch({
      modelKey,
      taskMode: typeof currentModel?.task_modes?.[0] === "string" ? currentModel.task_modes[0] : null,
      requestedOutputs: Math.max(1, outputCount),
      sourceAssetId,
      requestedPresetKey: currentPreset?.key ?? null,
      promptSummary: ((structuredPresetActive ? structuredPresetPromptPreview : prompt).trim() || "Preparing media generation.").slice(0, 240),
      runningSlotsAvailable: Math.max(
        0,
        maxConcurrentJobs -
          localBatches.reduce(
            (sum, batch) =>
              sum + (batch.jobs ?? []).filter((job) => ["submitted", "running", "processing"].includes(job.status)).length,
            0,
          ),
      ),
    });
    setOptimisticBatches((current) => [optimisticBatch, ...current].slice(0, 6));
    showActivity({ tone: "warning", message: "Submitting the media job.", spinning: true });
    setBusyState(intent);
    setFormMessage(null);
    showFloatingComposerBanner({ tone: "warning", text: "Preparing the job and sending it to the runner." }, 2400);
    try {
      const response = await fetch("/api/control/media", {
        method: "POST",
        body: buildMediaFormData(intent),
      });
      const payload = (await response.json()) as
        | { ok: false; error?: string }
        | { ok: true; success?: string; jobId?: string | null; batchId?: string | null; job?: MediaJob | null; batch?: MediaBatch | null };
      if (!response.ok || !payload.ok) {
        setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
        const message = "error" in payload ? payload.error ?? "Media request failed." : "Media request failed.";
        setFormMessage({ tone: "danger", text: message });
        showFloatingComposerBanner({ tone: "danger", text: message }, 5600);
        showActivity({ tone: "danger", message }, { autoHideMs: 3200 });
        return;
      }
      setValidation(null);
      setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
      if (payload.job) {
        setLocalJobs((current) => [payload.job as MediaJob, ...current.filter((job) => job.job_id !== payload.job?.job_id)].slice(0, 12));
      }
      if (payload.batch) {
        const batch = payload.batch as MediaBatch;
        upsertBatch(batch);
        if (Array.isArray(batch.jobs) && batch.jobs.length) {
          setLocalJobs((current) => {
            const byId = new Map(current.map((job) => [job.job_id, job]));
            for (const job of batch.jobs ?? []) {
              byId.set(job.job_id, job);
            }
            return Array.from(byId.values()).sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 24);
          });
        }
      }
      const successText = payload.success ?? "Media job queued.";
      setFormMessage({ tone: "warning", text: successText });
      showFloatingComposerBanner({ tone: "warning", text: successText }, 2600);
      showActivity({ tone: "healthy", message: successText }, { autoHideMs: 2200 });
      if (payload.batchId) {
        void pollBatch(payload.batchId);
      } else if (payload.jobId) {
        void pollJob(payload.jobId);
      }
    } catch {
      setOptimisticBatches((current) => current.filter((batch) => batch.batch_id !== optimisticBatch.batch_id));
      setFormMessage({ tone: "danger", text: "The dashboard could not reach the media route." });
      showFloatingComposerBanner({ tone: "danger", text: "The dashboard could not reach the media route." }, 5600);
      showActivity({ tone: "danger", message: "The dashboard could not reach the media route." }, { autoHideMs: 3200 });
    } finally {
      setBusyState("idle");
    }
  }

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
    JSON.stringify(Object.fromEntries(Object.entries(presetSlotStates).map(([key, value]) => [key, value.assetId ?? value.file?.name ?? ""]))),
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
      enhanceConfiguredForModel,
      enhanceSetupHref,
      enhanceProviderLabel,
      enhanceProviderModelId,
      enhanceImageAnalysisText,
      enhanceImageAnalysisStatus,
      structuredPresetTextFields,
      structuredPresetImageSlots,
      structuredPresetActive,
      inputPattern,
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
      pricingOptions,
      estimatedCredits,
      estimatedCostUsd,
      generatePriceLabel,
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
      updateOption,
      addFiles,
      addGalleryAssetAsAttachment,
      assignPresetSlotFile,
      assignPresetSlotAsset,
      clearPresetSlot,
      insertPromptSnippet,
      removeAttachment,
      clearComposer,
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
