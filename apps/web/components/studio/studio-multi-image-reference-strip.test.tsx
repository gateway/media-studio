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
    modelLabel: "GPT Image Sunburst",
    imageLimit: 16,
    orderedImageInputs: [],
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
      modelPicker={<button type="button">Image model options</button>}
      formattedRemainingCredits={null}
      estimatedCredits={null}
      structuredPresetActive={false}
      presetLabel={null}
      floatingComposerStatus={null}
      onToggleCollapsed={vi.fn()}
      onToggleComposerCollapsed={vi.fn()}
      referenceInputs={
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function imageInput(index: number): StripProps["orderedImageInputs"][number] {
  return {
    source: "attachment",
    attachment: {
      id: String(index),
      file: null,
      kind: "images",
      previewUrl: `/${index}.png`,
    },
  };
}

it("offers library and upload together until the model reaches capacity", () => {
  vi.stubGlobal("innerHeight", 760);
  const props = referenceStripProps();
  const { rerender } = render(<ReferenceStripHarness {...props} />);
  const add = screen.getByRole("button", { name: "Add image references" });
  const uploadInput = screen.getByTestId("studio-multi-image-input");
  const launchFilePicker = vi
    .spyOn(uploadInput, "click")
    .mockImplementation(() => {});
  fireEvent.click(add);
  fireEvent.click(screen.getByText("Upload file"));
  expect(launchFilePicker).toHaveBeenCalledOnce();
  expect(uploadInput.hasAttribute("multiple")).toBe(true);
  expect(document.activeElement).toBe(add);
  fireEvent.click(add);
  fireEvent.click(screen.getByText("Choose from library"));
  expect(props.onOpenLibrary).toHaveBeenCalledExactlyOnceWith(
    screen.getByRole("button", { name: "Expand image references" }),
  );
  const references = Array.from({ length: 16 }, (_, index) =>
    imageInput(index),
  );

  rerender(
    <ReferenceStripHarness
      {...props}
      orderedImageInputs={references.slice(0, 4)}
    />,
  );
  expect(screen.getByText("4/16")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add image references" })).toBe(
    add,
  );
  expect(screen.getByTestId("studio-multi-image-slot-1")).toBeTruthy();
  expect(screen.queryByTestId("studio-multi-image-slot-2")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Show 3 more image references" }),
  ).toBeTruthy();
  fireEvent.drop(add);
  expect(props.onDropIntoSlot).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    4,
  );

  rerender(
    <ReferenceStripHarness {...props} orderedImageInputs={references} />,
  );
  expect(screen.getByText("16/16")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Add image references" }),
  ).toBeNull();
  expect(screen.queryByText("Choose from library")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Show 14 more image references" }),
  ).toBeTruthy();
});

it("reveals more reference rows at tall desktop heights and falls back to one row on a phone", () => {
  vi.stubGlobal("innerWidth", 1265);
  vi.stubGlobal("innerHeight", 1292);
  const props = referenceStripProps();
  render(
    <ReferenceStripHarness
      {...props}
      orderedImageInputs={Array.from({ length: 10 }, (_, index) =>
        imageInput(index),
      )}
    />,
  );

  expect(screen.getAllByTestId(/^studio-multi-image-slot-\d+$/)).toHaveLength(
    5,
  );
  expect(
    screen.getByRole("button", { name: "Show 5 more image references" }),
  ).toBeTruthy();

  vi.stubGlobal("innerWidth", 390);
  fireEvent.resize(window);
  expect(screen.getAllByTestId(/^studio-multi-image-slot-\d+$/)).toHaveLength(
    1,
  );
  expect(
    screen.getByRole("button", { name: "Show 9 more image references" }),
  ).toBeTruthy();
});

