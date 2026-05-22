"use client";

import { useCallback, useMemo } from "react";

import {
  buildStudioJobPrimaryInput,
  buildStudioJobReferenceInputs,
  buildStudioReferencePreviews,
  buildStudioRetryRestorePlan,
  type StructuredPresetImageSlot,
} from "@/lib/media-studio-helpers";
import { buildStudioScopedHref } from "@/lib/studio-navigation";
import type {
  MediaAsset,
  MediaBatch,
  MediaJob,
  MediaModelSummary,
  MediaPreset,
  MediaProject,
} from "@/lib/types";

type UseStudioInspectorStateOptions = {
  pathname: string;
  selectedProjectId: string | null;
  selectedFailedJobId: string | null;
  selectedAsset: MediaAsset | null;
  selectedAssetJob: MediaJob | null;
  selectedAssetPresetSlots: StructuredPresetImageSlot[];
  selectedAssetPresetSlotValues: Record<string, unknown>;
  localJobs: MediaJob[];
  localBatches: MediaBatch[];
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
  localProjects: MediaProject[];
  models: MediaModelSummary[];
  presets: MediaPreset[];
  resetInspector: () => void;
  setSelectedFailedJobId: (jobId: string | null) => void;
};

export function useStudioInspectorState({
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
}: UseStudioInspectorStateOptions) {
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

  const selectedAssetProject = useMemo(() => {
    if (!selectedAsset?.project_id) {
      return null;
    }
    return localProjects.find((project) => project.project_id === selectedAsset.project_id) ?? null;
  }, [localProjects, selectedAsset?.project_id]);

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

  const closeAssetInspector = useCallback(() => {
    resetInspector();
    setSelectedFailedJobId(null);
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", buildStudioScopedHref(pathname, selectedProjectId));
    }
  }, [pathname, resetInspector, selectedProjectId, setSelectedFailedJobId]);

  return {
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
  };
}

export type StudioInspectorState = ReturnType<typeof useStudioInspectorState>;
