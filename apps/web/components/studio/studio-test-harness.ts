"use client";

import { useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { GalleryKindFilter } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

export type StudioShellHandoffSnapshot = {
  projectId: string | null;
  assetIds: Array<string | number>;
  selectedAssetId: string | number | null;
  composer: {
    modelKey: string | null;
    selectedPresetId: string | null;
    prompt: string;
    attachmentCount: number;
    openPicker: string | null;
  };
  gallery: {
    kindFilter: GalleryKindFilter;
    modelFilter: string;
    favoritesOnly: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    tileCount: number;
  };
};

export type StudioFixtureMountResult = {
  ok: boolean;
  reason?: string;
};

export type StudioTestFixtureControls = {
  reset: () => void;
  mountPromptReferencePicker: () => StudioFixtureMountResult;
  mountComposerEnhanceSetup: () => StudioFixtureMountResult;
  mountComposerEnhanceDisabled: () => StudioFixtureMountResult;
  mountContextPanels: () => StudioFixtureMountResult;
  mountGalleryEmptyState: () => StudioFixtureMountResult;
  mountMotionControlVideo: (modelKey?: string) => StudioFixtureMountResult;
  mountMobileInputs: (mode?: "multi-image" | "seedance" | "standard" | "generic") => StudioFixtureMountResult;
};

type StudioShellHandoffSnapshotParams = {
  projectId: string | null;
  assetIds: Array<string | number>;
  selectedAssetId: string | number | null;
  modelKey: string | null;
  selectedPresetId: string | null;
  prompt: string;
  attachmentCount: number;
  openPicker: string | null;
  kindFilter: GalleryKindFilter;
  modelFilter: string;
  favoritesOnly: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  tileCount: number;
};

export function useStudioShellHandoffSnapshot({
  projectId,
  assetIds,
  selectedAssetId,
  modelKey,
  selectedPresetId,
  prompt,
  attachmentCount,
  openPicker,
  kindFilter,
  modelFilter,
  favoritesOnly,
  hasMore,
  loadingMore,
  tileCount,
}: StudioShellHandoffSnapshotParams): StudioShellHandoffSnapshot {
  return useMemo(
    () => ({
      projectId,
      assetIds,
      selectedAssetId,
      composer: {
        modelKey,
        selectedPresetId,
        prompt,
        attachmentCount,
        openPicker,
      },
      gallery: {
        kindFilter,
        modelFilter,
        favoritesOnly,
        hasMore,
        loadingMore,
        tileCount,
      },
    }),
    [
      assetIds,
      attachmentCount,
      favoritesOnly,
      hasMore,
      kindFilter,
      loadingMore,
      modelFilter,
      modelKey,
      openPicker,
      projectId,
      prompt,
      selectedAssetId,
      selectedPresetId,
      tileCount,
    ],
  );
}

declare global {
  interface Window {
    __mediaStudioTest?: {
      handoff?: {
        snapshot: () => StudioShellHandoffSnapshot;
      };
      composer?: {
        setModel: (modelKey: string) => void;
      };
      gallery?: {
        seedAssets: (assets: MediaAsset[]) => void;
        openLightbox: (assetId: string | number) => void;
      };
      library?: {
        open: () => void;
      };
      failedJob?: {
        seedAndOpen: (job: MediaJob, batch?: MediaBatch | null) => void;
      };
      assetInspector?: {
        seedAndOpen: (payload: {
          asset: MediaAsset;
          job?: MediaJob | null;
          batch?: MediaBatch | null;
          assets?: MediaAsset[];
          jobs?: MediaJob[];
        }) => void;
      };
      enhancement?: {
        openDialog: () => void;
        requestPreview: () => Promise<void>;
        usePrompt: () => boolean;
      };
      fixtures?: StudioTestFixtureControls;
    };
  }
}

function studioTestHarnessEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.navigator.webdriver) {
    return true;
  }
  const hostname = window.location.hostname;
  const localDevHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return localDevHost && new URLSearchParams(window.location.search).get("studioTestHarness") === "1";
}

type StudioTestHarnessParams = {
  setModelKey: (modelKey: string) => void;
  setLocalAssets: Dispatch<SetStateAction<MediaAsset[]>>;
  setLocalJobs: Dispatch<SetStateAction<MediaJob[]>>;
  setLocalBatches: Dispatch<SetStateAction<MediaBatch[]>>;
  setSelectedFailedJobId: Dispatch<SetStateAction<string | null>>;
  setSelectedAssetId: Dispatch<SetStateAction<string | number | null>>;
  setSelectedMediaLightboxOpen: Dispatch<SetStateAction<boolean>>;
  activateGalleryKindFilter: (filter: GalleryKindFilter) => void;
  setGalleryModelFilter: Dispatch<SetStateAction<string>>;
  openContextualReferenceLibrary: () => void;
  openEnhanceDialogRef: MutableRefObject<() => void>;
  requestEnhancementPreviewRef: MutableRefObject<() => Promise<void>>;
  applyEnhancementPromptRef: MutableRefObject<() => boolean>;
  handoffSnapshot: StudioShellHandoffSnapshot;
  fixtures?: StudioTestFixtureControls;
};

