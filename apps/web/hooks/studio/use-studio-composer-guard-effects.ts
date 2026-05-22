import { useEffect } from "react";

import type { AttachmentRecord, ComposerStatusMessage } from "@/lib/media-studio-contract";
import {
  buildNormalizedStudioOptions,
  type PresetSlotState,
  type StructuredPresetTextField,
} from "@/lib/media-studio-helpers";
import type { MediaAsset, MediaModelSummary } from "@/lib/types";

type StudioComposerGuardEffectsOptions = {
  models: MediaModelSummary[];
  enabledModels: MediaModelSummary[];
  studioReadyModels: MediaModelSummary[];
  currentModel: MediaModelSummary | null;
  currentModelExposed: boolean;
  currentModelEnabled: boolean;
  currentModelSupportsStructuredPresets: boolean;
  modelKey: string;
  modelMaxOutputs: number;
  selectedPresetId: string;
  currentPresetId?: string | null;
  currentPresetDefaultOptions: Record<string, unknown> | null;
  currentPresetCompatibleWithModel: boolean;
  structuredPresetTextFields: StructuredPresetTextField[];
  seedanceComposer: boolean;
  sourceAssetId: string | number | null;
  resolvedSourceAsset: MediaAsset | null;
  currentSourceAsset: MediaAsset | null;
  maxImageInputs: number;
  maxVideoInputs: number;
  maxAudioInputs: number;
  attachments: AttachmentRecord[];
  presetSlotStates: Record<string, PresetSlotState>;
  setModelKey: (value: string) => void;
  setSelectedPresetId: (value: string) => void;
  setSelectedPromptIds: (value: string[]) => void;
  setValidation: (value: null) => void;
  setFormMessage: React.Dispatch<React.SetStateAction<ComposerStatusMessage | null>>;
  setStagedSourceAssetSnapshot: React.Dispatch<React.SetStateAction<MediaAsset | null>>;
  setSourceAssetId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setLastStructuredPresetModelKey: (value: string) => void;
  setOutputCount: React.Dispatch<React.SetStateAction<number>>;
  setOptionValues: (value: Record<string, unknown>) => void;
  setPresetInputValues: (value: Record<string, string>) => void;
  setPresetSlotStates: React.Dispatch<React.SetStateAction<Record<string, PresetSlotState>>>;
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentRecord[]>>;
};

export function useStudioComposerGuardEffects({
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
  currentPresetId,
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
}: StudioComposerGuardEffectsOptions) {
  useEffect(() => {
    if (currentModelExposed) {
      return;
    }
    const fallbackKey = enabledModels[0]?.key ?? studioReadyModels[0]?.key ?? models[0]?.key ?? "nano-banana-2";
    if (fallbackKey === modelKey) {
      return;
    }
    setModelKey(fallbackKey);
    setSelectedPresetId("");
    setSelectedPromptIds([]);
    setValidation(null);
    setFormMessage({
      tone: "warning",
      text: currentModel?.studio_hidden_reason || "Studio hid that model because its current input contract is not supported yet.",
    });
  }, [
    currentModel?.studio_hidden_reason,
    currentModelExposed,
    enabledModels,
    modelKey,
    models,
    setFormMessage,
    studioReadyModels,
  ]);

  useEffect(() => {
    if (currentModelEnabled) {
      return;
    }
    const fallbackKey = enabledModels[0]?.key ?? models[0]?.key ?? "nano-banana-2";
    if (fallbackKey === modelKey) {
      return;
    }
    setModelKey(fallbackKey);
    setSelectedPresetId("");
    setSelectedPromptIds([]);
    setValidation(null);
    setFormMessage({
      tone: "warning",
      text: "That model is disabled in Settings, so Studio switched to an enabled model.",
    });
  }, [currentModelEnabled, enabledModels, modelKey, models, setFormMessage, studioReadyModels]);

  useEffect(() => {
    if (sourceAssetId == null) {
      setStagedSourceAssetSnapshot(null);
      return;
    }
    if (resolvedSourceAsset) {
      setStagedSourceAssetSnapshot(resolvedSourceAsset);
    }
  }, [resolvedSourceAsset, sourceAssetId]);

  useEffect(() => {
    if (!currentModelSupportsStructuredPresets) {
      return;
    }
    setLastStructuredPresetModelKey(modelKey);
  }, [currentModelSupportsStructuredPresets, modelKey]);

  useEffect(() => {
    setOutputCount((current) => Math.min(Math.max(1, current), modelMaxOutputs));
  }, [modelMaxOutputs]);

  useEffect(() => {
    setOptionValues(
      buildNormalizedStudioOptions(currentModel, {}, currentPresetDefaultOptions),
    );
  }, [currentModel, currentPresetDefaultOptions, currentPresetId, modelKey]);

  useEffect(() => {
    if (!selectedPresetId || currentPresetCompatibleWithModel) {
      return;
    }
    setSelectedPresetId("");
    setPresetInputValues({});
    setPresetSlotStates((current) => {
      for (const state of Object.values(current)) {
        if (state?.previewUrl && state.file) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
      return {};
    });
    setValidation(null);
  }, [currentPresetCompatibleWithModel, selectedPresetId]);

  useEffect(() => {
    if (seedanceComposer && sourceAssetId != null) {
      setStagedSourceAssetSnapshot(null);
      setSourceAssetId(null);
    }
  }, [seedanceComposer, setSourceAssetId, sourceAssetId]);

  useEffect(() => {
    const nextValues: Record<string, string> = {};
    for (const field of structuredPresetTextFields) {
      nextValues[field.key] = field.defaultValue ?? "";
    }
    setPresetInputValues(nextValues);
    setPresetSlotStates((current) => {
      for (const state of Object.values(current)) {
        if (state?.previewUrl && state.file) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
      return {};
    });
  }, [currentPresetId, structuredPresetTextFields]);

  useEffect(() => {
    return () => {
      for (const attachment of attachments) {
        if (attachment.previewUrl && attachment.file) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      for (const state of Object.values(presetSlotStates)) {
        if (state?.previewUrl && state.file) {
          URL.revokeObjectURL(state.previewUrl);
        }
      }
    };
  }, [attachments, presetSlotStates]);

  useEffect(() => {
    const sourceKind = currentSourceAsset?.generation_kind ?? null;
    if ((sourceKind === "image" && maxImageInputs <= 0) || (sourceKind === "video" && maxVideoInputs <= 0)) {
      setStagedSourceAssetSnapshot(null);
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
            if (attachment.previewUrl && attachment.file) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
            continue;
          }
          remainingImages -= 1;
        } else if (attachment.kind === "videos") {
          if (remainingVideos <= 0) {
            changed = true;
            if (attachment.previewUrl && attachment.file) {
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
}