it("routes a gallery drop on the surviving image to its current position after deletion", () => {
  const first = imageInput(0);
  const surviving = imageInput(1);
  const props = referenceStripProps();
  function EditableStrip() {
    const [orderedImageInputs, setOrderedImageInputs] = useState([
      first,
      surviving,
    ]);
    return (
      <ReferenceStripHarness
        {...props}
        orderedImageInputs={orderedImageInputs}
        onClearOrderedImageInput={(slot) => {
          setOrderedImageInputs((slots) =>
            slots.filter((item) => item !== slot),
          );
        }}
      />
    );
  }
  render(<EditableStrip />);

  fireEvent.click(
    screen.getByRole("button", { name: "Remove Image reference 1" }),
  );
  const target = screen.getByRole("img", { name: "Image reference 1" });
  expect(target.getAttribute("src")).toBe("/1.png");
  const dataTransfer = { getData: vi.fn(() => "gallery-image") };
  expect(fireEvent.dragOver(target, { dataTransfer })).toBe(false);
  fireEvent.drop(target, { dataTransfer });
  expect(props.onDropIntoSlot).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ dataTransfer }),
    0,
  );
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
      orderedImageInputs={[first, second]}
    />,
  );

  const modelControls = screen.getByRole("button", {
    name: "Image model options",
  });
  const expand = screen.getByRole("button", {
    name: "Expand image references",
  });
  expect(screen.getByText("2/16")).toBeTruthy();
  expand.focus();
  fireEvent.click(expand);

  const dialog = screen.getByRole("dialog", { name: "References" });
  const expanded = within(dialog);
  expect(expanded.getByText("GPT Image Sunburst")).toBeTruthy();
  expect(expanded.getByRole("status").textContent).toContain(
    "14 image slots available",
  );
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

  const replaceTrigger = expanded.getByRole("button", {
    name: "Replace image reference 2",
  });
  const replace = expanded.getByTestId("studio-multi-image-slot-2-replace");
  const launchFilePicker = vi
    .spyOn(replace, "click")
    .mockImplementation(() => {});
  fireEvent.click(replaceTrigger);
  fireEvent.keyDown(replaceTrigger, { key: "Escape" });
  expect(expanded.queryByText("Upload file")).toBeNull();
  expect(screen.getByRole("dialog", { name: "References" })).toBe(dialog);
  expect(document.activeElement).toBe(replaceTrigger);
  fireEvent.click(replaceTrigger);
  fireEvent.click(expanded.getByText("Upload file"));
  expect(launchFilePicker).toHaveBeenCalledOnce();
  expect(replace.hasAttribute("multiple")).toBe(false);
  fireEvent.change(replace, { target: { files: [] } });
  expect(callbacks.onReplaceImageFile).not.toHaveBeenCalled();
  const files = [new File([], "image.png", { type: "image/png" })];
  fireEvent.change(replace, { target: { files } });
  expect(callbacks.onReplaceImageFile).toHaveBeenCalledExactlyOnceWith(
    files,
    second,
    replace,
  );

  const add = expanded.getByTestId("studio-multi-image-input");
  fireEvent.change(add, { target: { files } });
  expect(
    callbacks.onAddImageFilesToOrderedSlot,
  ).toHaveBeenCalledExactlyOnceWith(files, 2, add);
  fireEvent.drop(
    expanded.getByRole("button", { name: "Add image references" }),
  );
  expect(callbacks.onDropIntoSlot).toHaveBeenCalledWith(expect.anything(), 2);

  const footerUpload = expanded.getByTestId("studio-multi-image-input-upload");
  fireEvent.change(footerUpload, { target: { files } });
  expect(callbacks.onAddImageFilesToOrderedSlot).toHaveBeenNthCalledWith(
    2,
    files,
    2,
    footerUpload,
  );
  fireEvent.drop(
    expanded.getByRole("button", { name: "Add more image references" }),
  );
  expect(callbacks.onDropIntoSlot).toHaveBeenCalledTimes(2);

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
  fireEvent.click(replaceTrigger);
  fireEvent.click(expanded.getByText("Choose from library"));
  expect(callbacks.onOpenLibrary).toHaveBeenCalledExactlyOnceWith(
    expand,
    second,
  );
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "References" })).toBeNull();
  expect(document.activeElement).toBe(expand);
  expect(screen.getByRole("button", { name: "Image model options" })).toBe(
    modelControls,
  );
  expect(screen.getByText("2/16")).toBeTruthy();
  expect(
    screen
      .getByTestId("studio-multi-image-slot-1")
      .querySelector("img")
      ?.getAttribute("src"),
  ).toBe("/first.png");
});
