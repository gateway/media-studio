import { describe, expect, it } from "vitest";

import { isSeedanceModel } from "./seedance-model";
import { deriveStudioModelSupport, optionChoices } from "./studio-model-support";
import { deriveStudioPricingOptions } from "./studio-pricing";

describe("Seedance model support", () => {
  it("recognizes existing Seedance 2.0 variants and exact Seedance 2.5", () => {
    expect(isSeedanceModel("seedance-2.0")).toBe(true);
    expect(isSeedanceModel("seedance-2.0-fast")).toBe(true);
    expect(isSeedanceModel("Seedance_2.5")).toBe(true);
    expect(isSeedanceModel("seedance-2.6")).toBe(false);
  });

  it("uses the existing Studio composer and video-input pricing for Seedance 2.5", () => {
    const support = deriveStudioModelSupport({
      key: "seedance-2.5",
      label: "Seedance 2.5",
      provider_model: "bytedance/seedance-2-5",
      task_modes: ["text_to_video", "reference_to_video"],
      input_patterns: ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"],
      image_inputs: { required_min: 0, required_max: 30 },
      video_inputs: { required_min: 0, required_max: 10 },
      audio_inputs: { required_min: 0, required_max: 10 },
      options: {
        duration: { type: "int_range", allowed: [-1], min: 4, max: 30, required: true },
        resolution: { type: "enum", allowed: ["480p", "720p", "1080p"], default: "720p" },
      },
    } as never);
    const pricing = deriveStudioPricingOptions({
      modelKey: "seedance-2.5",
      options: { resolution: "1080p", duration: 5 },
      attachments: [{ kind: "videos" } as never],
    });

    expect(support.status).toBe("fully_supported");
    expect(support.exposed).toBe(true);
    expect(optionChoices({ type: "int_range", allowed: [-1], min: 4, max: 30 }, null)).toEqual([
      -1,
      ...Array.from({ length: 27 }, (_, index) => index + 4),
    ]);
    expect(pricing.pricing_variant).toBe("1080p_with_video_input");
  });
});
