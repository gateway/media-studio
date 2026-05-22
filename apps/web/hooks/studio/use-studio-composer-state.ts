import { useState } from "react";

import { type AttachmentRecord, type FloatingComposerStatus } from "@/lib/media-studio-contract";
import { modelSupportsStructuredImagePreset, type PresetSlotState } from "@/lib/media-studio-helpers";
import type { StudioComposerDraft } from "@/lib/studio-composer-draft";
import type { MediaAsset, MediaEnhancePreviewResponse, MediaModelSummary, MediaValidationResponse } from "@/lib/types";

type UseStudioComposerStateParams = {
  initialDraft: StudioComposerDraft | null;
  enabledModels: MediaModelSummary[];
  studioReadyModels: MediaModelSummary[];
  models: MediaModelSummary[];
};

export function useStudioComposerState({
  initialDraft,
  enabledModels,
  studioReadyModels,
  models,
}: UseStudioComposerStateParams) {
  const [modelKey, setModelKey] = useState(
    initialDraft?.modelKey ?? enabledModels[0]?.key ?? studioReadyModels[0]?.key ?? models[0]?.key ?? "nano-banana-2",
  );
  const [selectedPresetId, setSelectedPresetId] = useState(initialDraft?.selectedPresetId ?? "");
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>(initialDraft?.selectedPromptIds ?? []);
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? "");
  const [presetInputValues, setPresetInputValues] = useState<Record<string, string>>(
    initialDraft?.presetInputValues ?? {},
  );
  const [presetSlotStates, setPresetSlotStates] = useState<Record<string, PresetSlotState>>(
    initialDraft?.presetSlotStates ?? {},
  );
  const [optionValues, setOptionValues] = useState<Record<string, unknown>>(initialDraft?.optionValues ?? {});
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhancePreview, setEnhancePreview] = useState<MediaEnhancePreviewResponse | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(initialDraft?.attachments ?? []);
  const [stagedSourceAssetSnapshot, setStagedSourceAssetSnapshot] = useState<MediaAsset | null>(
    initialDraft?.stagedSourceAssetSnapshot ?? null,
  );
  const [isDragActive, setIsDragActive] = useState(false);
  const [validation, setValidation] = useState<MediaValidationResponse | null>(null);
  const [busyState, setBusyState] = useState<"idle" | "validate" | "submit">("idle");
  const [floatingComposerStatus, setFloatingComposerStatus] = useState<FloatingComposerStatus | null>(null);
  const [mobileComposerCollapsed, setMobileComposerCollapsed] = useState(true);
  const [outputCount, setOutputCount] = useState(initialDraft?.outputCount ?? 1);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [lastStructuredPresetModelKey, setLastStructuredPresetModelKey] = useState(
    initialDraft?.lastNanoPresetModelKey ??
      (enabledModels.find((model) => modelSupportsStructuredImagePreset(model, false) || modelSupportsStructuredImagePreset(model, true)) ??
        studioReadyModels.find((model) => modelSupportsStructuredImagePreset(model, false) || modelSupportsStructuredImagePreset(model, true)) ??
        models.find((model) => modelSupportsStructuredImagePreset(model, false) || modelSupportsStructuredImagePreset(model, true)))?.key ??
      "nano-banana-2",
  );

  return {
    values: {
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
    },
    setters: {
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
    },
  };
}
