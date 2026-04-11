import type { AttachmentRecord } from "@/lib/media-studio-contract";
import type { PresetSlotState } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";

export type StudioComposerDraft = {
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
  lastNanoPresetModelKey: string;
};

const STUDIO_COMPOSER_DRAFT_STORAGE_KEY = "media-studio:composer-draft";

declare global {
  interface Window {
    __mediaStudioComposerDraft?: StudioComposerDraft | null;
  }
}

function clonePresetSlotStates(source: Record<string, PresetSlotState>) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      value
        ? {
            assetId: value.assetId ?? null,
            referenceId: value.referenceId ?? null,
            referenceRecord: value.referenceRecord ?? null,
            file: value.file ?? null,
            previewUrl: value.file ? null : value.previewUrl ?? null,
          }
        : value,
    ]),
  ) as Record<string, PresetSlotState>;
}

function cloneAttachments(source: AttachmentRecord[]) {
  return source.map((attachment) => ({
    ...attachment,
    previewUrl: attachment.file ? null : attachment.previewUrl ?? null,
  }));
}

function cloneDraft(draft: StudioComposerDraft | null) {
  if (!draft) {
    return null;
  }
  return {
    sourceAssetId: draft.sourceAssetId ?? null,
    modelKey: draft.modelKey,
    selectedPresetId: draft.selectedPresetId,
    selectedPromptIds: [...draft.selectedPromptIds],
    prompt: draft.prompt,
    presetInputValues: { ...draft.presetInputValues },
    presetSlotStates: clonePresetSlotStates(draft.presetSlotStates),
    optionValues: { ...draft.optionValues },
    attachments: cloneAttachments(draft.attachments),
    stagedSourceAssetSnapshot: draft.stagedSourceAssetSnapshot ? { ...draft.stagedSourceAssetSnapshot } : null,
    outputCount: draft.outputCount,
    lastNanoPresetModelKey: draft.lastNanoPresetModelKey,
  } satisfies StudioComposerDraft;
}

function buildSessionDraft(draft: StudioComposerDraft | null) {
  if (!draft) {
    return null;
  }
  return {
    sourceAssetId: draft.sourceAssetId ?? null,
    modelKey: draft.modelKey,
    selectedPresetId: draft.selectedPresetId,
    selectedPromptIds: [...draft.selectedPromptIds],
    prompt: draft.prompt,
    presetInputValues: { ...draft.presetInputValues },
    presetSlotStates: Object.fromEntries(
      Object.entries(draft.presetSlotStates).flatMap(([key, value]) =>
        value && !value.file
          ? [
              [
                key,
                {
                  assetId: value.assetId ?? null,
                  referenceId: value.referenceId ?? null,
                  referenceRecord: value.referenceRecord ?? null,
                  file: null,
                  previewUrl: value.previewUrl ?? null,
                } satisfies PresetSlotState,
              ],
            ]
          : [],
      ),
    ) as Record<string, PresetSlotState>,
    optionValues: { ...draft.optionValues },
    attachments: draft.attachments
      .filter((attachment) => !attachment.file)
      .map((attachment) => ({
        ...attachment,
        file: null,
        previewUrl: attachment.previewUrl ?? null,
      })),
    stagedSourceAssetSnapshot: draft.stagedSourceAssetSnapshot ? { ...draft.stagedSourceAssetSnapshot } : null,
    outputCount: draft.outputCount,
    lastNanoPresetModelKey: draft.lastNanoPresetModelKey,
  } satisfies StudioComposerDraft;
}

function readSessionDraft() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(STUDIO_COMPOSER_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StudioComposerDraft | null;
    return cloneDraft(parsed);
  } catch {
    return null;
  }
}

export function readStudioComposerDraft() {
  if (typeof window === "undefined") {
    return null;
  }
  return cloneDraft(window.__mediaStudioComposerDraft ?? null) ?? readSessionDraft();
}

export function writeStudioComposerDraft(draft: StudioComposerDraft | null) {
  if (typeof window === "undefined") {
    return;
  }
  window.__mediaStudioComposerDraft = cloneDraft(draft);
  if (!draft) {
    window.sessionStorage.removeItem(STUDIO_COMPOSER_DRAFT_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(STUDIO_COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify(buildSessionDraft(draft)));
}
