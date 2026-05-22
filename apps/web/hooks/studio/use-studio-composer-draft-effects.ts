import { useEffect, useLayoutEffect } from "react";

import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { writeStudioComposerDraft, type StudioComposerDraft } from "@/lib/studio-composer-draft";
import { buildAttachmentPreviewUrl } from "@/lib/studio-composer-file-utils";
import type { PresetSlotState } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";

type StudioComposerDraftEffectsOptions = {
  initialDraft: StudioComposerDraft | null;
  persistenceEnabled?: boolean;
  sourceAssetId: string | number | null;
  modelKey: string;
  selectedPresetId: string;
  selectedPromptIds: string[];
  prompt: string;
  presetInputValues: Record<string, string>;
  presetSlotStates: Record<string, PresetSlotState>;
  optionValues: Record<string, unknown>;
  attachments: AttachmentRecord[];
  stagedSourceAssetSnapshot: MediaAsset | null;
  outputCount: number;
  lastStructuredPresetModelKey: string;
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentRecord[]>>;
  setPresetSlotStates: React.Dispatch<React.SetStateAction<Record<string, PresetSlotState>>>;
};

export function useStudioComposerDraftEffects({
  initialDraft,
  persistenceEnabled = true,
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
}: StudioComposerDraftEffectsOptions) {
  useEffect(() => {
    if (!initialDraft) {
      return;
    }
    const draft = initialDraft;
    let active = true;
    async function refreshDraftPreviews() {
      const refreshedAttachments = await Promise.all(
        (draft.attachments ?? []).map(async (attachment) => {
          if (!attachment.file) {
            return attachment;
          }
          return {
            ...attachment,
            previewUrl: await buildAttachmentPreviewUrl(attachment.file),
          };
        }),
      );
      const refreshedPresetEntries = await Promise.all(
        Object.entries(draft.presetSlotStates ?? {}).map(async ([slotKey, state]) => {
          if (!state?.file) {
            return [slotKey, state] as const;
          }
          return [
            slotKey,
            {
              ...state,
              previewUrl: state.file.type.startsWith("image/") ? URL.createObjectURL(state.file) : null,
            },
          ] as const;
        }),
      );
      if (!active) {
        for (const attachment of refreshedAttachments) {
          if (attachment.file && attachment.previewUrl) {
            URL.revokeObjectURL(attachment.previewUrl);
          }
        }
        for (const [, state] of refreshedPresetEntries) {
          if (state?.file && state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
          }
        }
        return;
      }
      setAttachments(refreshedAttachments);
      setPresetSlotStates(Object.fromEntries(refreshedPresetEntries));
    }
    void refreshDraftPreviews();
    return () => {
      active = false;
    };
  }, [initialDraft, setAttachments, setPresetSlotStates]);

  useLayoutEffect(() => {
    if (!persistenceEnabled) {
      return;
    }
    writeStudioComposerDraft({
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
      lastNanoPresetModelKey: lastStructuredPresetModelKey,
    });
  }, [
    attachments,
    lastStructuredPresetModelKey,
    modelKey,
    optionValues,
    persistenceEnabled,
    outputCount,
    presetInputValues,
    presetSlotStates,
    prompt,
    selectedPresetId,
    selectedPromptIds,
    sourceAssetId,
    stagedSourceAssetSnapshot,
  ]);
}
