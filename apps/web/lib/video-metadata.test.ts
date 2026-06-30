// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatVideoAspectRatio,
  formatVideoDuration,
  formatVideoResolution,
  normalizeKnownVideoMetadata,
  probeVideoMetadata,
  videoMetadataLabels,
  type VideoObjectUrlFactory,
} from "@/lib/video-metadata";

function mockObjectUrls(url = "blob:video-metadata-test"): VideoObjectUrlFactory & {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
} {
  return {
    createObjectURL: vi.fn(() => url),
    revokeObjectURL: vi.fn(),
  };
}

function mockVideoElement(metadata: {
  duration?: number;
  width?: number;
  height?: number;
}) {
  const originalCreateElement = document.createElement.bind(document);
  let video: HTMLVideoElement | null = null;
  const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === "video") {
      video = element as HTMLVideoElement;
      Object.defineProperties(video, {
        duration: { configurable: true, value: metadata.duration ?? Number.NaN },
        videoWidth: { configurable: true, value: metadata.width ?? 0 },
        videoHeight: { configurable: true, value: metadata.height ?? 0 },
      });
      Object.defineProperty(video, "load", {
        configurable: true,
        value: vi.fn(),
      });
    }
    return element;
  });

  return {
    get video() {
      if (!video) throw new Error("Expected a video element to be created");
      return video;
    },
    createElementSpy,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("video metadata", () => {
  it("normalizes known reference metadata", () => {
    expect(
      normalizeKnownVideoMetadata({
        duration_seconds: 20.083333,
        width: 720,
        height: 1280,
        mime_type: "video/mp4",
        file_size_bytes: 57_816,
      }),
    ).toEqual({
      durationSeconds: 20.083333,
      width: 720,
      height: 1280,
      mimeType: "video/mp4",
      sizeBytes: 57_816,
      sourceKind: "reference",
    });
  });

  it("formats duration, resolution, and aspect labels compactly", () => {
    expect(formatVideoDuration(20.083333)).toBe("20.1s");
    expect(formatVideoDuration(65.2)).toBe("1m 05s");
    expect(formatVideoResolution(720, 1280)).toBe("720x1280");
    expect(formatVideoAspectRatio(720, 1280)).toBe("9:16");
    expect(videoMetadataLabels({ durationSeconds: 20.083333, width: 720, height: 1280 })).toEqual({
      durationLabel: "20.1s",
      aspectLabel: "9:16",
      resolutionLabel: "720x1280",
    });
  });

  it("probes File metadata and revokes only the created object URL", async () => {
    const objectUrls = mockObjectUrls();
    const videoMock = mockVideoElement({ duration: 20.083333, width: 720, height: 1280 });
    const file = new File(["fixture"], "motion.mp4", { type: "video/mp4" });

    const pending = probeVideoMetadata(file, { objectUrlFactory: objectUrls, timeoutMs: 1000 });
    videoMock.video.dispatchEvent(new Event("loadedmetadata"));

    await expect(pending).resolves.toEqual({
      durationSeconds: 20.083333,
      width: 720,
      height: 1280,
      mimeType: "video/mp4",
      sizeBytes: file.size,
      sourceKind: "file",
    });
    expect(objectUrls.createObjectURL).toHaveBeenCalledWith(file);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:video-metadata-test");
  });

  it("does not revoke caller-owned object URLs", async () => {
    const objectUrls = mockObjectUrls();
    const videoMock = mockVideoElement({ duration: 5, width: 1920, height: 1080 });

    const pending = probeVideoMetadata("blob:caller-owned", { objectUrlFactory: objectUrls, timeoutMs: 1000 });
    videoMock.video.dispatchEvent(new Event("loadedmetadata"));

    await expect(pending).resolves.toMatchObject({
      durationSeconds: 5,
      width: 1920,
      height: 1080,
      sourceKind: "blob-url",
    });
    expect(objectUrls.createObjectURL).not.toHaveBeenCalled();
    expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("returns null metadata fields on timeout and still revokes utility-owned URLs", async () => {
    vi.useFakeTimers();
    const objectUrls = mockObjectUrls();
    mockVideoElement({});
    const blob = new Blob(["fixture"], { type: "video/mp4" });

    const pending = probeVideoMetadata(blob, { objectUrlFactory: objectUrls, timeoutMs: 25 });
    vi.advanceTimersByTime(25);

    await expect(pending).resolves.toEqual({
      durationSeconds: null,
      width: null,
      height: null,
      mimeType: "video/mp4",
      sizeBytes: blob.size,
      sourceKind: "blob-url",
    });
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:video-metadata-test");
  });
});
