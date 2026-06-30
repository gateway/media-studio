// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGraphImageSelectorSources } from "./use-graph-image-selector-sources";

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useGraphImageSelectorSources", () => {
  it("loads generated, imported, search, pagination, and explicit project scope from source URLs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/control/media/projects")) {
        return jsonResponse({
          ok: true,
          projects: [
            {
              project_id: "project_ab78ce28660d",
              name: "Sadi",
              status: "active",
              hidden_from_global_gallery: true,
            },
          ],
        });
      }
      if (url.includes("/api/control/media-assets")) {
        const isPaged = url.includes("offset=40");
        return jsonResponse({
          ok: true,
          assets: [
            {
              asset_id: isPaged ? "asset-sadi-2" : "asset-sadi-1",
              generation_kind: "image",
              created_at: "2026-06-22T12:00:00Z",
              prompt_summary: "Sadi image",
              hero_thumb_url: isPaged
                ? "/generated-sadi-2-thumb.webp"
                : "/generated-sadi-1-thumb.webp",
              hero_web_url: isPaged
                ? "/generated-sadi-2.webp"
                : "/generated-sadi-1.webp",
            },
          ],
          next_offset: isPaged ? null : 40,
        });
      }
      if (url.includes("/api/control/reference-media")) {
        return jsonResponse({
          ok: true,
          items: [
            {
              reference_id: "reference-sadi-1",
              kind: "image",
              original_filename: "sadi-reference.png",
              stored_url: "/references/sadi-reference.png",
              thumb_url: "/references/sadi-reference-thumb.png",
            },
          ],
          next_offset: null,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useGraphImageSelectorSources());

    await act(async () => {
      await result.current.loadProjects();
    });
    expect(result.current.projectOptions).toEqual([
      {
        projectId: "project_ab78ce28660d",
        label: "Sadi",
        status: "active",
        hiddenFromGlobalGallery: true,
      },
    ]);

    await act(async () => {
      await result.current.loadSource("generated");
    });
    expect(result.current.generated.items.map((item) => item.id)).toEqual([
      "asset-sadi-1",
    ]);

    await act(async () => {
      await result.current.loadSource("generated", { append: true });
    });
    expect(result.current.generated.items.map((item) => item.id)).toEqual([
      "asset-sadi-1",
      "asset-sadi-2",
    ]);

    await act(async () => {
      result.current.setSearchQuery("Sadie");
      result.current.setProjectId("project_ab78ce28660d");
      await result.current.loadSource("imported", {
        query: "Sadie",
        projectId: "project_ab78ce28660d",
      });
    });

    await waitFor(() => {
      expect(result.current.imported.items.map((item) => item.id)).toEqual([
        "reference-sadi-1",
      ]);
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          "/api/control/media-assets?limit=40&offset=0&generation_kind=image&view=picker",
        ),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          "/api/control/media-assets?limit=40&offset=40&generation_kind=image&view=picker",
        ),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          "/api/control/reference-media?limit=40&offset=0&kind=image&q=Sadie&project_id=project_ab78ce28660d",
        ),
      ),
    ).toBe(true);
  });

  it("can load video and audio selector sources without image-only URLs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("generation_kind=video")) {
        return jsonResponse({
          ok: true,
          assets: [
            {
              asset_id: "asset-video-1",
              generation_kind: "video",
              created_at: "2026-06-22T12:00:00Z",
              prompt_summary: "Motion clip",
              hero_original_url: "/generated-video.mp4",
              hero_poster_url: "/generated-video.webp",
              width: 1920,
              height: 1080,
              duration_seconds: 5.25,
              project_id: "project-video",
            },
          ],
          next_offset: null,
        });
      }
      if (url.includes("kind=video")) {
        return jsonResponse({
          ok: true,
          items: [
            {
              reference_id: "reference-video-1",
              kind: "video",
              status: "active",
              original_filename: "source-video.mp4",
              stored_path: "references/source-video.mp4",
              stored_url: "/references/source-video.mp4",
              poster_url: "/references/source-video.webp",
              width: 1280,
              height: 720,
              duration_seconds: 20.083333,
              attached_project_ids: ["project-video"],
              file_size_bytes: 1000,
              sha256: "video-sha",
              usage_count: 0,
            },
          ],
          next_offset: null,
        });
      }
      if (url.includes("generation_kind=audio")) {
        return jsonResponse({
          ok: true,
          assets: [
            {
              asset_id: "asset-audio-1",
              generation_kind: "audio",
              created_at: "2026-06-22T12:00:00Z",
              prompt_summary: "Audio clip",
              hero_original_url: "/generated-audio.wav",
              duration_seconds: 5,
              project_id: "project-audio",
            },
          ],
          next_offset: null,
        });
      }
      if (url.includes("kind=audio")) {
        return jsonResponse({
          ok: true,
          items: [
            {
              reference_id: "reference-audio-1",
              kind: "audio",
              status: "active",
              original_filename: "source-audio.wav",
              stored_path: "references/source-audio.wav",
              stored_url: "/references/source-audio.wav",
              mime_type: "audio/wav",
              attached_project_ids: ["project-audio"],
              file_size_bytes: 1000,
              sha256: "audio-sha",
              usage_count: 0,
              duration_seconds: 5,
              metadata: {
                format_name: "wav",
              },
            },
          ],
          next_offset: null,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const videoHook = renderHook(() => useGraphImageSelectorSources("video"));
    await act(async () => {
      await videoHook.result.current.loadSource("generated", {
        query: "motion",
        projectId: "project-video",
      });
      await videoHook.result.current.loadSource("imported", {
        query: "motion",
        projectId: "project-video",
      });
    });

    expect(videoHook.result.current.generated.items[0]).toMatchObject({
      id: "asset-video-1",
      source: "generated-video",
      mediaType: "video",
      durationSeconds: 5.25,
      projectLabel: "project-video",
      trimReady: true,
    });
    expect(videoHook.result.current.imported.items[0]).toMatchObject({
      id: "reference-video-1",
      source: "reference-video",
      mediaType: "video",
      durationSeconds: 20.083333,
      projectLabel: "project-video",
      trimReady: true,
    });

    const audioHook = renderHook(() => useGraphImageSelectorSources("audio"));
    await act(async () => {
      await audioHook.result.current.loadSource("generated", {
        query: "dialog",
        projectId: "project-audio",
      });
      await audioHook.result.current.loadSource("imported", {
        query: "dialog",
        projectId: "project-audio",
      });
    });

    expect(audioHook.result.current.generated.items[0]).toMatchObject({
      id: "asset-audio-1",
      source: "generated-audio",
      mediaType: "audio",
      durationSeconds: 5,
      formatLabel: "WAV",
      projectLabel: "project-audio",
      trimReady: false,
    });
    expect(audioHook.result.current.imported.items[0]).toMatchObject({
      id: "reference-audio-1",
      source: "reference-audio",
      mediaType: "audio",
      durationSeconds: 5,
      formatLabel: "WAV",
      projectLabel: "project-audio",
      trimReady: false,
    });
    expect(
      [...audioHook.result.current.generated.items, ...audioHook.result.current.imported.items].every(
        (item) => item.mediaType === "audio",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          "/api/control/media-assets?limit=40&offset=0&generation_kind=video&view=picker&q=motion&project_id=project-video",
        ),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          "/api/control/reference-media?limit=40&offset=0&kind=video&q=motion&project_id=project-video",
        ),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          "/api/control/media-assets?limit=40&offset=0&generation_kind=audio&view=picker&q=dialog&project_id=project-audio",
        ),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          "/api/control/reference-media?limit=40&offset=0&kind=audio&q=dialog&project_id=project-audio",
        ),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("kind=image") ||
        String(url).includes("generation_kind=image"),
      ),
    ).toBe(false);
  });
});
