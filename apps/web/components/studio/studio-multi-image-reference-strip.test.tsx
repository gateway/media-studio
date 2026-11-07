// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioComposer } from "@/components/studio/studio-composer";
import { StudioMultiImageReferenceStrip } from "@/components/studio/studio-multi-image-reference-strip";
import { orderedImageInputPreview } from "@/lib/studio-reference-previews";

type StripProps = ComponentProps<typeof StudioMultiImageReferenceStrip>;

function referenceStripProps() {
  return {
    imageLimitLabel: "0 / 16 images",
    orderedImageInputs: [],
    canAddMoreImages: true,
    suspended: false,
    isDragActive: false,
    buildOrderedImageInputPreview: orderedImageInputPreview,
    onOpenPreview: vi.fn(),
    onOpenLibrary: vi.fn(),
    onClearOrderedImageInput: vi.fn(),
    onSetDragActive: vi.fn(),
    onDropIntoSlot: vi.fn(),
    onAddImageFilesToOrderedSlot: vi.fn(),
    onReplaceImageFile: vi.fn(),
  } satisfies Omit<StripProps, "expanded" | "onExpandedChange">;
}

function ReferenceStripHarness(
  props: Omit<StripProps, "expanded" | "onExpandedChange">,
) {
  const [expanded, setExpanded] = useState(false);
  return (
    <StudioComposer
      immersive
      composerCollapsed={false}
      mobileComposerCollapsed={false}
      mobileComposerExpanded
      currentModelLabel="Image model"
      formattedRemainingCredits={null}
      estimatedCredits={null}
      structuredPresetActive={false}
      presetLabel={null}
      floatingComposerStatus={null}
      onToggleCollapsed={vi.fn()}
      onToggleComposerCollapsed={vi.fn()}
      orderedImageReferences={
        <StudioMultiImageReferenceStrip
          {...props}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      }
    >
      <label>
        Prompt <textarea />
      </label>
    </StudioComposer>
  );
}

afterEach(cleanup);

it("keeps the compact drop target available outside the thumbnails until capacity", () => {
  const props = referenceStripProps();
  const { rerender } = render(<ReferenceStripHarness {...props} />);
  const add = screen.getByLabelText("Add image references");
  const references = Array.from(
    { length: 16 },
    (_, index): StripProps["orderedImageInputs"][number] => ({
      source: "attachment",
      attachment: {
        id: String(index),
        file: null,
        kind: "images",
        previewUrl: `/${index}.png`,
      },
    }),
  );

  rerender(
    <ReferenceStripHarness
      {...props}
      imageLimitLabel="4 / 16 images"
      orderedImageInputs={references.slice(0, 4)}
    />,
  );
  expect(screen.getByText("4/16")).toBeTruthy();
  expect(screen.getByLabelText("Add image references")).toBe(add);
  const thumbnails = screen.getByTestId(
    "studio-multi-image-slot-4",
  ).parentElement;
  expect(thumbnails?.contains(add)).toBe(false);
  fireEvent.drop(add.closest("label")!);
  expect(props.onDropIntoSlot).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    4,
  );

  rerender(
    <ReferenceStripHarness
      {...props}
      imageLimitLabel="16 / 16 images"
      orderedImageInputs={references}
      canAddMoreImages={false}
    />,
  );
  expect(screen.getByText("16/16")).toBeTruthy();
  expect(screen.queryByLabelText("Add image references")).toBeNull();
});

it("keeps the ordered reference actions available when the mobile composer and references are expanded", () => {
  const first = {
    source: "attachment",
    attachment: {
      id: "first",
      file: null,
      kind: "images",
      previewUrl: "/first.png",
    },
  } satisfies StripProps["orderedImageInputs"][number];
  const second = {
    source: "attachment",
    attachment: {
      ...first.attachment,
      id: "second",
      previewUrl: "/second.png",
    },
  } satisfies StripProps["orderedImageInputs"][number];
  const callbacks = referenceStripProps();
  render(
    <ReferenceStripHarness
      {...callbacks}
      imageLimitLabel="2 / 16 images"
      orderedImageInputs={[first, second]}
    />,
  );

  const expand = screen.getByRole("button", {
    name: "Expand image references",
  });
  expect(screen.getByText("2/16")).toBeTruthy();
  expand.focus();
  fireEvent.click(expand);

  const dialog = screen.getByRole("dialog", { name: "References" });
  const expanded = within(dialog);
  expect(screen.getAllByTestId("studio-multi-image-slot-1")).toHaveLength(1);
  expect(
    expanded
      .getByTestId("studio-multi-image-slot-1")
      .querySelector("img")
      ?.getAttribute("src"),
  ).toBe("/first.png");
  expect(
    expanded
      .getByTestId("studio-multi-image-slot-2")
      .querySelector("img")
      ?.getAttribute("src"),
  ).toBe("/second.png");

  const replace = expanded.getByLabelText("Replace image reference 2");
  fireEvent.change(replace, { target: { files: [] } });
  expect(callbacks.onReplaceImageFile).not.toHaveBeenCalled();
  const files = [new File([], "image.png", { type: "image/png" })];
  fireEvent.change(replace, { target: { files } });
  expect(callbacks.onReplaceImageFile).toHaveBeenCalledExactlyOnceWith(
    files,
    second,
    replace,
  );

  const add = expanded.getByLabelText("Add image references");
  fireEvent.change(add, { target: { files } });
  expect(
    callbacks.onAddImageFilesToOrderedSlot,
  ).toHaveBeenCalledExactlyOnceWith(files, 2, add);
  fireEvent.drop(add.closest("label")!);
  expect(callbacks.onDropIntoSlot).toHaveBeenCalledWith(expect.anything(), 2);

  fireEvent.click(expanded.getByRole("button", { name: "Image reference 1" }));
  expect(callbacks.onOpenPreview).toHaveBeenCalledWith(
    expect.objectContaining({ url: "/first.png" }),
  );
  fireEvent.click(
    expanded.getByRole("button", { name: "Remove Image reference 2" }),
  );
  expect(callbacks.onClearOrderedImageInput).toHaveBeenCalledExactlyOnceWith(
    second,
  );
  fireEvent.click(
    expanded.getByRole("button", { name: "Choose from library" }),
  );
  expect(callbacks.onOpenLibrary).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "References" })).toBeNull();
  expect(document.activeElement).toBe(expand);
});
