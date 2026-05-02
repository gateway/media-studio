import { describe, expect, it } from "vitest";

import {
  applyPromptReferenceMention,
  buildOrderedImageInputs,
  buildStudioJobPrimaryInput,
  buildStudioJobReferenceInputs,
  buildStudioRetryRestorePlan,
  buildStudioReferencePreviews,
  classifyFile,
  compatibleStructuredImagePresetModels,
  detectPromptReferenceMention,
  deriveSeedanceComposerMode,
  buildNormalizedStudioOptions,
  inferInputPattern,
  insertImageAttachments,
  isPresetSlotFilled,
  isStudioPresetVisible,
  mediaDownloadName,
  modelSupportsStructuredImagePreset,
  modelSupportsFirstLastFrames,
  modelSupportsImageDrivenInputs,
  modelSupportsMotionControl,
  optionEntries,
  orderedImageInputKey,
  orderedImageInputVisual,
  renderStructuredPresetPrompt,
  resolveStandardComposerSlots,
  resolveComposerSourceAsset,
  resolveStudioRetryPreset,
  resolveStudioPresetTargetModel,
  resolveEnhancementPreviewVisual,
  seedanceReferenceTokenGuide,
  studioPresetSupportedModels,
  presetRequiresImageInput,
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

  it("uses API-provided dynamic options when available", () => {
    const model = {
      key: "kling-3.0-t2v",
      studio_dynamic_options: [
        {
          key: "mode",
          type: "enum",
          label: "Mode",
          allowed: ["std", "pro", "4K"],
          default: "std",
        },
        {
          key: "duration",
          type: "enum",
          label: "Duration",
          allowed: [5, 10, 15],
          default: 5,
        },
      ],
      options: {
        mode: { type: "enum", allowed: ["std"], default: "std" },
      },
    } as never;

    expect(optionEntries(model).map(([key, schema]) => [key, schema.allowed])).toEqual([
      ["mode", ["std", "pro", "4K"]],
      ["duration", [5, 10, 15]],
    ]);
    expect(buildNormalizedStudioOptions(model, {}, null)).toMatchObject({ mode: "std", duration: 5 });
  });

  it("classifies structured image preset compatibility from model input contracts", () => {
    const nano = {
      key: "nano-banana-2",
      generation_kind: "image",
      task_modes: ["text_to_image", "image_edit"],
      input_patterns: ["prompt_only", "single_image", "image_edit"],
      image_inputs: { required_min: 0, required_max: 8 },
    } as never;
    const gptTextToImage = {
      key: "gpt-image-2-text-to-image",
      generation_kind: "image",
      task_modes: ["text_to_image"],
      input_patterns: ["prompt_only"],
      image_inputs: { required_min: 0, required_max: 0 },
    } as never;
    const gptImageToImage = {
      key: "gpt-image-2-image-to-image",
      generation_kind: "image",
      task_modes: ["image_edit"],
      input_patterns: ["single_image"],
      image_inputs: { required_min: 1, required_max: 16 },
    } as never;
    const kling = {
      key: "kling-3.0-i2v",
      generation_kind: "video",
      task_modes: ["image_to_video"],
      input_patterns: ["single_image"],
      image_inputs: { required_min: 1, required_max: 2 },
    } as never;

    expect(modelSupportsStructuredImagePreset(nano, false)).toBe(true);
    expect(modelSupportsStructuredImagePreset(nano, true)).toBe(true);
    expect(modelSupportsStructuredImagePreset(gptTextToImage, false)).toBe(true);
    expect(modelSupportsStructuredImagePreset(gptTextToImage, true)).toBe(false);
    expect(modelSupportsStructuredImagePreset(gptImageToImage, false)).toBe(false);
    expect(modelSupportsStructuredImagePreset(gptImageToImage, true)).toBe(true);
    expect(modelSupportsStructuredImagePreset(kling, true)).toBe(false);

    expect(compatibleStructuredImagePresetModels([nano, gptTextToImage, gptImageToImage, kling], false).map((model) => model.key)).toEqual([
      "nano-banana-2",
      "gpt-image-2-text-to-image",
    ]);
    expect(compatibleStructuredImagePresetModels([nano, gptTextToImage, gptImageToImage, kling], true).map((model) => model.key)).toEqual([
      "nano-banana-2",
      "gpt-image-2-image-to-image",
    ]);
  });

  it("detects whether a structured preset requires image input", () => {
    expect(
      presetRequiresImageInput({
        input_slots_json: [{ key: "reference", required: true }],
      } as never),
    ).toBe(true);
    expect(
      presetRequiresImageInput({
        input_slots_json: [{ key: "reference", required: false }],
      } as never),
    ).toBe(false);
  });

  it("treats prompt-only video models as having no image-driven inputs", () => {
    const textToVideoModel = { input_patterns: ["prompt_only"] } as never;

    expect(modelSupportsImageDrivenInputs(textToVideoModel)).toBe(false);
    expect(modelSupportsFirstLastFrames(textToVideoModel)).toBe(false);
  });

  it("detects when a model supports first/last frame flows", () => {
    const firstLastModel = { input_patterns: ["prompt_only", "single_image", "first_last_frames"] } as never;

    expect(modelSupportsImageDrivenInputs(firstLastModel)).toBe(true);
    expect(modelSupportsFirstLastFrames(firstLastModel)).toBe(true);
  });

  it("detects motion-control models without treating them as generic text-to-video", () => {
    const motionModel = { input_patterns: ["motion_control"] } as never;

    expect(modelSupportsImageDrivenInputs(motionModel)).toBe(true);
    expect(modelSupportsMotionControl(motionModel)).toBe(true);
  });

  it("returns no standard composer slots for prompt-only models", () => {
    const layout = resolveStandardComposerSlots({
      model: { input_patterns: ["prompt_only"] } as never,
      attachments: [],
      sourceAsset: null,
    });

    expect(layout.usesExplicitSlots).toBe(false);
    expect(layout.slots).toEqual([]);
  });

  it("returns a required source image slot for single-image models", () => {
    const layout = resolveStandardComposerSlots({
      model: {
        input_patterns: ["prompt_only", "single_image"],
        image_inputs: { required_max: 1 },
        video_inputs: { required_max: 0 },
        audio_inputs: { required_max: 0 },
      } as never,
      attachments: [],
      sourceAsset: null,
    });

    expect(layout.usesExplicitSlots).toBe(true);
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0]).toMatchObject({
      kind: "image",
      role: "source_image",
      required: true,
      visible: true,
      filled: false,
    });
  });

  it("returns visible start and optional end frame slots for first/last-frame models", () => {
    const layout = resolveStandardComposerSlots({
      model: {
        input_patterns: ["prompt_only", "single_image", "first_last_frames"],
        image_inputs: { required_max: 2 },
        video_inputs: { required_max: 0 },
        audio_inputs: { required_max: 0 },
      } as never,
      attachments: [{ kind: "images" }] as never,
      sourceAsset: null,
    });

    expect(layout.usesExplicitSlots).toBe(true);
    expect(layout.slots).toHaveLength(2);
    expect(layout.slots[0]).toMatchObject({
      role: "start_frame",
      required: true,
      visible: true,
      filled: true,
    });
    expect(layout.slots[1]).toMatchObject({
      role: "end_frame",
      required: false,
      visible: true,
      filled: false,
    });
  });

  it("keeps optional end-frame slots visible before any frames are filled", () => {
    const layout = resolveStandardComposerSlots({
      model: {
        input_patterns: ["prompt_only", "single_image", "first_last_frames"],
        image_inputs: { required_max: 2 },
        video_inputs: { required_max: 0 },
        audio_inputs: { required_max: 0 },
      } as never,
      attachments: [],
      sourceAsset: null,
    });

    expect(layout.slots).toHaveLength(2);
    expect(layout.slots[0]).toMatchObject({
      role: "start_frame",
      required: true,
      visible: true,
      filled: false,
    });
    expect(layout.slots[1]).toMatchObject({
      role: "end_frame",
      required: false,
      visible: true,
      filled: false,
    });
  });

  it("returns image and video slots for motion-control models", () => {
    const layout = resolveStandardComposerSlots({
      model: {
        input_patterns: ["motion_control"],
        image_inputs: { required_max: 1 },
        video_inputs: { required_max: 1 },
        audio_inputs: { required_max: 0 },
      } as never,
      attachments: [{ kind: "videos" }] as never,
      sourceAsset: null,
    });

    expect(layout.usesExplicitSlots).toBe(true);
    expect(layout.slots).toHaveLength(2);
    expect(layout.slots[0]).toMatchObject({
      kind: "image",
      role: "source_image",
      required: true,
      visible: true,
      filled: false,
    });
    expect(layout.slots[1]).toMatchObject({
      kind: "video",
      role: "driving_video",
      required: true,
      visible: true,
      filled: true,
    });
  });

  it("falls back to the generic attachment rail for multi-image edit models", () => {
    const layout = resolveStandardComposerSlots({
      model: {
        input_patterns: ["image_edit"],
        image_inputs: { required_max: 16 },
        video_inputs: { required_max: 0 },
        audio_inputs: { required_max: 0 },
      } as never,
      attachments: [],
      sourceAsset: null,
    });

    expect(layout.usesExplicitSlots).toBe(false);
    expect(layout.slots).toEqual([]);
  });

  it("classifies dragged media files by extension when mime is empty", () => {
    expect(classifyFile(new File(["video"], "dragged-ref.mp4"))).toBe("videos");
    expect(classifyFile(new File(["audio"], "dragged-ref.wav"))).toBe("audios");
    expect(classifyFile(new File(["image"], "dragged-ref.png"))).toBe("images");
  });

  it("treats reference-backed preset slots as filled", () => {
    expect(
      isPresetSlotFilled({
        assetId: null,
        referenceId: "ref-1",
        referenceRecord: null,
        file: null,
        previewUrl: "https://example.com/thumb.webp",
      }),
    ).toBe(true);
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

  it("builds ordered image inputs from the source asset and appended references", () => {
    const sourceAsset = {
      asset_id: "asset-source",
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/source.webp",
    } as never;
    const reference = {
      reference_id: "ref-1",
      kind: "image",
      stored_url: "/api/control/reference/ref-1.png",
    } as never;
    const ordered = buildOrderedImageInputs(
      sourceAsset,
      [
        { id: "att-1", kind: "images", role: null, previewUrl: "blob:first", file: {} },
        { id: "att-2", kind: "images", role: null, previewUrl: "blob:second", file: null, referenceId: "ref-1", referenceRecord: reference },
      ] as never,
      true,
    );

    expect(ordered).toHaveLength(3);
    expect(ordered.map((item) => item.source)).toEqual(["asset", "attachment", "reference"]);
    expect(orderedImageInputKey(ordered[0], 0)).toBe("asset:asset-source");
    expect(orderedImageInputKey(ordered[2], 2)).toBe("reference:att-2");
  });

  it("keeps a staged source asset available when the current gallery filter no longer includes it", () => {
    const sourceAsset = {
      asset_id: "asset-source",
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/source.webp",
    } as never;

    expect(resolveComposerSourceAsset("asset-source", sourceAsset, [], [])).toEqual(sourceAsset);
    expect(resolveComposerSourceAsset("asset-source", sourceAsset, [{ ...sourceAsset, prompt_summary: "fresh copy" }] as never, [])).toEqual({
      ...sourceAsset,
      prompt_summary: "fresh copy",
    });
    expect(resolveComposerSourceAsset("asset-other", sourceAsset, [], [])).toBeNull();
  });

  it("inserts new image attachments at the requested slot without disturbing other media", () => {
    const current = [
      { id: "video-1", kind: "videos", role: null },
      { id: "image-1", kind: "images", role: null },
      { id: "seedance-first", kind: "images", role: "first_frame" },
      { id: "image-2", kind: "images", role: null },
    ] as never;
    const next = [{ id: "image-new", kind: "images", role: null }] as never;

    expect(insertImageAttachments(current, next, 1).map((attachment) => attachment.id)).toEqual([
      "video-1",
      "image-1",
      "seedance-first",
      "image-new",
      "image-2",
    ]);
  });

  it("detects @-triggered prompt reference mentions for staged Nano images", () => {
    expect(detectPromptReferenceMention("Make the scene match @image reference 2", 39)).toEqual({
      start: 21,
      end: 39,
      query: "image reference 2",
    });
    expect(detectPromptReferenceMention("Email test@example.com", 22)).toBeNull();
    expect(detectPromptReferenceMention("Line one\n@image", 15)).toEqual({
      start: 9,
      end: 15,
      query: "image",
    });
  });

  it("replaces a prompt mention with the selected image reference token", () => {
    expect(
      applyPromptReferenceMention(
        "Make the lighting match @image reference 1 please",
        { start: 24, end: 42, query: "image reference 1" },
        "[image reference 1]",
      ),
    ).toEqual({
      prompt: "Make the lighting match [image reference 1] please",
      caretIndex: 43,
    });
  });

  it("renders structured preset placeholders as image reference tokens", () => {
    expect(
      renderStructuredPresetPrompt(
        "Create a premium selfie of [[subject]] with {{style}} lighting.",
        { style: "cinematic" },
        {
          subject: {
            assetId: "asset-1",
            file: null,
            previewUrl: null,
          },
        } as never,
        [{ key: "subject", label: "Subject", helpText: "", required: true, maxFiles: 1 }],
      ),
    ).toBe("Create a premium selfie of [image reference 1] with cinematic lighting.");
  });

  it("hides the generic source preview when preset image slots are present in inspector references", () => {
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
        kind: "images",
        posterUrl: null,
      },
      {
        key: "job-image:1",
        label: "First frame",
        url: "/api/control/files/outputs/frames/first.png",
        kind: "images",
        posterUrl: null,
      },
    ]);
  });

  it("hides implicit primary request images when preset slots already define the reference preview", () => {
    expect(
      buildStudioReferencePreviews({
        asset: { source_asset_id: null } as never,
        job: {
          source_asset_id: null,
          normalized_request: {
            images: [{ path: "reference-media/images/person.png", role: null }],
          },
        } as never,
        presetSlots: [{ key: "person", label: "Person", helpText: "", required: true, maxFiles: 1 }],
        presetSlotValues: {
          person: [{ path: "reference-media/images/person.png" }],
        },
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "slot:person:0",
        label: "Person",
        url: "/api/control/files/reference-media/images/person.png",
        kind: "images",
        posterUrl: null,
      },
    ]);
  });

  it("builds retryable failed-job reference inputs excluding the main source image", () => {
    const sourceAsset = {
      asset_id: "asset-source",
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/source.webp",
      hero_web_path: null,
      hero_thumb_url: null,
      hero_web_url: null,
      hero_poster_path: null,
      hero_poster_url: null,
    } as never;
    const refAsset = {
      asset_id: "asset-ref-2",
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/ref-2.webp",
      hero_web_path: null,
      hero_thumb_url: null,
      hero_web_url: null,
      hero_poster_path: null,
      hero_poster_url: null,
    } as never;

    expect(
      buildStudioJobReferenceInputs({
        job: {
          source_asset_id: "asset-source",
          normalized_request: {
            images: [
              { asset_id: "asset-source", media_type: "image", role: null },
              { asset_id: "asset-ref-2", media_type: "image", role: "reference" },
              { path: "outputs/frames/last.png", media_type: "image", role: "last_frame" },
            ],
          },
        } as never,
        localAssets: [sourceAsset, refAsset],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "job-reference:images:1",
        label: "Reference 1",
        url: "/api/control/files/outputs/thumb/ref-2.webp",
        posterUrl: null,
        assetId: "asset-ref-2",
        kind: "images",
        role: "reference",
      },
      {
        key: "job-reference:images:2",
        label: "Last frame",
        url: "/api/control/files/outputs/frames/last.png",
        posterUrl: null,
        assetId: null,
        kind: "images",
        role: "last_frame",
      },
    ]);
  });

  it("includes image, video, and audio references in retry restore inputs", () => {
    expect(
      buildStudioJobReferenceInputs({
        job: {
          source_asset_id: "asset-source",
          normalized_request: {
            images: [{ asset_id: "asset-source", media_type: "image", role: null }],
            videos: [{ path: "outputs/retry/ref-video.mp4", media_type: "video", role: "reference" }],
            audios: [{ path: "outputs/retry/ref-audio.mp3", media_type: "audio", role: "reference" }],
          },
        } as never,
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "job-reference:videos:0",
        label: "Reference 1",
        url: "/api/control/files/outputs/retry/ref-video.mp4",
        posterUrl: null,
        assetId: null,
        kind: "videos",
        role: "reference",
      },
      {
        key: "job-reference:audios:0",
        label: "Reference 2",
        url: "/api/control/files/outputs/retry/ref-audio.mp3",
        posterUrl: null,
        assetId: null,
        kind: "audios",
        role: "reference",
      },
    ]);
  });

  it("normalizes legacy absolute data paths when rebuilding retry references", () => {
    expect(
      buildStudioJobReferenceInputs({
        job: {
          normalized_request: {
            images: [
              {
                path: "/fixtures/media-studio/data/reference-media/images/legacy-ref.png",
                media_type: "image",
                role: "reference",
              },
            ],
          },
        } as never,
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "job-reference:images:0",
        label: "Reference 1",
        url: "/api/control/files/reference-media/images/legacy-ref.png",
        posterUrl: null,
        assetId: null,
        kind: "images",
        role: "reference",
      },
    ]);
  });

  it("builds a primary retry input from the saved source asset or local source path", () => {
    const sourceAsset = {
      asset_id: "asset-source",
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/source.webp",
      hero_web_path: null,
      hero_thumb_url: null,
      hero_web_url: null,
      hero_poster_path: null,
      hero_poster_url: null,
    } as never;

    expect(
      buildStudioJobPrimaryInput({
        job: { source_asset_id: "asset-source" } as never,
        localAssets: [sourceAsset],
        favoriteAssets: null,
      }),
    ).toEqual({
      assetId: "asset-source",
      url: "/api/control/files/outputs/thumb/source.webp",
      kind: "images",
      role: null,
    });

    expect(
      buildStudioJobPrimaryInput({
        job: {
          normalized_request: {
            images: [{ path: "outputs/retry/source.png", media_type: "image", role: null }],
          },
        } as never,
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual({
      assetId: null,
      url: "/api/control/files/outputs/retry/source.png",
      kind: "images",
      role: null,
    });

    expect(
      buildStudioJobPrimaryInput({
        job: {
          prepared: {
            normalized_request: {
              images: [
                {
                  url: "https://tempfile.redpandaai.co/example/source.png",
                  media_type: "image",
                  role: null,
                },
              ],
              debug: {
                original_media: {
                  images: [{ path: "reference-media/images/source.png" }],
                },
              },
            },
          },
        } as never,
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual({
      assetId: null,
      url: "/api/control/files/reference-media/images/source.png",
      kind: "images",
      role: null,
    });
  });

  it("builds a retry restore plan from the failed job state", () => {
    const model = {
      key: "nano-banana-2",
      defaults: { resolution: "1k" },
      options: {
        resolution: { default: "2k", type: "select" },
        output_format: { default: "jpg", type: "select" },
      },
    } as never;
    const preset = {
      preset_id: "preset-1",
      key: "nano-style",
      label: "Nano style",
      status: "active",
      applies_to_models: ["nano-banana-2"],
      input_slots_json: [{ key: "wardrobe", label: "Wardrobe", type: "image", required: true }],
    } as never;
    const sourceAsset = {
      asset_id: "asset-source",
      generation_kind: "image",
      hero_thumb_path: "outputs/thumb/source.webp",
      hero_web_path: null,
      hero_thumb_url: null,
      hero_web_url: null,
      hero_poster_path: null,
      hero_poster_url: null,
    } as never;

    expect(
      buildStudioRetryRestorePlan({
        job: {
          model_key: "nano-banana-2",
          project_id: "project-1",
          requested_preset_key: "nano-style",
          selected_system_prompt_ids: ["prompt-1"],
          final_prompt_used: "Retry me",
          requested_outputs: 2,
          source_asset_id: "asset-source",
          resolved_options: { output_format: "png" },
          prepared: {
            metadata: { preset_inputs: { vibe: "dramatic" } },
            preset_slot_values_json: {
              wardrobe: [{ asset_id: "asset-source" }],
            },
          },
          normalized_request: {
            images: [
              { asset_id: "asset-source", media_type: "image", role: null },
              { path: "outputs/retry/reference.png", media_type: "image", role: "reference" },
            ],
          },
        } as never,
        batch: null,
        models: [model],
        presets: [preset],
        localAssets: [sourceAsset],
        favoriteAssets: null,
      }),
    ).toEqual({
      targetModel: model,
      targetPreset: preset,
      projectId: "project-1",
      selectedPromptIds: ["prompt-1"],
      prompt: "Retry me",
      presetInputValues: { vibe: "dramatic" },
      optionValues: { resolution: "1k", output_format: "png" },
      outputCount: 2,
      primaryInput: {
        assetId: "asset-source",
        url: "/api/control/files/outputs/thumb/source.webp",
        kind: "images",
        role: null,
      },
      referenceInputs: [
        {
          key: "job-reference:images:1",
          label: "Reference 1",
          url: "/api/control/files/outputs/retry/reference.png",
          posterUrl: null,
          assetId: null,
          kind: "images",
          role: "reference",
        },
      ],
      presetSlotRestores: [
        {
          slotKey: "wardrobe",
          label: "Wardrobe",
          assetId: "asset-source",
          url: "/api/control/files/outputs/thumb/source.webp",
        },
      ],
    });
  });

  it("shows cross-media reference previews from the normalized request", () => {
    expect(
      buildStudioReferencePreviews({
        asset: { source_asset_id: "asset-source" } as never,
        job: {
          normalized_request: {
            images: [{ asset_id: "asset-source", role: null, media_type: "image" }],
            videos: [{ path: "outputs/retry/ref-video.mp4", role: "reference", media_type: "video" }],
            audios: [{ path: "outputs/retry/ref-audio.mp3", role: "reference", media_type: "audio" }],
          },
        } as never,
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "job-video:0",
        label: "Reference 1",
        url: "/api/control/files/outputs/retry/ref-video.mp4",
        kind: "videos",
        posterUrl: null,
      },
      {
        key: "job-audio:0",
        label: "Reference 2",
        url: "/api/control/files/outputs/retry/ref-audio.mp3",
        kind: "audios",
        posterUrl: null,
      },
    ]);
  });

  it("normalizes legacy absolute data paths in inspector reference previews", () => {
    expect(
      buildStudioReferencePreviews({
        job: {
          normalized_request: {
            images: [
              {
                path: "/fixtures/media-studio/data/reference-media/images/legacy-ref.png",
                role: "reference",
                media_type: "image",
              },
            ],
          },
        } as never,
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "job-image:0",
        label: "Reference 1",
        url: "/api/control/files/reference-media/images/legacy-ref.png",
        kind: "images",
        posterUrl: null,
      },
    ]);
  });

  it("shows the implicit primary source preview when no source asset id was stored", () => {
    expect(
      buildStudioReferencePreviews({
        job: {
          normalized_request: {
            images: [
              {
                path: "/fixtures/media-studio/data/reference-media/images/legacy-source.png",
                role: null,
                media_type: "image",
              },
            ],
          },
        } as never,
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual([
      {
        key: "job-image:0",
        label: "Source image",
        url: "/api/control/files/reference-media/images/legacy-source.png",
        kind: "images",
        posterUrl: null,
      },
    ]);
  });

  it("uses batch request summary values when failed jobs do not retain structured preset state", () => {
    const model = {
      key: "nano-banana-2",
      defaults: { resolution: "1k" },
      options: {
        output_format: {
          default: "png",
        },
      },
    } as never;
    const preset = {
      key: "nano-style",
      preset_id: "preset-1",
      input_schema_json: [{ key: "character", label: "Character", required: true }],
      input_slots_json: [{ key: "subject_image", label: "Subject image", required: true }],
    } as never;

    expect(
      buildStudioRetryRestorePlan({
        job: {
          model_key: "nano-banana-2",
          requested_preset_key: "nano-style",
          selected_system_prompt_ids: [],
          final_prompt_used: "Retry structured preset",
          requested_outputs: 1,
          resolved_options: { output_format: "png" },
          normalized_request: {
            images: [{ path: "outputs/retry/source.png", media_type: "image", role: null }],
          },
        } as never,
        batch: {
          request_summary: {
            preset_text_values: { character: "Neo" },
            preset_image_slots: {
              subject_image: [{ path: "outputs/retry/subject.png" }],
            },
          },
        } as never,
        models: [model],
        presets: [preset],
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual({
      targetModel: model,
      targetPreset: preset,
      projectId: null,
      selectedPromptIds: [],
      prompt: "Retry structured preset",
      presetInputValues: { character: "Neo" },
      optionValues: { resolution: "1k", output_format: "png" },
      outputCount: 1,
      primaryInput: {
        assetId: null,
        url: "/api/control/files/outputs/retry/source.png",
        kind: "images",
        role: null,
      },
      referenceInputs: [],
      presetSlotRestores: [
        {
          slotKey: "subject_image",
          label: "Subject image",
          assetId: null,
          url: "/api/control/files/outputs/retry/subject.png",
        },
      ],
    });
  });

  it("keeps reference-only image edit inputs as restoreable references", () => {
    const model = {
      key: "gpt-image-2-image-to-image",
      defaults: { resolution: "2K" },
      input_patterns: ["image_edit"],
      inputs: { image: { required_max: 16 } },
    } as never;

    expect(
      buildStudioRetryRestorePlan({
        job: {
          model_key: "gpt-image-2-image-to-image",
          selected_system_prompt_ids: [],
          final_prompt_used: "Edit the scene",
          requested_outputs: 1,
          resolved_options: { aspect_ratio: "9:16", resolution: "2K" },
          normalized_request: {
            images: [
              {
                path: "/fixtures/media-studio/data/uploads/media-studio/source-a.png",
                media_type: "image",
                role: "reference",
              },
              {
                path: "/fixtures/media-studio/data/reference-media/images/source-b.png",
                media_type: "image",
                role: "reference",
              },
            ],
          },
        } as never,
        batch: null,
        models: [model],
        presets: [],
        localAssets: [],
        favoriteAssets: null,
      }),
    ).toEqual({
      targetModel: model,
      targetPreset: null,
      projectId: null,
      selectedPromptIds: [],
      prompt: "Edit the scene",
      presetInputValues: {},
      optionValues: { resolution: "2K", aspect_ratio: "9:16" },
      outputCount: 1,
      primaryInput: null,
      referenceInputs: [
        {
          key: "job-reference:images:0",
          label: "Reference 1",
          url: "/api/control/files/uploads/media-studio/source-a.png",
          posterUrl: null,
          assetId: null,
          kind: "images",
          role: "reference",
        },
        {
          key: "job-reference:images:1",
          label: "Reference 2",
          url: "/api/control/files/reference-media/images/source-b.png",
          posterUrl: null,
          assetId: null,
          kind: "images",
          role: "reference",
        },
      ],
      presetSlotRestores: [],
    });
  });

  it("prefers original same-origin media over uploaded provider urls for revision restores", () => {
    const model = {
      key: "gpt-image-2-image-to-image",
      defaults: { resolution: "2K" },
      input_patterns: ["image_edit"],
      inputs: { image: { required_max: 16 } },
    } as never;

    const plan = buildStudioRetryRestorePlan({
      job: {
        model_key: "gpt-image-2-image-to-image",
        selected_system_prompt_ids: [],
        final_prompt_used: "Edit the scene",
        requested_outputs: 1,
        resolved_options: { aspect_ratio: "9:16", resolution: "2K" },
        prepared: {
          normalized_request: {
            images: [
              {
                url: "https://tempfile.redpandaai.co/kieai/183531/images/user-uploads/source-a.png",
                media_type: "image",
                role: "reference",
              },
              {
                url: "https://tempfile.redpandaai.co/kieai/183531/images/user-uploads/source-b.png",
                media_type: "image",
                role: "reference",
              },
            ],
            debug: {
              original_media: {
                images: [
                  {
                    path: "/fixtures/media-studio/data/uploads/media-studio/source-a.png",
                    media_type: "image",
                    role: "reference",
                  },
                  {
                    path: "/fixtures/media-studio/data/reference-media/images/source-b.png",
                    media_type: "image",
                    role: "reference",
                  },
                ],
              },
            },
          },
        },
      } as never,
      batch: null,
      models: [model],
      presets: [],
      localAssets: [],
      favoriteAssets: null,
    });

    expect(plan?.referenceInputs).toEqual([
      {
        key: "job-reference:images:0",
        label: "Reference 1",
        url: "/api/control/files/uploads/media-studio/source-a.png",
        posterUrl: null,
        assetId: null,
        kind: "images",
        role: "reference",
      },
      {
        key: "job-reference:images:1",
        label: "Reference 2",
        url: "/api/control/files/reference-media/images/source-b.png",
        posterUrl: null,
        assetId: null,
        kind: "images",
        role: "reference",
      },
    ]);
  });

  it("filters Studio preset browser entries to active structured image presets", () => {
    const models = [
      {
        key: "gpt-image-2-text-to-image",
        generation_kind: "image",
        task_modes: ["text_to_image"],
        input_patterns: ["prompt_only"],
        image_inputs: { required_min: 0, required_max: 0 },
      },
      {
        key: "kling-2.6-i2v",
        generation_kind: "video",
        task_modes: ["image_to_video"],
        input_patterns: ["single_image"],
        image_inputs: { required_min: 1, required_max: 1 },
      },
    ] as never;

    expect(
      isStudioPresetVisible({
        status: "active",
        applies_to_models: ["gpt-image-2-text-to-image", "kling-2.6-i2v"],
      } as never, models),
    ).toBe(true);

    expect(
      isStudioPresetVisible({
        status: "archived",
        applies_to_models: ["nano-banana-2"],
      } as never, models),
    ).toBe(false);

    expect(
      isStudioPresetVisible({
        status: "active",
        applies_to_models: ["kling-2.6-i2v"],
      } as never, models),
    ).toBe(false);
  });

  it("resolves Studio preset target model using the preferred structured image model when supported", () => {
    const models = [
      {
        key: "nano-banana-2",
        generation_kind: "image",
        task_modes: ["text_to_image", "image_edit"],
        input_patterns: ["prompt_only", "single_image"],
        image_inputs: { required_min: 0, required_max: 4 },
      },
      {
        key: "gpt-image-2-image-to-image",
        generation_kind: "image",
        task_modes: ["image_edit"],
        input_patterns: ["single_image"],
        image_inputs: { required_min: 1, required_max: 16 },
      },
      {
        key: "kling-2.6-i2v",
        generation_kind: "video",
        task_modes: ["image_to_video"],
        input_patterns: ["single_image"],
        image_inputs: { required_min: 1, required_max: 1 },
      },
    ] as never;
    const preset = {
      status: "active",
      input_slots_json: [{ key: "reference", required: true }],
      applies_to_models: ["nano-banana-2", "gpt-image-2-image-to-image"],
    } as never;

    expect(studioPresetSupportedModels(preset, models)).toEqual(["nano-banana-2", "gpt-image-2-image-to-image"]);
    expect(resolveStudioPresetTargetModel(preset, "gpt-image-2-image-to-image", "nano-banana-2", models)).toBe(
      "gpt-image-2-image-to-image",
    );
    expect(resolveStudioPresetTargetModel(preset, "kling-2.6-i2v", "nano-banana-2", models)).toBe("nano-banana-2");
  });

  it("falls back to the first allowed structured image model when no preferred model is supported", () => {
    const models = [
      {
        key: "future-image-renderer",
        generation_kind: "image",
        task_modes: ["text_to_image"],
        input_patterns: ["prompt_only"],
        image_inputs: { required_min: 0, required_max: 0 },
      },
      {
        key: "seedance-2.0",
        generation_kind: "video",
        task_modes: ["text_to_video"],
        input_patterns: ["prompt_only"],
        image_inputs: { required_min: 0, required_max: 0 },
      },
    ] as never;
    const preset = {
      status: "active",
      applies_to_models: ["future-image-renderer"],
    } as never;

    expect(resolveStudioPresetTargetModel(preset, "kling-2.6-i2v", "seedance-2.0", models)).toBe("future-image-renderer");
  });

  it("resolves the retry preset by key or preset id", () => {
    const presets = [
      { preset_id: "preset-a", key: "preset-a-key", label: "Preset A" },
      { preset_id: "preset-b", key: "preset-b-key", label: "Preset B" },
    ] as never;

    expect(
      resolveStudioRetryPreset(
        { requested_preset_key: "preset-b-key", resolved_preset_key: null } as never,
        presets,
      ),
    ).toEqual(presets[1]);
    expect(
      resolveStudioRetryPreset(
        { requested_preset_key: null, resolved_preset_key: "preset-a" } as never,
        presets,
      ),
    ).toEqual(presets[0]);
    expect(resolveStudioRetryPreset(null, presets)).toBeNull();
  });

  it("builds clean download names from job, model, resolution, and aspect ratio", () => {
    expect(
      mediaDownloadName({
        asset_id: "asset-1",
        job_id: "job_bec8bef43dae",
        model_key: "nano-banana-2",
        hero_original_path: "outputs/2026-04-09/original/output_01.png",
        payload: {
          outputs: [{ original_filename: "job_bec8bef43dae.png" }],
          options: { resolution: "2K", aspect_ratio: "4:3" },
        },
      } as never),
    ).toBe("ms-bec8bef43dae_nano-banana-2_2k_4-3.png");
  });

  it("falls back to the stored filename when richer asset metadata is unavailable", () => {
    expect(
      mediaDownloadName({
        asset_id: "asset-2",
        hero_original_path: "outputs/2026-04-09/original/output_01.png",
      } as never),
    ).toBe("output_01.png");
  });
});
