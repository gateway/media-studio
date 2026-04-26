import { describe, expect, it } from "vitest";

import { deriveStudioModelSupport } from "./studio-model-support";

describe("studio-model-support", () => {
  it("fully supports prompt-only models", () => {
    const support = deriveStudioModelSupport({
      key: "kling-3.0-t2v",
      label: "Kling 3.0 Text to Video",
      provider_model: "provider/model",
      task_modes: ["text_to_video"],
      input_patterns: ["prompt_only"],
      image_inputs: { required_max: 0 },
      video_inputs: { required_max: 0 },
      audio_inputs: { required_max: 0 },
      options: { duration: { type: "int_range", min: 5, max: 10, default: 5 } },
    } as never);

    expect(support.status).toBe("fully_supported");
    expect(support.exposed).toBe(true);
    expect(support.hiddenReason).toBeNull();
  });

  it("fully supports first and last frame contracts", () => {
    const support = deriveStudioModelSupport({
      key: "kling-3.0-i2v",
      label: "Kling 3.0 Image to Video",
      provider_model: "provider/model",
      task_modes: ["image_to_video"],
      input_patterns: ["prompt_only", "single_image", "first_last_frames"],
      image_inputs: { required_max: 2 },
      video_inputs: { required_max: 0 },
      audio_inputs: { required_max: 0 },
      options: { duration: { type: "int_range", min: 5, max: 10, default: 5 } },
    } as never);

    expect(support.status).toBe("fully_supported");
    expect(support.exposed).toBe(true);
    expect(support.supportSummary).toContain("start-frame");
  });

  it("keeps larger image edit models exposed through the generic attachment composer", () => {
    const support = deriveStudioModelSupport({
      key: "gpt-image-2-image-to-image",
      label: "GPT Image 2 Image to Image",
      provider_model: "provider/model",
      task_modes: ["image_edit"],
      input_patterns: ["image_edit"],
      image_inputs: { required_max: 16 },
      video_inputs: { required_max: 0 },
      audio_inputs: { required_max: 0 },
      options: {
        aspect_ratio: { enum: ["1:1", "16:9"], default: "1:1" },
        resolution: { enum: ["1024", "1536"], default: "1024" },
      },
    } as never);

    expect(support.status).toBe("generic_supported");
    expect(support.exposed).toBe(true);
    expect(support.hiddenReason).toBeNull();
    expect(support.supportSummary).toContain("generic attachment composer");
  });

  it("hides unknown multimodal reference contracts until a dedicated renderer exists", () => {
    const support = deriveStudioModelSupport({
      key: "future-reference-model",
      label: "Future Reference Model",
      provider_model: "provider/model",
      task_modes: ["reference_to_video"],
      input_patterns: ["prompt_only", "multimodal_reference"],
      image_inputs: { required_max: 4 },
      video_inputs: { required_max: 2 },
      audio_inputs: { required_max: 1 },
      options: { duration: { type: "int_range", min: 5, max: 10, default: 5 } },
    } as never);

    expect(support.status).toBe("unsupported");
    expect(support.exposed).toBe(false);
    expect(support.hiddenReason).toContain("Seedance");
  });

  it("hides models with unknown input patterns", () => {
    const support = deriveStudioModelSupport({
      key: "future-pattern-model",
      label: "Future Pattern Model",
      provider_model: "provider/model",
      task_modes: ["image_generation"],
      input_patterns: ["prompt_only", "camera_rig"],
      image_inputs: { required_max: 0 },
      video_inputs: { required_max: 0 },
      audio_inputs: { required_max: 0 },
      options: {},
    } as never);

    expect(support.status).toBe("unsupported");
    expect(support.exposed).toBe(false);
    expect(support.unsupportedInputPatterns).toEqual(["camera_rig"]);
  });

  it("downgrades models with unsupported option controls to generic support", () => {
    const support = deriveStudioModelSupport({
      key: "prompt-only-custom-scale",
      label: "Prompt Only Custom Scale",
      provider_model: "provider/model",
      task_modes: ["image_generation"],
      input_patterns: ["prompt_only"],
      image_inputs: { required_max: 0 },
      video_inputs: { required_max: 0 },
      audio_inputs: { required_max: 0 },
      options: {
        cfg_scale: { type: "number", default: 7.5 },
      },
    } as never);

    expect(support.status).toBe("generic_supported");
    expect(support.exposed).toBe(true);
    expect(support.unsupportedOptionKeys).toEqual(["cfg_scale"]);
    expect(support.supportSummary).toContain("provider defaults");
  });
});
