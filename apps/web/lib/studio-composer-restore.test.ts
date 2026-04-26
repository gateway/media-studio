import { describe, expect, it, vi } from "vitest";

import { restoreComposerFromPlan } from "@/components/studio/studio-composer-restore";

function createDependencies(overrides: Partial<Parameters<typeof restoreComposerFromPlan>[0]["dependencies"]> = {}) {
  return {
    localAssets: [],
    favoriteAssets: null,
    selectedProjectId: null,
    setSelectedProjectId: vi.fn(),
    replaceStudioHistory: vi.fn(),
    clearComposer: vi.fn(),
    setModelKey: vi.fn(),
    applyPresetSelection: vi.fn(),
    setSelectedPresetId: vi.fn(),
    setSelectedPromptIds: vi.fn(),
    setPrompt: vi.fn(),
    setOptionValues: vi.fn(),
    setOutputCount: vi.fn(),
    setValidation: vi.fn(),
    setBusyState: vi.fn(),
    setOpenPicker: vi.fn(),
    setEnhanceDialogOpen: vi.fn(),
    setEnhancePreview: vi.fn(),
    setEnhanceError: vi.fn(),
    setIsDragActive: vi.fn(),
    clearSourceAsset: vi.fn(),
    setPresetInputValues: vi.fn(),
    stageSourceAsset: vi.fn(),
    setLocalAssets: vi.fn(),
    fetchAssetById: vi.fn(),
    fetchReferenceFile: vi.fn(),
    addRestoredFiles: vi.fn(),
    addGalleryAssetAsAttachment: vi.fn(),
    assignPresetSlotAsset: vi.fn(),
    assignPresetSlotFile: vi.fn(),
    setSelectedFailedJobId: vi.fn(),
    setSelectedAssetId: vi.fn(),
    setSelectedMediaLightboxOpen: vi.fn(),
    setSelectedReferencePreview: vi.fn(),
    setMobileComposerCollapsed: vi.fn(),
    setFormMessage: vi.fn(),
    revealComposer: vi.fn(),
    ...overrides,
  };
}

