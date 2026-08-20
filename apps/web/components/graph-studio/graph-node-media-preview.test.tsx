// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphNodeMediaPreview } from "./graph-node-media-preview";
import type { GraphNodeData } from "./types";

function makeNodeData(overrides: Partial<GraphNodeData>): GraphNodeData {
  return {
    definition: {
      type: "media.save_audio",
      title: "Save Audio",
      category: "Media",
      ports: { inputs: [], outputs: [] },
      fields: [],
    },
    fields: {},
    onFieldChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("GraphNodeMediaPreview", () => {
  it("renders playable controls for multiple audio outputs", () => {
    const { container } = render(
      <GraphNodeMediaPreview
        nodeId="save-audio"
        data={makeNodeData({
          mediaPreviews: [
            { mediaType: "audio", url: "/media/song-a.mp3", label: "Song A" },
            { mediaType: "audio", url: "/media/song-b.mp3", label: "Song B" },
          ],
        })}
        isLoadMedia={false}
        isSaveMedia
      />,
    );

    expect(screen.getByText("2 audios")).toBeTruthy();
    expect(screen.getByText("Song A")).toBeTruthy();
    expect(screen.getByText("Song B")).toBeTruthy();
    expect(container.querySelectorAll("audio")).toHaveLength(2);
    expect(container.querySelector('audio[src="/media/song-a.mp3"]')).toBeTruthy();
    expect(container.querySelector('audio[src="/media/song-b.mp3"]')).toBeTruthy();
  });

  it("renders cover artwork with a single audio preview", () => {
    const { container } = render(
      <GraphNodeMediaPreview
        nodeId="save-music-track"
        data={makeNodeData({
          mediaPreview: { mediaType: "audio", url: "/media/song-a.mp3", posterUrl: "/media/song-a-cover.png", label: "Song A" },
        })}
        isLoadMedia={false}
        isSaveMedia
      />,
    );

    expect(container.querySelector('img[src="/media/song-a-cover.png"]')).toBeTruthy();
    expect(container.querySelector('audio[src="/media/song-a.mp3"]')).toBeTruthy();
  });

  it("uses the lightweight preview URL for image cards", () => {
    const { container } = render(
      <GraphNodeMediaPreview
        nodeId="preview-image"
        data={makeNodeData({
          mediaPreview: {
            mediaType: "image",
            url: "/media/thumb.webp",
            fullUrl: "/media/original.png",
            label: "Image",
          },
        })}
        isLoadMedia={false}
        isSaveMedia={false}
      />,
    );

    expect(container.querySelector('img[src="/media/thumb.webp"]')).toBeTruthy();
    expect(container.querySelector('img[src="/media/original.png"]')).toBeFalsy();
  });

  it("renders compact duration and resolution metadata for a video preview", () => {
    render(
      <GraphNodeMediaPreview
        nodeId="load-video"
        data={makeNodeData({
          mediaPreview: {
            mediaType: "video",
            url: "/media/driving.mp4",
            label: "Driving video",
            durationLabel: "20.1s",
            aspectLabel: "9:16",
            resolutionLabel: "720x1280",
          },
        })}
        isLoadMedia
        isSaveMedia={false}
      />,
    );

    expect(screen.getByText("20.1s")).toBeTruthy();
    expect(screen.getByText("9:16")).toBeTruthy();
    expect(screen.getByText("720x1280")).toBeTruthy();
  });

  it("opens the media library from an empty load-image preview", () => {
    const onOpenImageLibrary = vi.fn();
    render(
      <GraphNodeMediaPreview
        nodeId="load-portrait"
        data={makeNodeData({
          definition: {
            type: "media.load_image",
            title: "Load Image",
            category: "Media",
            ports: { inputs: [], outputs: [] },
            fields: [],
          },
          onOpenImageLibrary,
        })}
        isLoadMedia
        isSaveMedia={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose media from library" }));

    expect(onOpenImageLibrary).toHaveBeenCalledWith("load-portrait", "image");
  });

  it("opens the media library with the load-video media type", () => {
    const onOpenImageLibrary = vi.fn();
    render(
      <GraphNodeMediaPreview
        nodeId="load-motion"
        data={makeNodeData({
          definition: {
            type: "media.load_video",
            title: "Load Video",
            category: "Media",
            ports: { inputs: [], outputs: [] },
            fields: [],
          },
          onOpenImageLibrary,
        })}
        isLoadMedia
        isSaveMedia={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose media from library" }));

    expect(onOpenImageLibrary).toHaveBeenCalledWith("load-motion", "video");
  });

  it("opens replacement once for one complete pointer click sequence", () => {
    const onOpenImageLibrary = vi.fn();
    const onOpenEvent = vi.fn();
    window.addEventListener("graph-studio-open-image-library", onOpenEvent);
    render(
      <GraphNodeMediaPreview
        nodeId="load-portrait"
        data={makeNodeData({
          definition: {
            type: "media.load_image",
            title: "Load Image",
            category: "Media",
            ports: { inputs: [], outputs: [] },
            fields: [],
          },
          mediaPreview: {
            mediaType: "image",
            url: "/references/portrait-thumb.webp",
          },
          onOpenImageLibrary,
        })}
        isLoadMedia
        isSaveMedia={false}
      />,
    );

    const replace = screen.getByRole("button", {
      name: "Replace media from library",
    });
    fireEvent.pointerDown(replace);
    fireEvent.pointerUp(replace);
    fireEvent.mouseUp(replace);
    fireEvent.click(replace, { detail: 1 });

    expect(onOpenImageLibrary).toHaveBeenCalledTimes(1);
    expect(onOpenImageLibrary).toHaveBeenCalledWith("load-portrait", "image");
    expect(onOpenEvent).toHaveBeenCalledTimes(1);
    expect((onOpenEvent.mock.calls[0][0] as CustomEvent).detail).toEqual({
      nodeId: "load-portrait",
      mediaType: "image",
    });
    window.removeEventListener("graph-studio-open-image-library", onOpenEvent);
  });
});
