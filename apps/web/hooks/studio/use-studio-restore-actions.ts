"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import {
  restoreComposerFromPlan,
  type RestoreComposerDependencies,
  type StudioRetryPrimaryInput,
  type StudioRetryReferenceInputs,
  type StudioRetryRestorePlan,
} from "@/components/studio/studio-composer-restore";
import {
  buildStudioJobPrimaryInput,
  buildStudioJobReferenceInputs,
  buildStudioRetryRestorePlan,
} from "@/lib/media-studio-helpers";
import type {
  MediaAsset,
  MediaBatch,
  MediaJob,
  MediaModelSummary,
  MediaPreset,
} from "@/lib/types";

type UseStudioRestoreActionsOptions = {
  selectedFailedJobRetryPlan: StudioRetryRestorePlan;
  selectedFailedJobPrimaryInput: StudioRetryPrimaryInput;
  selectedFailedJobReferenceInputs: StudioRetryReferenceInputs;
  selectedAssetJob: MediaJob | null;
  selectedAssetBatch: MediaBatch | null;
  selectedAssetRevisionPlan: StudioRetryRestorePlan;
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
  restoreDependencies: Omit<
    RestoreComposerDependencies,
    | "localAssets"
    | "favoriteAssets"
    | "selectedProjectId"
    | "setSelectedProjectId"
    | "replaceStudioHistory"
    | "setLocalAssets"
    | "fetchAssetById"
  >;
};

async function fetchAssetById(assetId: string | number) {
  const response = await fetch(`/api/control/media-assets/${assetId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; asset?: MediaAsset | null } | null;
  if (!response.ok || !payload?.ok || !payload.asset) {
    throw new Error("Unable to load the selected media asset.");
  }
  return payload.asset;
}

async function fetchJobStateById(jobId: string | number) {
  const response = await fetch(`/api/control/media-jobs/${jobId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        job?: MediaJob | null;
        batch?: MediaBatch | null;
      }
    | null;
  if (!response.ok || !payload?.ok || !payload.job) {
    throw new Error("Unable to load the selected media job.");
  }
  return {
    job: payload.job,
    batch: payload.batch ?? null,
  };
}

export function useStudioRestoreActions({
  selectedFailedJobRetryPlan,
  selectedFailedJobPrimaryInput,
  selectedFailedJobReferenceInputs,
  selectedAssetJob,
  selectedAssetBatch,
  selectedAssetRevisionPlan,
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
  restoreDependencies,
}: UseStudioRestoreActionsOptions) {
  const restoreDependencyBundle = useCallback(
    (): RestoreComposerDependencies => ({
      ...restoreDependencies,
      localAssets,
      favoriteAssets,
      selectedProjectId,
      setSelectedProjectId,
      replaceStudioHistory: (projectId) => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", studioHrefForProject(projectId, null));
        }
      },
      setLocalAssets,
      fetchAssetById,
    }),
    [
      favoriteAssets,
      localAssets,
      restoreDependencies,
      selectedProjectId,
      setLocalAssets,
      setSelectedProjectId,
      studioHrefForProject,
    ],
  );

  const retryFailedJobInStudio = useCallback(
    async (job: MediaJob | null) => {
      if (!job) {
        return;
      }
      await restoreComposerFromPlan({
        plan: selectedFailedJobRetryPlan,
        fallbackPrimaryInput: selectedFailedJobPrimaryInput,
        fallbackReferenceInputs: selectedFailedJobReferenceInputs,
        sourceAssetId: job.source_asset_id ?? null,
        missingModelMessage: "Studio could not find the model used by this failed job.",
        successMessage: "Loaded the failed job back into Studio. Review it and generate again.",
        partialFailureMessage: "Loaded the failed job prompt and settings, but Studio could not restage the original source image.",
        closeAssetInspector: true,
        closeFailedJobInspector: true,
        dependencies: restoreDependencyBundle(),
      });
    },
    [
      restoreDependencyBundle,
      selectedFailedJobPrimaryInput,
      selectedFailedJobReferenceInputs,
      selectedFailedJobRetryPlan,
    ],
  );

  const reviseSelectedAssetInStudio = useCallback(
    async (asset: MediaAsset | null) => {
      if (!asset) {
        return;
      }
      let revisionJob = selectedAssetJob;
      let revisionBatch = selectedAssetBatch;

      if (asset.job_id) {
        try {
          const latestState = await fetchJobStateById(asset.job_id);
          revisionJob = latestState.job;
          revisionBatch = latestState.batch ?? revisionBatch;
          setLocalJobs((current) => [
            latestState.job,
            ...current.filter((job) => job.job_id !== latestState.job.job_id),
          ]);
          if (latestState.batch) {
            upsertBatch(latestState.batch);
          }
        } catch {
          // Fall back to the currently cached job when the refresh endpoint is unavailable.
        }
      }

      const revisionPlan =
        buildStudioRetryRestorePlan({
          job: revisionJob,
          batch: revisionBatch,
          models,
          presets,
          localAssets,
          favoriteAssets,
        }) ?? selectedAssetRevisionPlan;
      const revisionPrimaryInput = buildStudioJobPrimaryInput({
        job: revisionJob,
        localAssets,
        favoriteAssets,
      });
      const revisionReferenceInputs = buildStudioJobReferenceInputs({
        job: revisionJob,
        localAssets,
        favoriteAssets,
      });

      await restoreComposerFromPlan({
        plan: revisionPlan,
        fallbackPrimaryInput: revisionPrimaryInput,
        fallbackReferenceInputs: revisionReferenceInputs,
        sourceAssetId: revisionJob?.source_asset_id ?? selectedAssetJob?.source_asset_id ?? asset.source_asset_id ?? null,
        missingModelMessage: "Studio could not reconstruct this asset into an editable composer state.",
        successMessage: "Loaded this asset back into Studio with its original prompt, references, and settings.",
        partialFailureMessage: "Loaded this asset prompt and settings, but Studio could not restage some of the original reference media.",
        closeAssetInspector: true,
        closeFailedJobInspector: false,
        dependencies: restoreDependencyBundle(),
      });
    },
    [
      favoriteAssets,
      localAssets,
      models,
      presets,
      restoreDependencyBundle,
      selectedAssetBatch,
      selectedAssetJob,
      selectedAssetRevisionPlan,
      setLocalJobs,
      upsertBatch,
    ],
  );

  return {
    retryFailedJobInStudio,
    reviseSelectedAssetInStudio,
  };
}