export function useStudioTestHarness({
  setModelKey,
  setLocalAssets,
  setLocalJobs,
  setLocalBatches,
  setSelectedFailedJobId,
  setSelectedAssetId,
  setSelectedMediaLightboxOpen,
  activateGalleryKindFilter,
  setGalleryModelFilter,
  openContextualReferenceLibrary,
  openEnhanceDialogRef,
  requestEnhancementPreviewRef,
  applyEnhancementPromptRef,
  handoffSnapshot,
  fixtures,
}: StudioTestHarnessParams) {
  useEffect(() => {
    if (!studioTestHarnessEnabled()) {
      return;
    }

    window.__mediaStudioTest = {
      ...(window.__mediaStudioTest ?? {}),
      handoff: {
        snapshot: () => handoffSnapshot,
      },
      composer: {
        setModel: (nextModelKey) => setModelKey(nextModelKey),
      },
      gallery: {
        seedAssets: (seedAssets) => {
          setLocalAssets(seedAssets);
          setSelectedFailedJobId(null);
          setSelectedAssetId(null);
          setSelectedMediaLightboxOpen(false);
          activateGalleryKindFilter("all");
          setGalleryModelFilter("all");
        },
        openLightbox: (assetId) => {
          setSelectedFailedJobId(null);
          setSelectedAssetId(assetId);
          setSelectedMediaLightboxOpen(true);
        },
      },
      library: {
        open: () => openContextualReferenceLibrary(),
      },
      failedJob: {
        seedAndOpen: (job, batch = null) => {
          if (batch) {
            setLocalBatches((current) =>
              [batch, ...current.filter((entry) => entry.batch_id !== batch.batch_id)].slice(0, 12),
            );
          }
          setLocalJobs((current) => [job, ...current.filter((entry) => entry.job_id !== job.job_id)].slice(0, 24));
          setSelectedFailedJobId(job.job_id);
        },
      },
      assetInspector: {
        seedAndOpen: ({ asset, job = null, batch = null, assets = [], jobs = [] }) => {
          const nextAssets = [asset, ...assets];
          setLocalAssets((current) => [
            ...nextAssets,
            ...current.filter((entry) => !nextAssets.some((seeded) => String(seeded.asset_id) === String(entry.asset_id))),
          ]);
          if (batch) {
            setLocalBatches((current) =>
              [batch, ...current.filter((entry) => entry.batch_id !== batch.batch_id)].slice(0, 12),
            );
          }
          const nextJobs = [...(job ? [job] : []), ...jobs];
          if (nextJobs.length) {
            setLocalJobs((current) => [
              ...nextJobs,
              ...current.filter((entry) => !nextJobs.some((seeded) => seeded.job_id === entry.job_id)),
            ].slice(0, 24));
          }
          setSelectedFailedJobId(null);
          setSelectedMediaLightboxOpen(false);
          setSelectedAssetId(asset.asset_id);
          activateGalleryKindFilter("all");
          setGalleryModelFilter("all");
        },
      },
      enhancement: {
        openDialog: () => openEnhanceDialogRef.current(),
        requestPreview: () => requestEnhancementPreviewRef.current(),
        usePrompt: () => applyEnhancementPromptRef.current(),
      },
      fixtures,
    };

    return () => {
      if (!window.__mediaStudioTest) {
        return;
      }
      delete window.__mediaStudioTest.composer;
      delete window.__mediaStudioTest.gallery;
      delete window.__mediaStudioTest.library;
      delete window.__mediaStudioTest.failedJob;
      delete window.__mediaStudioTest.assetInspector;
      delete window.__mediaStudioTest.enhancement;
      delete window.__mediaStudioTest.fixtures;
      delete window.__mediaStudioTest.handoff;
      if (Object.keys(window.__mediaStudioTest).length === 0) {
        delete window.__mediaStudioTest;
      }
    };
  }, [
    activateGalleryKindFilter,
    applyEnhancementPromptRef,
    fixtures,
    openContextualReferenceLibrary,
    handoffSnapshot,
    openEnhanceDialogRef,
    requestEnhancementPreviewRef,
    setGalleryModelFilter,
    setLocalAssets,
    setLocalBatches,
    setLocalJobs,
    setModelKey,
    setSelectedAssetId,
    setSelectedFailedJobId,
    setSelectedMediaLightboxOpen,
  ]);
}
