// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeneratedThumbnailPickerDialog } from "./generated-thumbnail-picker-dialog";
import type { GeneratedThumbnailPickerItem } from "./generated-thumbnail-picker-dialog";

const items: GeneratedThumbnailPickerItem[] = [
  {
    id: "asset-1",
    source: "generated-image",
    previewUrl: "/thumb.webp",
    fullUrl: "/original.png",
    ariaLabel: "Use generated image asset-1 as preset thumbnail",
    alt: "Generated thumbnail",
    width: 1536,
    height: 1024,
  },
];

afterEach(() => {
  cleanup();
});

describe("GeneratedThumbnailPickerDialog", () => {
  it("shows the complete generated image through the shared picker wrapper", () => {
    render(
      <GeneratedThumbnailPickerDialog
        open
        dialogLabel="Generated image thumbnails"
        title="Choose a thumbnail"
        description="Pick a recent generated image."
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

    const image = screen.getByAltText("Generated thumbnail");
    const tile = screen.getByRole("button", {
      name: "Use generated image asset-1 as preset thumbnail",
    });

    expect(
      screen.getByRole("dialog", { name: "Generated image thumbnails" }),
    ).toBeTruthy();
    expect(image.className).toContain("object-contain");
    expect(tile.getAttribute("data-media-image-id")).toBe("asset-1");
    expect(tile.getAttribute("data-media-image-source")).toBe(
      "generated-image",
    );
    expect(
      screen.getByRole("button", { name: "Preview image asset-1" }),
    ).toBeTruthy();
    expect(screen.getByText("1536x1024").className).toBe(
      "media-image-picker-tile-dimensions",
    );
    expect(screen.queryByText("/original.png")).toBeNull();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
