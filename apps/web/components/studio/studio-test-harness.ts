"use client";

import { useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { AttachmentRecord, GalleryKindFilter } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob, MediaReference } from "@/lib/types";

const STUDIO_MOTION_FIXTURE_VIDEO_DURATION_SECONDS = 20.083333;
const STUDIO_MOTION_FIXTURE_VIDEO_WIDTH = 720;
const STUDIO_MOTION_FIXTURE_VIDEO_HEIGHT = 1280;

export type StudioHarnessFixtureState = {
  composerEnhanceMode?: "setup" | "disabled" | null;
  contextPanels?: boolean;
  galleryEmpty?: boolean;
};

function studioHarnessFixtureImageDataUri(label: string, color = "darkorange") {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="28" fill="black"/><circle cx="112" cy="48" r="24" fill="${color}"/><path d="M24 124 62 82l28 28 18-20 30 34z" fill="greenyellow" opacity=".84"/><text x="24" y="36" fill="white" font-family="Arial" font-size="15" font-weight="700">${label}</text></svg>`,
  )}`;
}

function buildStudioHarnessReference(
  index: number,
  kind: MediaReference["kind"] = "image",
  overrides: Partial<MediaReference> = {},
) {
  const extension = kind === "audio" ? "mp3" : kind === "video" ? "mp4" : "png";
  const imageUrl = kind === "image" ? studioHarnessFixtureImageDataUri(`Ref ${index}`) : null;
  const reference = {
    reference_id: `studio-fixture-reference-${kind}-${index}`,
    kind,
    status: "ready",
    original_filename: `studio-fixture-${kind}-${index}.${extension}`,
    stored_path: `fixtures/studio-fixture-${kind}-${index}.${extension}`,
    mime_type: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
    file_size_bytes: 1024,
    sha256: `studio-fixture-${kind}-${index}`,
    width: kind === "image" ? 160 : null,
    height: kind === "image" ? 160 : null,
    duration_seconds: kind === "image" ? null : 3,
    stored_url: imageUrl,
    thumb_url: imageUrl,
    poster_url: imageUrl,
    usage_count: 0,
    created_at: "2026-06-18T00:00:00.000Z",
  } satisfies MediaReference;
  return { ...reference, ...overrides } satisfies MediaReference;
}

export function buildStudioHarnessAttachment(
  index: number,
  kind: AttachmentRecord["kind"] = "images",
  role: AttachmentRecord["role"] = null,
) {
  const referenceKind = kind === "audios" ? "audio" : kind === "videos" ? "video" : "image";
  const reference = buildStudioHarnessReference(index, referenceKind);
  return {
    id: `studio-fixture-attachment-${kind}-${role ?? "default"}-${index}`,
    file: null,
    kind,
    role,
    previewUrl: reference.thumb_url ?? reference.stored_url ?? null,
    durationSeconds: reference.duration_seconds ?? null,
    referenceId: reference.reference_id,
    referenceRecord: reference,
  } satisfies AttachmentRecord;
}

export function buildStudioHarnessAsset(index: number) {
  const previewUrl = studioHarnessFixtureImageDataUri(`Asset ${index}`, "deepskyblue");
  return {
    asset_id: `studio-fixture-asset-${index}`,
    generation_kind: "image",
    model_key: "studio-fixture",
    prompt_summary: `Fixture source asset ${index}`,
    hero_thumb_url: previewUrl,
    thumb_url: previewUrl,
    stored_url: previewUrl,
    created_at: "2026-06-18T00:00:00.000Z",
  } as MediaAsset;
}

export function buildStudioHarnessMotionVideoAttachment() {
  const posterUrl = studioHarnessFixtureImageDataUri("20.1s video", "crimson");
  const reference = buildStudioHarnessReference(1, "video", {
    reference_id: "studio-fixture-motion-driving-video",
    original_filename: "motion-driving-20s-720x1280.mp4",
    stored_path: "fixtures/motion-driving-20s-720x1280.mp4",
    width: STUDIO_MOTION_FIXTURE_VIDEO_WIDTH,
    height: STUDIO_MOTION_FIXTURE_VIDEO_HEIGHT,
    duration_seconds: STUDIO_MOTION_FIXTURE_VIDEO_DURATION_SECONDS,
    stored_url: "/api/control/files/reference-media/videos/e999def30e2ef482d3aff3d381459ec76f7def3ab4b7b32aa9b62e601240b402.mp4",
    thumb_url: posterUrl,
    poster_url: posterUrl,
  });
  return {
    id: "studio-fixture-motion-driving-video-20s",
    file: null,
    kind: "videos",
    role: null,
    previewUrl: reference.stored_url ?? null,
    durationSeconds: reference.duration_seconds ?? null,
    referenceId: reference.reference_id,
    referenceRecord: reference,
  } satisfies AttachmentRecord;
}

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
