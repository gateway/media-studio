import { describe, expect, it } from "vitest";

import { motionControlVideoInputError } from "@/lib/studio-motion-validation";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import type { MediaModelSummary } from "@/lib/types";

const motionModel = {
  key: "kling-3.0-motion",
  input_patterns: ["motion_control"],
} as MediaModelSummary;

const kling26MotionModel = {
  key: "kling-2.6-motion",
  input_patterns: ["motion_control"],
} as MediaModelSummary;

function videoAttachment(durationSeconds: number): AttachmentRecord {
  return {
    id: "video-1",
    file: null,
    kind: "videos",
    role: null,
    previewUrl: "/video.mp4",
    durationSeconds,
  };
}

describe("motionControlVideoInputError", () => {
  it("blocks Kling motion image-orientation videos over ten seconds", () => {
    expect(
      motionControlVideoInputError({
        model: motionModel,
        attachments: [videoAttachment(20.083333)],
        sourceAsset: null,
        optionValues: { character_orientation: "image" },
      }),
    ).toBe("Driving video is 20.1s. Kling motion control allows up to 10s when character orientation is image.");
  });

  it("allows the same duration when video orientation permits thirty seconds", () => {
    expect(
      motionControlVideoInputError({
        model: motionModel,
        attachments: [videoAttachment(20.083333)],
        sourceAsset: null,
        optionValues: { character_orientation: "video" },
      }),
    ).toBeNull();
  });

  it("applies the same duration rule to Kling 2.6 motion", () => {
    expect(
      motionControlVideoInputError({
        model: kling26MotionModel,
        attachments: [videoAttachment(20.083333)],
        sourceAsset: null,
        optionValues: { character_orientation: "image" },
      }),
    ).toBe("Driving video is 20.1s. Kling motion control allows up to 10s when character orientation is image.");
  });

  it("blocks known videos below the provider minimum duration", () => {
    expect(
      motionControlVideoInputError({
        model: motionModel,
        attachments: [videoAttachment(2.5)],
        sourceAsset: null,
        optionValues: { character_orientation: "video" },
      }),
    ).toBe("Driving video is 2.5s. Kling motion control requires at least 3s.");
  });

  it("ignores unknown duration until pricing and unknown-duration handling are wired", () => {
    expect(
      motionControlVideoInputError({
        model: motionModel,
        attachments: [{ ...videoAttachment(20), durationSeconds: null }],
        sourceAsset: null,
        optionValues: { character_orientation: "image" },
      }),
    ).toBeNull();
  });
});
