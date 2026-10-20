// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioMobileInputsContent, StudioSourceAttachmentStrip } from "@/components/studio/studio-composer-input-strips";
import { resolveStandardComposerSlots, type StudioReferencePreview } from "@/lib/media-studio-helpers";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { buildAttachmentPreview } from "@/lib/studio-reference-previews";

function inputProps() {
  return {
    inputRail: "standard" as const,
    effectiveSeedanceMode: "",
    imageLimitLabel: null,
    orderedImageInputs: [],
    canAddMoreImages: false,
    isDragActive: false,
    seedanceFirstFrameAttachment: null,
    seedanceLastFrameAttachment: null,
    seedanceReferenceImages: [],
    seedanceReferenceVideos: [],
    seedanceReferenceAudios: [],
    standardComposerSectionTitle: "Inputs",
    standardComposerSummaryLabel: null,
    standardComposerSlots: [],
    mobileAddTileClassName: "",
    mobileAddTilePlusIconClassName: "",
    buildOrderedImageInputPreview: () => null,
    buildAttachmentPreview,
    standardComposerSlotPreview: () => null,
    standardComposerSlotVisual: () => null,
    onSetDragActive: vi.fn(),
    onSetFormWarning: vi.fn(),
    onDropIntoSourceSlot: vi.fn(),
    onSeedanceReferenceDrop: vi.fn(),
    onOpenPreview: vi.fn(),
    onClearOrderedImageInput: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onClearStandardComposerSlot: vi.fn(),
    onPickStandardComposerSlotFiles: vi.fn(),
    onAddFiles: vi.fn(),
    onAddImageFilesToOrderedSlot: vi.fn(),
    onResetFileInput: vi.fn(),
  } satisfies ComponentProps<typeof StudioSourceAttachmentStrip> & ComponentProps<typeof StudioMobileInputsContent>;
}


afterEach(cleanup);

const image = { key: "source", label: "Source image", kind: "images", url: "/original.png" } satisfies StudioReferencePreview;
const video = { key: "driving", label: "Driving video", kind: "videos", url: "/play.mp4", posterUrl: "/poster.png", metadataLabel: "20s · 720x1280" } satisfies StudioReferencePreview;

describe.each([
  { name: "desktop", Component: StudioSourceAttachmentStrip, prefix: "studio-standard-slot", size: "h-full w-full" },
  { name: "mobile", Component: StudioMobileInputsContent, prefix: "studio-mobile-standard-slot", size: "h-[72px]" },
])("$name active input rails", ({ Component, prefix, size }) => {
  it("keeps motion source previews, sizing and separate removal callbacks", () => {
    const props = inputProps();
    const slots = resolveStandardComposerSlots({
      model: { input_patterns: ["motion_control"], image_inputs: { required_max: 1 }, video_inputs: { required_max: 1 } } as never,
      attachments: [], sourceAsset: null,
    }).slots;
    render(<Component {...props} standardComposerSlots={slots}
      standardComposerSlotPreview={(slot) => slot.kind === "image" ? image : video}
      standardComposerSlotVisual={(slot) => slot.kind === "image" ? "/thumb.png" : "/poster.png"} />);
    const imageTile = screen.getByTestId(`${prefix}-slot-source-image-filled`);
    const videoTile = screen.getByTestId(`${prefix}-slot-driving-video-filled`);
    expect(imageTile.className).toContain(size);
    expect(within(imageTile).getByRole("img").getAttribute("src")).toBe("/thumb.png");
    expect(within(videoTile).getByRole("img").getAttribute("src")).toBe("/poster.png");
    expect(within(videoTile).getByText("20s · 720x1280")).toBeTruthy();
    fireEvent.click(within(imageTile).getByTitle("Source image"));
    expect(props.onOpenPreview).toHaveBeenLastCalledWith(image);
    fireEvent.click(within(videoTile).getByTitle("Driving video"));
    expect(props.onOpenPreview).toHaveBeenLastCalledWith(video);
    fireEvent.click(within(videoTile).getByRole("button", { name: "Remove Driving video" }));
    expect(props.onClearStandardComposerSlot).toHaveBeenCalledExactlyOnceWith(slots[1]);
    expect(props.onOpenPreview).toHaveBeenCalledTimes(2);
    expect(props.onRemoveAttachment).not.toHaveBeenCalled();
  });

  it("keeps first/last frame upload inputs mapped to the correct slot", () => {
    const props = inputProps();
    const slots = resolveStandardComposerSlots({
      model: { input_patterns: ["first_last_frames"], image_inputs: { required_max: 2 } } as never,
      attachments: [], sourceAsset: null,
    }).slots;
    render(<Component {...props} standardComposerSlots={slots} />);
    const start = screen.getByTestId(`${prefix}-slot-start-frame`);
    const end = screen.getByTestId(`${prefix}-slot-end-frame`);
    expect(start.getAttribute("accept")).toBe("image/*");
    expect(end.getAttribute("accept")).toBe("image/*");
    const files = [new File([], "frame.png", { type: "image/png" })];
    fireEvent.change(end, { target: { files } });
    expect(props.onPickStandardComposerSlotFiles).toHaveBeenCalledExactlyOnceWith(slots[1], files, end);
    fireEvent.drop(start.closest("label")!);
    expect(props.onDropIntoSourceSlot.mock.calls[0][1]).toBe(slots[0].slotIndex);
    expect(props.onDropIntoSourceSlot.mock.calls[0][2]).toBe(slots[0]);
  });

  it("keeps Seedance frame preview labels, open and removal", () => {
    const props = inputProps();
    const first: AttachmentRecord = { id: "first", file: null, kind: "images", role: "first_frame", previewUrl: "/first.png" };
    const last: AttachmentRecord = { ...first, id: "last", role: "last_frame", previewUrl: "/last.png" };
    render(<Component {...props} inputRail="seedance" effectiveSeedanceMode="first_last_frames"
      seedanceFirstFrameAttachment={first} seedanceLastFrameAttachment={last} />);
    fireEvent.click(screen.getByTitle("End frame"));
    expect(props.onOpenPreview.mock.calls[0][0]).toMatchObject({ key: "attachment:last", label: "End frame", url: "/last.png" });
    fireEvent.click(screen.getByRole("button", { name: "Remove End frame" }));
    expect(props.onRemoveAttachment).toHaveBeenCalledExactlyOnceWith("last");
    expect(props.onOpenPreview).toHaveBeenCalledTimes(1);
  });
});
