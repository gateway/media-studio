import { describe, expect, it } from "vitest";

import { previewFromAsset, previewFromReference } from "@/components/graph-studio/utils/graph-media-preview";
import type { MediaAsset, MediaReference } from "@/lib/types";

describe("graph media previews", () => {
  it("uses playable stored media for video references instead of thumbnail URLs", () => {
    const preview = previewFromReference({
      reference_id: "ref-video",
      kind: "video",
      status: "active",
      stored_path: "reference-media/videos/video.mp4",
      stored_url: "/api/control/files/reference-media/videos/video.mp4",
      thumb_url: "/api/control/files/reference-media/thumbs/video.webp",
      poster_url: "/api/control/files/reference-media/thumbs/video-poster.jpg",
      file_size_bytes: 10,
      sha256: "sha",
      usage_count: 1,
    } as MediaReference);

    expect(preview?.mediaType).toBe("video");
    expect(preview?.url).toBe("/api/control/files/reference-media/videos/video.mp4");
    expect(preview?.posterUrl).toBe("/api/control/files/reference-media/thumbs/video-poster.jpg");
  });

  it("uses stored full image URLs for image references and keeps thumbnails out of the primary preview", () => {
    const preview = previewFromReference({
      reference_id: "ref-image",
      kind: "image",
      status: "active",
      stored_path: "reference-media/images/image.png",
      stored_url: "/api/control/files/reference-media/images/image.png",
      thumb_url: "/api/control/files/reference-media/thumbs/image.webp",
      file_size_bytes: 10,
      sha256: "sha",
      usage_count: 1,
    } as MediaReference);

    expect(preview?.mediaType).toBe("image");
    expect(preview?.url).toBe("/api/control/files/reference-media/images/image.png");
    expect(preview?.fullUrl).toBe("/api/control/files/reference-media/images/image.png");
  });

  it("keeps video asset preview playable and stores its poster separately", () => {
    const preview = previewFromAsset({
      asset_id: "asset-video",
      generation_kind: "video",
      hero_web_url: "/api/control/files/outputs/video.mp4",
      hero_poster_url: "/api/control/files/outputs/video-poster.jpg",
    } as MediaAsset);

    expect(preview?.mediaType).toBe("video");
    expect(preview?.url).toBe("/api/control/files/outputs/video.mp4");
    expect(preview?.posterUrl).toBe("/api/control/files/outputs/video-poster.jpg");
  });

  it("uses thumbnail URLs for image asset previews while preserving the full image URL", () => {
    const preview = previewFromAsset({
      asset_id: "asset-image",
      generation_kind: "image",
      hero_original_url: "/api/control/files/outputs/original/image.png",
      hero_web_url: "/api/control/files/outputs/web/image.webp",
      hero_thumb_url: "/api/control/files/outputs/thumb/image.webp",
    } as MediaAsset);

    expect(preview?.mediaType).toBe("image");
    expect(preview?.url).toBe("/api/control/files/outputs/thumb/image.webp");
    expect(preview?.fullUrl).toBe("/api/control/files/outputs/original/image.png");
  });
});
