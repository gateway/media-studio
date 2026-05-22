"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { GalleryKindFilter } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

declare global {
  interface Window {
    __mediaStudioTest?: {
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
    };
  }
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
}: StudioTestHarnessParams) {
  useEffect(() => {
    if (typeof window === "undefined" || !window.navigator.webdriver) {
      return;
    }

    window.__mediaStudioTest = {
      ...(window.__mediaStudioTest ?? {}),
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
      if (Object.keys(window.__mediaStudioTest).length === 0) {
        delete window.__mediaStudioTest;
      }
    };
  }, [
    activateGalleryKindFilter,
    applyEnhancementPromptRef,
    openContextualReferenceLibrary,
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
