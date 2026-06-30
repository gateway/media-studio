// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphImageSelectorDialog } from "./graph-image-selector-dialog";
import type { MediaImagePickerItem } from "@/components/media/media-image-picker-types";

const generatedItems: MediaImagePickerItem[] = [
  {
    id: "asset-1",
    source: "generated-image",
    previewUrl: "/generated-asset.webp",
    ariaLabel: "Use generated skyline",
    alt: "Generated skyline",
    width: 1344,
    height: 768,
  },
];

const importedItems: MediaImagePickerItem[] = [
  {
    id: "reference-1",
    source: "reference-image",
    previewUrl: "/imported-reference.webp",
    ariaLabel: "Use imported portrait",
    alt: "Imported portrait",
    filename: "portrait-reference.png",
    width: 1024,
    height: 1024,
  },
];

const generatedVideoItems: MediaImagePickerItem[] = [
  {
    id: "asset-video-1",
    source: "generated-video",
    mediaType: "video",
    previewUrl: "/generated-video-poster.webp",
    ariaLabel: "Use generated video asset-video-1",
    alt: "Generated video",
    filename: "motion.mp4",
    width: 720,
    height: 1280,
    durationSeconds: 5,
    trimReady: true,
  },
];

const emptySource = {
  items: [],
  loading: false,
  loadingMore: false,
  nextOffset: null,
  selectionId: null,
};

function renderSelector(
  overrides: Partial<Parameters<typeof GraphImageSelectorDialog>[0]> = {},
) {
  const props: Parameters<typeof GraphImageSelectorDialog>[0] = {
    open: true,
    mode: { kind: "add-node" },
    generated: {
      ...emptySource,
      items: generatedItems,
      nextOffset: 24,
    },
    imported: {
      ...emptySource,
      items: importedItems,
    },
    searchQuery: "",
    onClose: vi.fn(),
    onSearchChange: vi.fn(),
    onLoadMore: vi.fn(),
    onAddNode: vi.fn(),
    onAttachToNode: vi.fn(),
    ...overrides,
  };

  return { ...render(<GraphImageSelectorDialog {...props} />), props };
}

afterEach(() => {
  cleanup();
});

describe("GraphImageSelectorDialog", () => {
  it("uses one tabbed grid and routes generated selection through add-node mode", () => {
    const { props } = renderSelector();

    expect(screen.getByRole("dialog", { name: "Image Assets" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Generated" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Use generated skyline" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use imported portrait" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use generated skyline" }));

    expect(props.onAddNode).toHaveBeenCalledWith({ asset_id: "asset-1" });
    expect(props.onAttachToNode).not.toHaveBeenCalled();
  });

  it("routes imported selection through attach-node mode with the target node id", () => {
    const { props } = renderSelector({
      mode: { kind: "attach-node", nodeId: "node-load-image-1" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Imported" }));
    fireEvent.click(screen.getByRole("button", { name: "Use imported portrait" }));

    expect(props.onAttachToNode).toHaveBeenCalledWith("node-load-image-1", {
      reference_id: "reference-1",
    });
    expect(props.onAddNode).not.toHaveBeenCalled();
  });

  it("reports source-backed search and load-more requests for the active tab", () => {
    const { props } = renderSelector();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search image assets" }), {
      target: { value: "Sadie" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Load more generated image assets" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Imported" }));

    expect(props.onSearchChange).toHaveBeenNthCalledWith(1, "generated", "Sadie");
    expect(props.onLoadMore).toHaveBeenCalledWith("generated");
    expect(props.onSearchChange).toHaveBeenNthCalledWith(2, "imported", "Sadie");
  });

  it("keeps the active tab when a parent-controlled search query updates", () => {
    const { props, rerender } = renderSelector();

    fireEvent.click(screen.getByRole("tab", { name: "Imported" }));
    rerender(<GraphImageSelectorDialog {...props} searchQuery="Sadie" />);

    expect(
      screen.getByRole("tab", { name: "Imported" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("searchbox", { name: "Search image assets" })).toHaveProperty(
      "value",
      "Sadie",
    );
  });

  it("shows loading and empty states for each source", () => {
    renderSelector({
      generated: {
        ...emptySource,
        loading: true,
      },
      imported: emptySource,
    });

    expect(screen.getByText("Loading generated images...")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Imported" }));

    expect(screen.getByText("No imported images found.")).toBeTruthy();
  });

  it("switches labels and controls for video mode", () => {
    renderSelector({
      mediaType: "video",
      generated: {
        ...emptySource,
        items: generatedVideoItems,
        nextOffset: 24,
      },
    });

    expect(screen.getByRole("dialog", { name: "Video Assets" })).toBeTruthy();
    expect(
      screen.getByText(
        "Search generated videos or imported reference videos from one selector.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("searchbox", { name: "Search video assets" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tablist", { name: "Video asset source" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Load more generated video assets" }),
    ).toBeTruthy();
    expect(screen.getByText("Global generated videos exclude hidden-project media.")).toBeTruthy();
  });

  it("offers explicit project selection without mixing hidden media into global scope", () => {
    const { props } = renderSelector({
      projectOptions: [
        {
          projectId: "project-sadi",
          label: "Sadi",
          status: "active",
          hiddenFromGlobalGallery: true,
        },
      ],
      onProjectScopeChange: vi.fn(),
    });

    expect(
      screen.getByText("Global generated images exclude hidden-project media."),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Image asset project" }), {
      target: { value: "project-sadi" },
    });

    expect(props.onProjectScopeChange).toHaveBeenCalledWith(
      "generated",
      "project-sadi",
    );
  });
});
