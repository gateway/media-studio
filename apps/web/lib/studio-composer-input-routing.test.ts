import { describe, expect, it } from "vitest";

import { isSeedanceModel, modelInputLimit, modelSupportsImageDrivenInputs, resolveStandardComposerSlots } from "@/lib/media-studio-helpers";
import { resolveStudioComposerInputRail } from "@/lib/studio-model-support";
import type { MediaModelSummary } from "@/lib/types";

// Input limits/patterns from the installed catalog on 2026-10-20. Only routing fields are retained.
const catalog = [
  {"key": "gpt-image-2-image-to-image", "input_patterns": ["image_edit"], "image_inputs": {"required_max": 16}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "multi-image"},
  {"key": "gpt-image-2-text-to-image", "input_patterns": ["prompt_only"], "image_inputs": {"required_max": 0}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "none"},
  {"key": "gpt-image-2-5-flare-image-to-image", "input_patterns": ["image_edit"], "image_inputs": {"required_max": 16}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "multi-image"},
  {"key": "gpt-image-2-5-flare-text-to-image", "input_patterns": ["prompt_only"], "image_inputs": {"required_max": 0}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "none"},
  {"key": "gpt-image-2-5-sunburst-image-to-image", "input_patterns": ["image_edit"], "image_inputs": {"required_max": 16}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "multi-image"},
  {"key": "gpt-image-2-5-sunburst-text-to-image", "input_patterns": ["prompt_only"], "image_inputs": {"required_max": 0}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "none"},
  {"key": "kling-2.6-i2v", "input_patterns": ["single_image"], "image_inputs": {"required_max": 1}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "standard"},
  {"key": "kling-2.6-motion", "input_patterns": ["motion_control"], "image_inputs": {"required_max": 1}, "video_inputs": {"required_max": 1}, "audio_inputs": {"required_max": 0}, "expected": "standard"},
  {"key": "kling-2.6-t2v", "input_patterns": ["prompt_only"], "image_inputs": {"required_max": 0}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "none"},
  {"key": "kling-3.0-i2v", "input_patterns": ["single_image", "first_last_frames"], "image_inputs": {"required_max": 2}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "standard"},
  {"key": "kling-3.0-motion", "input_patterns": ["motion_control"], "image_inputs": {"required_max": 1}, "video_inputs": {"required_max": 1}, "audio_inputs": {"required_max": 0}, "expected": "standard"},
  {"key": "kling-3.0-t2v", "input_patterns": ["prompt_only"], "image_inputs": {"required_max": 0}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "none"},
  {"key": "kling-3.0-turbo-i2v", "input_patterns": ["single_image", "first_last_frames"], "image_inputs": {"required_max": null}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "none"},
  {"key": "nano-banana-2", "input_patterns": ["prompt_only", "image_edit"], "image_inputs": {"required_max": 14}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "multi-image"},
  {"key": "nano-banana-pro", "input_patterns": ["prompt_only", "image_edit"], "image_inputs": {"required_max": 8}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "multi-image"},
  {"key": "seedance-2.0-fast", "input_patterns": ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"], "image_inputs": {"required_max": 9}, "video_inputs": {"required_max": 3}, "audio_inputs": {"required_max": 3}, "expected": "seedance"},
  {"key": "seedance-2.0-mini", "input_patterns": ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"], "image_inputs": {"required_max": 9}, "video_inputs": {"required_max": 3}, "audio_inputs": {"required_max": 3}, "expected": "seedance"},
  {"key": "seedance-2.0", "input_patterns": ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"], "image_inputs": {"required_max": 9}, "video_inputs": {"required_max": 3}, "audio_inputs": {"required_max": 3}, "expected": "seedance"},
  {"key": "seedance-2.5", "input_patterns": ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"], "image_inputs": {"required_max": 30}, "video_inputs": {"required_max": 10}, "audio_inputs": {"required_max": 10}, "expected": "seedance"},
  {"key": "suno-generate-music", "input_patterns": ["music_prompt"], "image_inputs": {"required_max": 0}, "video_inputs": {"required_max": 0}, "audio_inputs": {"required_max": 0}, "expected": "none"}
];

function route(model: MediaModelSummary, structuredPresetActive = false) {
  const layout = resolveStandardComposerSlots({ model, attachments: [], sourceAsset: null });
  return resolveStudioComposerInputRail({
    structuredPresetActive,
    seedanceComposer: isSeedanceModel(model.key),
    standardComposerUsesExplicitSlots: layout.usesExplicitSlots,
    maxImageInputs: modelSupportsImageDrivenInputs(model) ? modelInputLimit(model, "image_inputs") : 0,
    maxVideoInputs: modelInputLimit(model, "video_inputs"),
    maxAudioInputs: modelInputLimit(model, "audio_inputs"),
  });
}

describe("Studio composer input routing", () => {
  it.each(catalog)("preserves the $expected rail for $key", ({ expected, ...model }) => {
    expect(route(model as MediaModelSummary)).toBe(expected);
  });

  it.each(catalog)("leaves structured preset inputs to their own composer for $key", ({ expected: _expected, ...model }) => {
    expect(route(model as MediaModelSummary, true)).toBe("none");
  });

  it("does not revive a mixed-media fallback for an unfamiliar contract", () => {
    expect(route({
      key: "unfamiliar-video-input", input_patterns: ["prompt_only"],
      image_inputs: { required_max: 0 }, video_inputs: { required_max: 1 }, audio_inputs: { required_max: 0 },
    } as MediaModelSummary)).toBe("none");
  });
});