describe("studio-composer-restore", () => {
  it("restores an implicit primary image from a saved request file when no source asset id exists", async () => {
    const sourceFile = new File(["image"], "source.png", { type: "image/png" });
    const dependencies = createDependencies({
      fetchReferenceFile: vi.fn().mockResolvedValue(sourceFile),
    });

    await restoreComposerFromPlan({
      plan: {
        targetModel: { key: "kling-2.6-i2v" } as never,
        targetPreset: null,
        projectId: null,
        selectedPromptIds: [],
        prompt: "Restore me",
        presetInputValues: {},
        optionValues: {},
        outputCount: 1,
        primaryInput: {
          assetId: null,
          url: "http://127.0.0.1:3000/source.png",
          kind: "images",
          role: null,
        },
        referenceInputs: [],
        presetSlotRestores: [],
      },
      missingModelMessage: "Missing model",
      successMessage: "Success",
      partialFailureMessage: "Partial",
      dependencies,
    });

    expect(dependencies.fetchReferenceFile).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/source.png",
      "source-image",
      "images",
    );
    expect(dependencies.addRestoredFiles).toHaveBeenCalledWith([sourceFile], {
      role: undefined,
      allowedKinds: ["images"],
      insertImageIndex: 0,
      replaceImageIndex: 0,
    });
    expect(dependencies.setFormMessage).toHaveBeenCalledWith({ tone: "warning", text: "Success" });
  });

  it("prefers a local original-media path over a remote upload url for implicit primary restores", async () => {
    const sourceFile = new File(["image"], "source.png", { type: "image/png" });
    const dependencies = createDependencies({
      fetchReferenceFile: vi.fn().mockResolvedValue(sourceFile),
    });

    await restoreComposerFromPlan({
      plan: {
        targetModel: { key: "kling-3.0-i2v" } as never,
        targetPreset: null,
        projectId: null,
        selectedPromptIds: [],
        prompt: "Restore me",
        presetInputValues: {},
        optionValues: {},
        outputCount: 1,
        primaryInput: {
          assetId: null,
          url: "/api/control/files/reference-media/images/source.png",
          kind: "images",
          role: null,
        },
        referenceInputs: [],
        presetSlotRestores: [],
      },
      missingModelMessage: "Missing model",
      successMessage: "Success",
      partialFailureMessage: "Partial",
      dependencies,
    });

    expect(dependencies.fetchReferenceFile).toHaveBeenCalledWith(
      "/api/control/files/reference-media/images/source.png",
      "source-image",
      "images",
    );
    expect(dependencies.addRestoredFiles).toHaveBeenCalledWith([sourceFile], {
      role: undefined,
      allowedKinds: ["images"],
      insertImageIndex: 0,
      replaceImageIndex: 0,
    });
  });

  it("uses staged gallery assets for reference restores when the asset is already cached locally", async () => {
    const referenceAsset = { asset_id: "asset-ref", generation_kind: "image" } as never;
    const dependencies = createDependencies({
      localAssets: [referenceAsset],
      fetchReferenceFile: vi.fn().mockResolvedValue(new File(["image"], "source.png", { type: "image/png" })),
    });

    await restoreComposerFromPlan({
      plan: {
        targetModel: { key: "nano-banana-2" } as never,
        targetPreset: null,
        projectId: null,
        selectedPromptIds: [],
        prompt: "Retry",
        presetInputValues: {},
        optionValues: {},
        outputCount: 1,
        primaryInput: {
          assetId: null,
          url: "http://127.0.0.1:3000/source.png",
          kind: "images",
          role: null,
        },
        referenceInputs: [
          {
            assetId: "asset-ref",
            url: "http://127.0.0.1:3000/reference.png",
            kind: "images",
            role: "reference",
            label: "Reference image",
          },
        ],
        presetSlotRestores: [],
      },
      missingModelMessage: "Missing model",
      successMessage: "Success",
      partialFailureMessage: "Partial",
      dependencies,
    });

    expect(dependencies.addGalleryAssetAsAttachment).toHaveBeenCalledWith(referenceAsset, null, ["images"], {
      insertImageIndex: 0,
      replaceImageIndex: null,
    });
    expect(dependencies.addRestoredFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps the restore flow alive when reference refetching fails", async () => {
    const dependencies = createDependencies({
      fetchReferenceFile: vi
        .fn()
        .mockResolvedValueOnce(new File(["image"], "source.png", { type: "image/png" }))
        .mockRejectedValueOnce(new Error("missing reference")),
    });

    await restoreComposerFromPlan({
      plan: {
        targetModel: { key: "kling-2.6-i2v" } as never,
        targetPreset: null,
        projectId: null,
        selectedPromptIds: [],
        prompt: "Retry",
        presetInputValues: {},
        optionValues: {},
        outputCount: 1,
        primaryInput: {
          assetId: null,
          url: "http://127.0.0.1:3000/source.png",
          kind: "images",
          role: null,
        },
        referenceInputs: [
          {
            assetId: null,
            url: "http://127.0.0.1:3000/reference.png",
            kind: "images",
            role: "reference",
            label: "Reference image",
          },
        ],
        presetSlotRestores: [],
      },
      missingModelMessage: "Missing model",
      successMessage: "Success",
      partialFailureMessage: "Partial",
      dependencies,
    });

    expect(dependencies.addRestoredFiles).toHaveBeenCalledTimes(1);
    expect(dependencies.revealComposer).toHaveBeenCalledWith({ focusPresetField: false });
    expect(dependencies.setFormMessage).toHaveBeenCalledWith({ tone: "warning", text: "Success" });
  });

  it("restores multiple path-backed image references for reference-only image edit jobs", async () => {
    const referenceFileA = new File(["image-a"], "reference-a.png", { type: "image/png" });
    const referenceFileB = new File(["image-b"], "reference-b.png", { type: "image/png" });
    const dependencies = createDependencies({
      fetchReferenceFile: vi
        .fn()
        .mockResolvedValueOnce(referenceFileA)
        .mockResolvedValueOnce(referenceFileB),
    });

    await restoreComposerFromPlan({
      plan: {
        targetModel: { key: "gpt-image-2-image-to-image" } as never,
        targetPreset: null,
        projectId: null,
        selectedPromptIds: [],
        prompt: "Retry",
        presetInputValues: {},
        optionValues: { aspect_ratio: "9:16", resolution: "2K" },
        outputCount: 1,
        primaryInput: null,
        referenceInputs: [
          {
            assetId: null,
            url: "/api/control/files/uploads/media-studio/source-a.png",
            kind: "images",
            role: "reference",
            label: "Reference 1",
          },
          {
            assetId: null,
            url: "/api/control/files/reference-media/images/source-b.png",
            kind: "images",
            role: "reference",
            label: "Reference 2",
          },
        ],
        presetSlotRestores: [],
      },
      missingModelMessage: "Missing model",
      successMessage: "Success",
      partialFailureMessage: "Partial",
      dependencies,
    });

    expect(dependencies.fetchReferenceFile).toHaveBeenNthCalledWith(
      1,
      "/api/control/files/uploads/media-studio/source-a.png",
      "Reference 1",
      "images",
    );
    expect(dependencies.fetchReferenceFile).toHaveBeenNthCalledWith(
      2,
      "/api/control/files/reference-media/images/source-b.png",
      "Reference 2",
      "images",
    );
    expect(dependencies.addRestoredFiles).toHaveBeenNthCalledWith(1, [referenceFileA, referenceFileB], {
      allowedKinds: ["images"],
      insertImageIndex: 0,
      replaceImageIndex: null,
    });
    expect(dependencies.setFormMessage).toHaveBeenCalledWith({ tone: "warning", text: "Success" });
  });

  it("clears the asset-scoped Studio URL when restoring from the asset inspector", async () => {
    const referenceFile = new File(["image"], "reference.png", { type: "image/png" });
    const dependencies = createDependencies({
      selectedProjectId: "project-1",
      fetchReferenceFile: vi.fn().mockResolvedValue(referenceFile),
    });

    await restoreComposerFromPlan({
      plan: {
        targetModel: { key: "gpt-image-2-image-to-image" } as never,
        targetPreset: null,
        projectId: "project-1",
        selectedPromptIds: [],
        prompt: "Retry",
        presetInputValues: {},
        optionValues: {},
        outputCount: 1,
        primaryInput: null,
        referenceInputs: [
          {
            assetId: null,
            url: "/api/control/files/reference-media/images/reference.png",
            kind: "images",
            role: "reference",
            label: "Reference 1",
          },
        ],
        presetSlotRestores: [],
      },
      missingModelMessage: "Missing model",
      successMessage: "Success",
      partialFailureMessage: "Partial",
      closeAssetInspector: true,
      dependencies,
    });

    expect(dependencies.replaceStudioHistory).toHaveBeenCalledWith("project-1");
    expect(dependencies.setSelectedAssetId).toHaveBeenCalledWith(null);
    expect(dependencies.setSelectedMediaLightboxOpen).toHaveBeenCalledWith(false);
    expect(dependencies.setSelectedReferencePreview).toHaveBeenCalledWith(null);
    expect(dependencies.revealComposer).toHaveBeenCalledWith({ focusPresetField: false });
  });
});
