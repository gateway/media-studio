// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaImagePickerDialog } from "./media-image-picker-dialog";
import type { MediaImagePickerItem } from "./media-image-picker-types";

const items: MediaImagePickerItem[] = [
  {
    id: "image-1",
    previewUrl: "/image-1.webp",
    ariaLabel: "Use image one",
    alt: "Image one",
    filename: "portrait.png",
    width: 1024,
    height: 1536,
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MediaImagePickerDialog", () => {
  it("uses full-image containment for reference picking", () => {
    render(
      <MediaImagePickerDialog
        open
        dialogLabel="Reference image picker"
        eyebrow="Reference Images"
        title="Choose a reference image"
        items={items}
        loading={false}
        loadingMore={false}
        nextOffset={null}
        selectionId={null}
        purpose="reference"
        imageFit="contain"
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.getByAltText("Image one").className).toContain(
      "object-contain",
    );
    expect(screen.getByText("portrait.png")).toBeTruthy();
    expect(screen.getByText("portrait.png").className).toContain(
      "media-image-picker-tile-filename",
    );
    expect(screen.getByText("1024x1536").className).toBe(
      "media-image-picker-tile-dimensions",
    );
    expect(
      screen.getByText("1024x1536").closest(".media-image-picker-tile-meta")
        ?.className,
    ).toBe("media-image-picker-tile-meta");
  });

  it("uses full-image containment for thumbnail picking and removes duplicate footer close", () => {
    render(
      <MediaImagePickerDialog
        open
        dialogLabel="Generated image thumbnails"
        title="Choose a thumbnail"
        items={items}
        loading={false}
        loadingMore={false}
        nextOffset={null}
        selectionId={null}
        purpose="thumbnail"
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.getByAltText("Image one").className).toContain(
      "object-contain",
    );
    expect(
      screen.getByRole("button", { name: "Close Generated image thumbnails" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("renders video metadata rows and trim readiness", () => {
    render(
      <MediaImagePickerDialog
        open
        dialogLabel="Video picker"
        title="Choose a video"
        items={[
          {
            id: "video-1",
            source: "reference-video",
            mediaType: "video",
            previewUrl: "/video-1.webp",
            fullUrl: "/video-1.mp4",
            ariaLabel: "Use imported driving video",
            alt: "Driving video",
            filename: "driving-video.mp4",
            width: 1920,
            height: 1080,
            durationSeconds: 65.4,
            sourceLabel: "Imported",
            projectLabel: "project-motion",
            trimReady: true,
          },
        ]}
        loading={false}
        loadingMore={false}
        nextOffset={null}
        selectionId={null}
        purpose="reference"
        imageFit="cover"
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Use imported driving video" })).toBeTruthy();
    expect(screen.getByText("Use video")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview video video-1" })).toBeTruthy();
    expect(screen.getByText("Duration")).toBeTruthy();
    expect(screen.getByText("1m 05s")).toBeTruthy();
    expect(screen.getByText("Resolution")).toBeTruthy();
    expect(screen.getAllByText("1920x1080").length).toBeGreaterThan(0);
    expect(screen.getByText("Aspect")).toBeTruthy();
    expect(screen.getByText("16:9")).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Imported")).toBeTruthy();
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("project-motion")).toBeTruthy();
    expect(screen.getByText("Trim")).toBeTruthy();
    expect(screen.getByText("Ready for Trim Video")).toBeTruthy();
  });

  it("renders audio metadata rows", () => {
    render(
      <MediaImagePickerDialog
        open
        dialogLabel="Audio picker"
        title="Choose audio"
        items={[
          {
            id: "audio-1",
            source: "reference-audio",
            mediaType: "audio",
            previewUrl: null,
            fullUrl: "/audio-1.wav",
            ariaLabel: "Use imported dialog audio",
            alt: "Dialog audio",
            filename: "dialog-line.wav",
            durationSeconds: 2,
            formatLabel: "WAV",
            sourceLabel: "Imported",
            projectLabel: "project-audio",
          },
        ]}
        loading={false}
        loadingMore={false}
        nextOffset={null}
        selectionId={null}
        purpose="reference"
        imageFit="cover"
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Use imported dialog audio" })).toBeTruthy();
    expect(screen.getByText("Use audio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview audio audio-1" })).toBeTruthy();
    expect(screen.getByText("dialog-line.wav")).toBeTruthy();
    expect(screen.getByText("Duration")).toBeTruthy();
    expect(screen.getByText("2s")).toBeTruthy();
    expect(screen.getByText("Format")).toBeTruthy();
    expect(screen.getByText("WAV")).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Imported")).toBeTruthy();
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("project-audio")).toBeTruthy();
    expect(screen.queryByText("Trim")).toBeNull();
  });

  it("previews the full image without selecting the tile", () => {
    const onSelectItem = vi.fn();
    render(
      <MediaImagePickerDialog
        open
        dialogLabel="Generated image thumbnails"
        title="Choose a thumbnail"
        items={items}
        loading={false}
        loadingMore={false}
        nextOffset={null}
        selectionId={null}
        purpose="thumbnail"
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSelectItem={onSelectItem}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Preview image image-1" }),
    );

    expect(onSelectItem).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeTruthy();
    expect(
      screen.getByText(/Review the full image before selecting it\./),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close image preview" }),
    ).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
  });

  it("uses a scroll sentinel instead of a Load More button", () => {
    const onLoadMore = vi.fn();
    let callback: IntersectionObserverCallback | null = null;
    class MockIntersectionObserver {
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    render(
      <MediaImagePickerDialog
        open
        dialogLabel="Generated image thumbnails"
        title="Choose a thumbnail"
        items={items}
        loading={false}
        loadingMore={false}
        nextOffset={24}
        selectionId={null}
        onClose={vi.fn()}
        onLoadMore={onLoadMore}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    expect(screen.queryByText(/scroll to load more images/i)).toBeNull();
    callback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("exposes accessible labels, loading status, keyboard-selectable tiles, and focus return", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open picker";
    document.body.appendChild(opener);
    opener.focus();
    const onSelectItem = vi.fn();

    const { rerender } = render(
      <MediaImagePickerDialog
        open
        dialogLabel="Reference image picker"
        eyebrow="Reference Images"
        title="Choose a reference image"
        description="Pick one reference image."
        items={items}
        loading={false}
        loadingMore
        nextOffset={24}
        selectionId={null}
        purpose="reference"
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSelectItem={onSelectItem}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Reference image picker",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toContain(" ");
    expect(
      document.querySelector(".media-image-picker-header")?.className,
    ).toBe("media-image-picker-header");
    expect(
      document.querySelector(".media-image-picker-footer div")?.className,
    ).toBe("media-image-picker-footer-count");
    expect(screen.getByRole("status").textContent).toBe("Loading more images.");

    const tile = screen.getByRole("button", { name: "Use image one" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(tile.getAttribute("data-media-image-id")).toBe("image-1");
    expect(tile.closest(".media-image-picker-tile-shell")?.className).toBe(
      "media-image-picker-tile-shell",
    );
    expect(
      tile.querySelector(".media-image-picker-tile-frame")?.className,
    ).toContain("media-image-picker-tile-frame");
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(onSelectItem).toHaveBeenCalledWith("image-1");

    rerender(
      <MediaImagePickerDialog
        open={false}
        dialogLabel="Reference image picker"
        title="Choose a reference image"
        items={items}
        loading={false}
        loadingMore={false}
        nextOffset={null}
        selectionId={null}
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    );

    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});
