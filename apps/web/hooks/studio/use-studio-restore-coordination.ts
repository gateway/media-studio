"use client";

import type { Dispatch, SetStateAction } from "react";

import type { StudioComposerController } from "@/hooks/studio/use-studio-composer";
import { useStudioRestoreActions } from "@/hooks/studio/use-studio-restore-actions";
import type { StudioInspectorState } from "@/hooks/studio/use-studio-inspector-state";
import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import type {
  MediaAsset,
  MediaBatch,
  MediaJob,
  MediaModelSummary,
  MediaPreset,
} from "@/lib/types";

type UseStudioRestoreCoordinationOptions = {
  inspector: Pick<
    StudioInspectorState,
    | "selectedFailedJobRetryPlan"
    | "selectedFailedJobPrimaryInput"
    | "selectedFailedJobReferenceInputs"
    | "selectedAssetBatch"
    | "selectedAssetRevisionPlan"
  >;
  composer: StudioComposerController;
  selectedAssetJob: MediaJob | null;
  models: MediaModelSummary[];
  presets: MediaPreset[];
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
  selectedProjectId: string | null;
  setSelectedProjectId: (value: string | null) => void;
  studioHrefForProject: (projectId: string | null, assetId?: string | number | null) => string;
  setLocalAssets: Dispatch<SetStateAction<MediaAsset[]>>;
  setLocalJobs: Dispatch<SetStateAction<MediaJob[]>>;
  upsertBatch: (batch: MediaBatch) => void;
  setSelectedFailedJobId: (value: string | null) => void;
  setSelectedAssetId: (value: string | number | null) => void;
  setSelectedMediaLightboxOpen: (value: boolean) => void;
  clearSelectedReferencePreview: () => void;
  setFormMessage: (message: ComposerStatusMessage) => void;
  revealComposer: (options?: { focusPresetField?: boolean }) => void;
};

export function useStudioRestoreCoordination({
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
  clearSelectedReferencePreview,
  setFormMessage,
  revealComposer,
}: UseStudioRestoreCoordinationOptions) {
  const { retryFailedJobInStudio, reviseSelectedAssetInStudio } = useStudioRestoreActions({
    selectedFailedJobRetryPlan: inspector.selectedFailedJobRetryPlan,
    selectedFailedJobPrimaryInput: inspector.selectedFailedJobPrimaryInput,
    selectedFailedJobReferenceInputs: inspector.selectedFailedJobReferenceInputs,
    selectedAssetJob,
    selectedAssetBatch: inspector.selectedAssetBatch,
    selectedAssetRevisionPlan: inspector.selectedAssetRevisionPlan,
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
    restoreDependencies: {
      clearComposer: composer.actions.clearComposer,
      setModelKey: composer.actions.setModelKey,
      applyPresetSelection: composer.actions.applyPresetSelection,
      setSelectedPresetId: composer.actions.setSelectedPresetId,
      setSelectedPromptIds: composer.actions.setSelectedPromptIds,
      setPrompt: composer.actions.setPrompt,
      setOptionValues: composer.actions.setOptionValues,
      setOutputCount: composer.actions.setOutputCount,
      setValidation: composer.actions.setValidation,
      setBusyState: composer.actions.setBusyState,
      setOpenPicker: composer.actions.setOpenPicker,
      setEnhanceDialogOpen: composer.actions.setEnhanceDialogOpen,
      setEnhancePreview: composer.actions.setEnhancePreview,
      setEnhanceError: composer.actions.setEnhanceError,
      setIsDragActive: composer.actions.setIsDragActive,
      clearSourceAsset: composer.actions.clearSourceAsset,
      setPresetInputValues: composer.actions.setPresetInputValues,
      stageSourceAsset: composer.actions.stageSourceAsset,
      addRestoredFiles: composer.actions.addRestoredFiles,
      addGalleryAssetAsAttachment: composer.actions.addGalleryAssetAsAttachment,
      assignPresetSlotAsset: composer.actions.assignPresetSlotAsset,
      assignPresetSlotFile: composer.actions.assignPresetSlotFile,
      setSelectedFailedJobId,
      setSelectedAssetId,
      setSelectedMediaLightboxOpen,
      setSelectedReferencePreview: clearSelectedReferencePreview,
      setMobileComposerCollapsed: composer.actions.setMobileComposerCollapsed,
      setFormMessage,
      revealComposer,
    },
  });

  return {
    retryFailedJobInStudio,
    reviseSelectedAssetInStudio,
  };
}
