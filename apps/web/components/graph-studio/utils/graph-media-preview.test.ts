import { describe, expect, it } from "vitest";

import type { MediaReference } from "@/lib/types";
import { previewFromReference } from "./graph-media-preview";

describe("previewFromReference", () => {
  it("uses full image URLs for node previews", () => {
    const preview = previewFromReference({
      reference_id: "reference-1",
      kind: "image",
      status: "active",
      attached_project_ids: [],
      original_filename: "portrait.jpg",
      stored_path: "reference-media/images/portrait.jpg",
      stored_url: "/api/control/files/reference-media/images/portrait.jpg",
      thumb_url: "/api/control/files/reference-media/thumbs/portrait.webp",
      poster_url: "/api/control/files/reference-media/posters/portrait.webp",
      mime_type: "image/jpeg",
      file_size_bytes: 4_900_000,
      sha256: "sha",
      width: 3024,
      height: 4032,
      duration_seconds: null,
      thumb_path: "reference-media/thumbs/portrait.webp",
      poster_path: "reference-media/posters/portrait.webp",
      usage_count: 1,
      last_used_at: null,
      metadata: {},
      created_at: null,
      updated_at: null,
    } as MediaReference);

    expect(preview?.url).toBe("/api/control/files/reference-media/images/portrait.jpg");
    expect(preview?.fullUrl).toBe("/api/control/files/reference-media/images/portrait.jpg");
    expect(preview?.resolutionLabel).toBe("3024x4032");
    expect(preview?.aspectLabel).toBe("3:4");
  });

  it("formats known video metadata for load video previews", () => {
    const preview = previewFromReference({
      reference_id: "reference-video-1",
      kind: "video",
      status: "active",
      attached_project_ids: [],
      original_filename: "driving.mp4",
      stored_path: "reference-media/videos/driving.mp4",
      stored_url: "/api/control/files/reference-media/videos/driving.mp4",
      thumb_url: null,
      poster_url: "/api/control/files/reference-media/posters/driving.webp",
      mime_type: "video/mp4",
      file_size_bytes: 9_800_000,
      sha256: "sha-video",
      width: 720,
      height: 1280,
      duration_seconds: 20.083333,
      thumb_path: null,
      poster_path: "reference-media/posters/driving.webp",
      usage_count: 1,
      last_used_at: null,
      metadata: {},
      created_at: null,
      updated_at: null,
    } as MediaReference);

    expect(preview?.mediaType).toBe("video");
    expect(preview?.durationSeconds).toBe(20.083333);
    expect(preview?.durationLabel).toBe("20.1s");
    expect(preview?.resolutionLabel).toBe("720x1280");
    expect(preview?.aspectLabel).toBe("9:16");
  });
});
