// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";

import {
  type StudioTestFixtureControls,
  useStudioShellHandoffSnapshot,
  useStudioTestHarness,
} from "@/components/studio/studio-test-harness";
import type { GalleryKindFilter } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaBatch, MediaJob } from "@/lib/types";

const emptyEnhancementPreview = vi.fn(async () => undefined);
const emptyEnhancementApply = vi.fn(() => false);

function setWebdriver(enabled: boolean) {
  Object.defineProperty(window.navigator, "webdriver", {
    configurable: true,
    value: enabled,
  });
}

function buildAsset(assetId: string, projectId = "project-1"): MediaAsset {
  return {
    asset_id: assetId,
    project_id: projectId,
    generation_kind: "image",
    created_at: "2026-06-12T00:00:00.000Z",
  } as MediaAsset;
}

function Harness({
  projectId = "project-1",
  fixtures,
}: {
  projectId?: string | null;
  fixtures?: StudioTestFixtureControls;
}) {
  const [modelKey, setModelKey] = useState("gpt-image-2");
  const [localAssets, setLocalAssets] = useState<MediaAsset[]>([
    buildAsset("asset-one"),
  ]);
  const [localJobs, setLocalJobs] = useState<MediaJob[]>([]);
  const [localBatches, setLocalBatches] = useState<MediaBatch[]>([]);
  const [selectedFailedJobId, setSelectedFailedJobId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | number | null>("asset-one");
  const [selectedMediaLightboxOpen, setSelectedMediaLightboxOpen] = useState(false);
  const [galleryKindFilter, setGalleryKindFilter] = useState<GalleryKindFilter>("image");
  const [galleryModelFilter, setGalleryModelFilter] = useState("gpt-image-2");

  const openEnhanceDialogRef = useRef(() => undefined);
  const requestEnhancementPreviewRef = useRef(emptyEnhancementPreview);
  const applyEnhancementPromptRef = useRef(emptyEnhancementApply);

  const handoffSnapshot = useStudioShellHandoffSnapshot({
    projectId,
    assetIds: localAssets.map((asset) => asset.asset_id),
    selectedAssetId,
    modelKey,
    selectedPresetId: "preset-1",
    prompt: "Generate a studio handoff fixture",
    attachmentCount: 0,
    openPicker: null,
    kindFilter: galleryKindFilter,
    modelFilter: galleryModelFilter,
    favoritesOnly: false,
    hasMore: true,
    loadingMore: false,
    tileCount: localAssets.length,
  });

  useStudioTestHarness({
    setModelKey,
    setLocalAssets,
    setLocalJobs,
    setLocalBatches,
    setSelectedFailedJobId,
    setSelectedAssetId,
    setSelectedMediaLightboxOpen,
    activateGalleryKindFilter: setGalleryKindFilter,
    setGalleryModelFilter,
    openContextualReferenceLibrary: vi.fn(),
    openEnhanceDialogRef,
    requestEnhancementPreviewRef,
    applyEnhancementPromptRef,
    handoffSnapshot,
    fixtures,
  });

  return (
    <div>
      <div data-testid="selected-failed-job">{selectedFailedJobId ?? ""}</div>
      <div data-testid="lightbox">{selectedMediaLightboxOpen ? "open" : "closed"}</div>
      <div data-testid="jobs">{localJobs.length}</div>
      <div data-testid="batches">{localBatches.length}</div>
    </div>
  );
}

describe("useStudioTestHarness", () => {
  beforeEach(() => {
    setWebdriver(true);
  });

  afterEach(() => {
    cleanup();
    delete window.__mediaStudioTest;
    setWebdriver(false);
    vi.clearAllMocks();
  });

  it("exposes Studio shell handoff state and keeps existing test actions wired", async () => {
    render(<Harness />);

    await waitFor(() => expect(window.__mediaStudioTest?.handoff).toBeTruthy());

    expect(window.__mediaStudioTest?.handoff?.snapshot()).toMatchObject({
      projectId: "project-1",
      assetIds: ["asset-one"],
      selectedAssetId: "asset-one",
      composer: {
        modelKey: "gpt-image-2",
        selectedPresetId: "preset-1",
        prompt: "Generate a studio handoff fixture",
      },
      gallery: {
        kindFilter: "image",
        modelFilter: "gpt-image-2",
        hasMore: true,
        tileCount: 1,
      },
    });

    act(() => {
      window.__mediaStudioTest?.gallery?.seedAssets([
        buildAsset("asset-two"),
        buildAsset("asset-three"),
      ]);
    });

    await waitFor(() =>
      expect(window.__mediaStudioTest?.handoff?.snapshot()).toMatchObject({
        assetIds: ["asset-two", "asset-three"],
        selectedAssetId: null,
        gallery: {
          kindFilter: "all",
          modelFilter: "all",
          tileCount: 2,
        },
      }),
    );

    act(() => {
      window.__mediaStudioTest?.gallery?.openLightbox("asset-three");
      window.__mediaStudioTest?.composer?.setModel("seedance-2");
    });

    await waitFor(() =>
      expect(window.__mediaStudioTest?.handoff?.snapshot()).toMatchObject({
        selectedAssetId: "asset-three",
        composer: { modelKey: "seedance-2" },
      }),
    );
  });

  it("exposes query-gated fixture controls when provided", async () => {
    const fixtures: StudioTestFixtureControls = {
      reset: vi.fn(),
      mountPromptReferencePicker: vi.fn(() => ({ ok: true })),
      mountComposerEnhanceSetup: vi.fn(() => ({ ok: true })),
      mountComposerEnhanceDisabled: vi.fn(() => ({ ok: true })),
      mountContextPanels: vi.fn(() => ({ ok: true })),
      mountGalleryEmptyState: vi.fn(() => ({ ok: true })),
      mountMotionControlVideo: vi.fn(() => ({ ok: true })),
      mountMobileInputs: vi.fn(() => ({ ok: true })),
    };

    render(<Harness fixtures={fixtures} />);

    await waitFor(() => expect(window.__mediaStudioTest?.fixtures).toBe(fixtures));

    expect(window.__mediaStudioTest?.fixtures?.mountMotionControlVideo()).toEqual({ ok: true });
    expect(window.__mediaStudioTest?.fixtures?.mountMotionControlVideo("kling-2.6-motion")).toEqual({ ok: true });
    expect(fixtures.mountMotionControlVideo).toHaveBeenLastCalledWith("kling-2.6-motion");
    expect(fixtures.mountMotionControlVideo).toHaveBeenCalledTimes(2);
  });
});
