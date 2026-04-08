import { describe, expect, it } from "vitest";

import {
  buildStudioReferencePreviews,
  classifyFile,
  deriveSeedanceComposerMode,
  inferInputPattern,
  orderedImageInputVisual,
  resolveEnhancementPreviewVisual,
  seedanceReferenceTokenGuide,
} from "./media-studio-helpers";

describe("media-studio-helpers Seedance support", () => {
  const seedanceModel = {
    key: "seedance-2.0",
    input_patterns: ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"],
    prompt: {
      default_profile_keys_by_input_pattern: {
        prompt_only: "seedance_2_0_t2v_v1",
        single_image: "seedance_2_0_first_frame_v1",
        first_last_frames: "seedance_2_0_first_last_frame_v1",
        multimodal_reference: "seedance_2_0_multimodal_reference_v1",
      },
    },
  } as never;

  it("resolves text-only Seedance as prompt_only", () => {
    expect(inferInputPattern(seedanceModel, [], null)).toBe("prompt_only");
    expect(deriveSeedanceComposerMode([], null)).toBe("text_only");
  });

  it("resolves first-frame Seedance inputs as single_image", () => {
    const attachments = [{ kind: "images", role: "first_frame" }] as never;
    expect(inferInputPattern(seedanceModel, attachments, null)).toBe("single_image");
    expect(deriveSeedanceComposerMode(attachments, null)).toBe("first_frame");
  });

  it("resolves first and last frame Seedance inputs as first_last_frames", () => {
    const attachments = [
      { kind: "images", role: "first_frame" },
      { kind: "images", role: "last_frame" },
    ] as never;
    expect(inferInputPattern(seedanceModel, attachments, null)).toBe("first_last_frames");
    expect(deriveSeedanceComposerMode(attachments, null)).toBe("first_last_frames");
  });

  it("resolves reference media as multimodal_reference", () => {
    const attachments = [
      { kind: "images", role: "reference" },
      { kind: "videos", role: "reference" },
      { kind: "audios", role: "reference" },
    ] as never;
    expect(inferInputPattern(seedanceModel, attachments, null)).toBe("multimodal_reference");
    expect(deriveSeedanceComposerMode(attachments, null)).toBe("multimodal_reference");
  });

  it("builds deterministic Seedance prompt tokens in staged order", () => {
    const attachments = [
      { kind: "images", role: "reference" },
      { kind: "videos", role: "reference" },
      { kind: "images", role: "reference" },
      { kind: "audios", role: "reference" },
    ] as never;

    expect(seedanceReferenceTokenGuide(attachments)).toEqual(["@image1", "@video1", "@image2", "@audio1"]);
  });

  it("preserves Nano Banana and Kling pattern inference", () => {
    const nanoModel = { input_patterns: ["prompt_only", "single_image", "image_edit"] } as never;
    const klingModel = { input_patterns: ["prompt_only", "single_image", "first_last_frames"] } as never;

    expect(inferInputPattern(nanoModel, [], null)).toBe("prompt_only");
    expect(inferInputPattern(nanoModel, [{ kind: "images" }] as never, null)).toBe("image_edit");
    expect(
      inferInputPattern(
        klingModel,
        [
          { kind: "images", role: "first_frame" },
          { kind: "images", role: "last_frame" },
        ] as never,
        null,
      ),
    ).toBe("first_last_frames");
  });

  it("classifies dragged media files by extension when mime is empty", () => {
    expect(classifyFile(new File(["video"], "dragged-ref.mp4"))).toBe("videos");
    expect(classifyFile(new File(["audio"], "dragged-ref.wav"))).toBe("audios");
    expect(classifyFile(new File(["image"], "dragged-ref.png"))).toBe("images");
  });

  it("uses the same staged image visual for enhancement previews as the composer strip", () => {
    const asset = {
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/source.webp",
      hero_web_path: null,
      hero_thumb_url: null,
      hero_web_url: null,
      hero_poster_path: null,
      hero_poster_url: null,
    } as never;

    expect(
      orderedImageInputVisual({
        source: "asset",
        asset,
      }),
    ).toBe("/api/control/files/outputs/thumb/source.webp");

    expect(
      resolveEnhancementPreviewVisual({
        structuredPresetActive: false,
        firstPresetSlotPreview: null,
        orderedImageInputs: [{ source: "asset", asset }],
        currentSourceAsset: asset,
        imageAttachmentPreviewUrls: [],
      }),
    ).toBe("/api/control/files/outputs/thumb/source.webp");
  });

  it("falls back to the first staged attachment preview for enhancement previews", () => {
    expect(
      resolveEnhancementPreviewVisual({
        structuredPresetActive: false,
        firstPresetSlotPreview: null,
        orderedImageInputs: [{ source: "attachment", attachment: { previewUrl: "blob:source-preview" } }],
        currentSourceAsset: null,
        imageAttachmentPreviewUrls: ["blob:source-preview"],
      }),
    ).toBe("blob:source-preview");
  });

  it("builds inspector reference previews from source assets, slot values, and normalized request images without duplicates", () => {
    const sourceAsset = {
      asset_id: "asset-source",
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/source.webp",
      hero_web_path: null,
      hero_thumb_url: null,
      hero_web_url: null,
      hero_poster_path: null,
      hero_poster_url: null,
      prompt_summary: "Original source",
    } as never;

    expect(
      buildStudioReferencePreviews({
        asset: { source_asset_id: "asset-source" } as never,
        job: {
          normalized_request: {
            images: [
              { asset_id: "asset-source", role: "reference" },
              { path: "outputs/frames/first.png", role: "first_frame" },
            ],
          },
        } as never,
        presetSlots: [{ key: "wardrobe", label: "Wardrobe", helpText: "", required: true, maxFiles: 1 }],
        presetSlotValues: {
          wardrobe: [{ path: "outputs/refs/wardrobe.png" }],
        },
        localAssets: [sourceAsset],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "slot:wardrobe:0",
        label: "Wardrobe",
        url: "/api/control/files/outputs/refs/wardrobe.png",
      },
      {
        key: "job-image:1",
        label: "First frame",
        url: "/api/control/files/outputs/frames/first.png",
      },
    ]);
  });
});
