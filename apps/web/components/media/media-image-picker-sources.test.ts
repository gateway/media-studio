import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchGeneratedMediaPickerPage,
  fetchGeneratedImagePickerPage,
  fetchReferenceMediaPickerPage,
  fetchReferenceImagePickerPage,
  generatedMediaPickerItem,
  generatedMediaPickerPageUrl,
  generatedImagePickerPageUrl,
  generatedImagePickerItem,
  referenceMediaPickerItem,
  referenceMediaPickerPageUrl,
  referenceImagePickerPageUrl,
  referenceImagePickerItem,
} from "./media-image-picker-sources";
import type { MediaAssetPickerItem, MediaReference } from "@/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("media image picker sources", () => {
  it("maps generated picker rows without full MediaAsset payload data", () => {
    const item = generatedImagePickerItem({
      asset_id: "asset-light",
      generation_kind: "image",
      created_at: "2026-06-09T12:00:00.000Z",
      model_key: "gpt-image-2",
      task_mode: "text_to_image",
      prompt_summary: "Lightweight prompt",
      hero_thumb_path: "runs/asset-light/thumb.webp",
      hero_web_path: "runs/asset-light/web.webp",
      hero_original_path: "runs/asset-light/original.png",
      hero_thumb_url: "/api/control/files/runs/asset-light/thumb.webp",
      hero_web_url: "/api/control/files/runs/asset-light/web.webp",
      hero_original_url: "/api/control/files/runs/asset-light/original.png",
      width: 1536,
      height: 1024,
    });

    expect(item).toMatchObject({
      id: "asset-light",
      source: "generated-image",
      previewUrl: "/api/control/files/runs/asset-light/thumb.webp",
      fullUrl: "/api/control/files/runs/asset-light/original.png",
      alt: "Lightweight prompt",
      filename: "runs/asset-light/original.png",
      width: 1536,
      height: 1024,
      createdAt: "2026-06-09T12:00:00.000Z",
    });
  });

  it("requests the lightweight picker view for generated picker pages", async () => {
    const rows: MediaAssetPickerItem[] = [
      {
        asset_id: "asset-1",
        generation_kind: "image",
        created_at: "2026-06-09T12:00:00.000Z",
        hero_thumb_path: "runs/asset-1/thumb.webp",
      },
      {
        asset_id: "asset-no-preview",
        generation_kind: "image",
        created_at: "2026-06-09T12:01:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        assets: rows,
        next_offset: 24,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchGeneratedImagePickerPage(12);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/media-assets?limit=24&offset=12&generation_kind=image&view=picker",
    );
    expect(page.nextOffset).toBe(24);
    expect(page.items).toEqual([rows[0]]);
  });

  it("adds source-backed search to generated picker page URLs", () => {
    expect(generatedImagePickerPageUrl(48, "Sadie")).toBe(
      "/api/control/media-assets?limit=24&offset=48&generation_kind=image&view=picker&q=Sadie",
    );
  });

  it("adds explicit project scope to generated picker page URLs", () => {
    expect(
      generatedImagePickerPageUrl(0, "Sadi", 40, "project_ab78ce28660d"),
    ).toBe(
      "/api/control/media-assets?limit=40&offset=0&generation_kind=image&view=picker&q=Sadi&project_id=project_ab78ce28660d",
    );
  });

  it("builds generated media picker URLs for video and audio without changing image URLs", () => {
    expect(
      generatedMediaPickerPageUrl("video", 80, "motion", 40, "project-video"),
    ).toBe(
      "/api/control/media-assets?limit=40&offset=80&generation_kind=video&view=picker&q=motion&project_id=project-video",
    );
    expect(
      generatedMediaPickerPageUrl("audio", 0, "voice", 20, "project-audio"),
    ).toBe(
      "/api/control/media-assets?limit=20&offset=0&generation_kind=audio&view=picker&q=voice&project_id=project-audio",
    );
    expect(generatedMediaPickerPageUrl("image", 48, "Sadie")).toBe(
      generatedImagePickerPageUrl(48, "Sadie"),
    );
  });

  it("fetches generated media pages by requested media type", async () => {
    const rows: MediaAssetPickerItem[] = [
      {
        asset_id: "asset-video",
        generation_kind: "video",
        created_at: "2026-06-09T12:00:00.000Z",
        hero_original_url: "/api/control/files/videos/video.mp4",
        hero_poster_url: "/api/control/files/videos/video.webp",
      },
      {
        asset_id: "asset-image",
        generation_kind: "image",
        created_at: "2026-06-09T12:01:00.000Z",
        hero_thumb_url: "/api/control/files/images/image.webp",
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        assets: rows,
        next_offset: null,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchGeneratedMediaPickerPage("video", 0, "motion", "project-video", 40);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/media-assets?limit=40&offset=0&generation_kind=video&view=picker&q=motion&project_id=project-video",
    );
    expect(page.items.map((item) => item.asset_id)).toEqual(["asset-video"]);
  });

  it("maps generated video metadata for trim-aware picker tiles", () => {
    const item = generatedMediaPickerItem(
      {
        asset_id: "asset-video-trim",
        project_id: "project-motion",
        generation_kind: "video",
        created_at: "2026-06-22T12:00:00.000Z",
        prompt_summary: "Motion test",
        hero_original_url: "/api/control/files/videos/motion.mp4",
        hero_poster_url: "/api/control/files/videos/motion.webp",
        width: 1920,
        height: 1080,
        duration_seconds: 5.25,
      },
      "video",
    );

    expect(item).toMatchObject({
      id: "asset-video-trim",
      source: "generated-video",
      mediaType: "video",
      previewUrl: "/api/control/files/videos/motion.webp",
      fullUrl: "/api/control/files/videos/motion.mp4",
      durationSeconds: 5.25,
      sourceLabel: "Generated",
      projectLabel: "project-motion",
      trimReady: true,
    });
  });

  it("maps generated audio format metadata for picker tiles", () => {
    const item = generatedMediaPickerItem(
      {
        asset_id: "asset-audio-format",
        project_id: "project-audio",
        generation_kind: "audio",
        created_at: "2026-06-22T12:00:00.000Z",
        prompt_summary: "Generated theme music",
        hero_original_path: "outputs/music/original/output_01.mp3",
        hero_original_url: "/api/control/files/outputs/music/original/output_01.mp3",
        duration_seconds: 123.4,
      },
      "audio",
    );

    expect(item).toMatchObject({
      id: "asset-audio-format",
      source: "generated-audio",
      mediaType: "audio",
      fullUrl: "/api/control/files/outputs/music/original/output_01.mp3",
      filename: "output_01.mp3",
      durationSeconds: 123.4,
      formatLabel: "MP3",
      sourceLabel: "Generated",
      projectLabel: "project-audio",
      trimReady: false,
    });
  });

  it("maps reference media to thumbnail grid URLs and full preview URLs", () => {
    const item = referenceImagePickerItem({
      reference_id: "reference-1",
      kind: "image",
      original_filename: "portrait-ref.png",
      stored_path: "references/portrait-ref.png",
      thumb_path: "references/thumbs/portrait-ref.webp",
      poster_path: null,
      stored_url: "/api/control/files/references/portrait-ref.png",
      thumb_url: "/api/control/files/references/thumbs/portrait-ref.webp",
      poster_url: null,
      width: 1024,
      height: 1536,
      created_at: "2026-06-09T13:00:00.000Z",
    });

    expect(item).toMatchObject({
      id: "reference-1",
      source: "reference-image",
      previewUrl: "/api/control/files/references/thumbs/portrait-ref.webp",
      fullUrl: "/api/control/files/references/portrait-ref.png",
      ariaLabel: "Use portrait-ref.png",
      alt: "portrait-ref.png",
      filename: "portrait-ref.png",
      width: 1024,
      height: 1536,
      createdAt: "2026-06-09T13:00:00.000Z",
    });
  });

  it("requests reference picker pages with image kind and filters non-image rows", async () => {
    const rows: MediaReference[] = [
      {
        reference_id: "reference-image",
        kind: "image",
        original_filename: "image.png",
        stored_path: "references/image.png",
        thumb_path: "references/thumbs/image.webp",
        poster_path: null,
        stored_url: "/api/control/files/references/image.png",
        thumb_url: "/api/control/files/references/thumbs/image.webp",
        poster_url: null,
        width: 1024,
        height: 1024,
        created_at: "2026-06-09T13:00:00.000Z",
      },
      {
        reference_id: "reference-video",
        kind: "video",
        original_filename: "video.mp4",
        stored_path: "references/video.mp4",
        thumb_path: null,
        poster_path: "references/posters/video.webp",
        stored_url: "/api/control/files/references/video.mp4",
        thumb_url: null,
        poster_url: "/api/control/files/references/posters/video.webp",
        width: 1280,
        height: 720,
        created_at: "2026-06-09T13:01:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        items: rows,
        next_offset: 48,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchReferenceImagePickerPage(24);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/reference-media?limit=24&offset=24&kind=image",
    );
    expect(page.nextOffset).toBe(48);
    expect(page.items).toEqual([rows[0]]);
  });

  it("adds source-backed search to reference picker page URLs", () => {
    expect(referenceImagePickerPageUrl(24, "Sadi")).toBe(
      "/api/control/reference-media?limit=24&offset=24&kind=image&q=Sadi",
    );
  });

  it("adds explicit project scope to reference picker page URLs", () => {
    expect(
      referenceImagePickerPageUrl(0, "Sadi", 40, "project_ab78ce28660d"),
    ).toBe(
      "/api/control/reference-media?limit=40&offset=0&kind=image&q=Sadi&project_id=project_ab78ce28660d",
    );
  });

  it("builds reference media picker URLs for video and audio without changing image URLs", () => {
    expect(
      referenceMediaPickerPageUrl("video", 0, "clip", 40, "project-video"),
    ).toBe(
      "/api/control/reference-media?limit=40&offset=0&kind=video&q=clip&project_id=project-video",
    );
    expect(
      referenceMediaPickerPageUrl("audio", 20, "dialog", 10, "project-audio"),
    ).toBe(
      "/api/control/reference-media?limit=10&offset=20&kind=audio&q=dialog&project_id=project-audio",
    );
    expect(referenceMediaPickerPageUrl("image", 24, "Sadi")).toBe(
      referenceImagePickerPageUrl(24, "Sadi"),
    );
  });

  it("fetches reference media pages by requested media type", async () => {
    const rows: MediaReference[] = [
      {
        reference_id: "reference-audio",
        kind: "audio",
        status: "active",
        original_filename: "dialog.wav",
        stored_path: "references/dialog.wav",
        thumb_path: null,
        poster_path: null,
        stored_url: "/api/control/files/references/dialog.wav",
        thumb_url: null,
        poster_url: null,
        file_size_bytes: 1234,
        sha256: "audio-sha",
        usage_count: 0,
        duration_seconds: 5,
      },
      {
        reference_id: "reference-video",
        kind: "video",
        status: "active",
        original_filename: "clip.mp4",
        stored_path: "references/clip.mp4",
        thumb_path: null,
        poster_path: "references/clip.webp",
        stored_url: "/api/control/files/references/clip.mp4",
        thumb_url: null,
        poster_url: "/api/control/files/references/clip.webp",
        file_size_bytes: 5678,
        sha256: "video-sha",
        usage_count: 0,
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        items: rows,
        next_offset: null,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchReferenceMediaPickerPage("audio", 0, "dialog", "project-audio", 40);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/reference-media?limit=40&offset=0&kind=audio&q=dialog&project_id=project-audio",
    );
    expect(page.items.map((item) => item.reference_id)).toEqual([
      "reference-audio",
    ]);
  });

  it("maps imported video metadata for trim-aware picker tiles", () => {
    const item = referenceMediaPickerItem(
      {
        reference_id: "reference-video-trim",
        kind: "video",
        status: "active",
        attached_project_ids: ["project-a", "project-b"],
        original_filename: "driving-video.mp4",
        stored_path: "references/driving-video.mp4",
        poster_path: "references/driving-video.webp",
        stored_url: "/api/control/files/references/driving-video.mp4",
        thumb_url: null,
        poster_url: "/api/control/files/references/driving-video.webp",
        file_size_bytes: 12345,
        sha256: "video-sha",
        width: 1280,
        height: 720,
        duration_seconds: 20.083333,
        usage_count: 0,
      },
      "video",
    );

    expect(item).toMatchObject({
      id: "reference-video-trim",
      source: "reference-video",
      mediaType: "video",
      filename: "driving-video.mp4",
      durationSeconds: 20.083333,
      sourceLabel: "Imported",
      projectLabel: "2 projects",
      trimReady: true,
    });
  });

  it("maps imported audio metadata for picker tiles", () => {
    const item = referenceMediaPickerItem(
      {
        reference_id: "reference-audio-format",
        kind: "audio",
        status: "active",
        attached_project_ids: ["project-audio"],
        original_filename: "dialog-line.wav",
        stored_path: "references/dialog-line.wav",
        stored_url: "/api/control/files/references/dialog-line.wav",
        thumb_url: null,
        poster_url: null,
        mime_type: "application/octet-stream",
        file_size_bytes: 12345,
        sha256: "audio-sha",
        duration_seconds: 2,
        usage_count: 0,
        metadata: {
          format_name: "wav",
          sample_rate: 44100,
          channels: 1,
        },
      },
      "audio",
    );

    expect(item).toMatchObject({
      id: "reference-audio-format",
      source: "reference-audio",
      mediaType: "audio",
      filename: "dialog-line.wav",
      durationSeconds: 2,
      formatLabel: "WAV",
      sourceLabel: "Imported",
      projectLabel: "project-audio",
      trimReady: false,
    });
  });
});
