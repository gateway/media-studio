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

    expect(dependencies.addGalleryAssetAsAttachment).toHaveBeenCalledWith(referenceAsset, "reference", ["images"]);
    expect(dependencies.addRestoredFiles).toHaveBeenCalledTimes(1);
  });
});
