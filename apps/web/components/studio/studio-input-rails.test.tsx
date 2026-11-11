// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioMobileInputsContent,
  StudioSourceAttachmentStrip,
} from "@/components/studio/studio-composer-input-strips";
import {
  resolveStandardComposerSlots,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { buildAttachmentPreview } from "@/lib/studio-reference-previews";

function inputProps() {
  const onOpenPreview = vi.fn();
  return {
    inputRail: "standard" as const,
    effectiveSeedanceMode: "",
    isDragActive: false,
    seedanceFirstFrameAttachment: null,
    seedanceLastFrameAttachment: null,
    standardComposerSectionTitle: "Inputs",
    standardComposerSummaryLabel: null,
    mobileAddTilePlusIconClassName: "",
    buildAttachmentPreview,
    standardSlotRailProps: {
      slots: [],
      isDragActive: false,
      buildPreview: () => null,
      resolveVisualUrl: () => null,
      isAssetBackedImageSlot: () => false,
      onSetDragActive: vi.fn(),
      onSlotDrop: vi.fn(),
      onOpenPreview,
      onOpenSlotLibrary: vi.fn(),
      onClearSlot: vi.fn(),
      onPickFiles: vi.fn(),
    },
    onSetDragActive: vi.fn(),
    onSetFormWarning: vi.fn(),
    onDropIntoSourceSlot: vi.fn(),
    onOpenPreview,
    onOpenFrameLibrary: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onAddFiles: vi.fn(),
    onResetFileInput: vi.fn(),
  } satisfies ComponentProps<typeof StudioSourceAttachmentStrip> &
    ComponentProps<typeof StudioMobileInputsContent>;
}

afterEach(cleanup);

const image = {
  key: "source",
  label: "Source image",
  kind: "images",
  url: "/original.png",
} satisfies StudioReferencePreview;
const video = {
  key: "driving",
  label: "Driving video",
  kind: "videos",
  url: "/play.mp4",
  posterUrl: "/poster.png",
  metadataLabel: "20s · 720x1280",
} satisfies StudioReferencePreview;

describe.each([
  {
    name: "desktop",
    Component: StudioSourceAttachmentStrip,
    prefix: "studio-standard-slot",
  },
  {
    name: "mobile",
    Component: StudioMobileInputsContent,
    prefix: "studio-mobile-standard-slot",
  },
])("$name active input rails", ({ Component, prefix }) => {
  it("keeps motion source previews, sizing and separate removal callbacks", () => {
    const props = inputProps();
    const slots = resolveStandardComposerSlots({
      model: {
        input_patterns: ["motion_control"],
        image_inputs: { required_max: 1 },
        video_inputs: { required_max: 1 },
      } as never,
      attachments: [],
      sourceAsset: null,
    }).slots;
    render(
      <Component
        {...props}
        standardSlotRailProps={{
          ...props.standardSlotRailProps,
          slots,
          buildPreview: (slot) => (slot.kind === "image" ? image : video),
          resolveVisualUrl: (slot) =>
            slot.kind === "image" ? "/thumb.png" : "/poster.png",
        }}
      />,
    );
    const imageTile = screen.getByTestId(`${prefix}-slot-source-image-filled`);
    const videoTile = screen.getByTestId(`${prefix}-slot-driving-video-filled`);
    expect(imageTile.className).toContain("studio-fixed-slot-tile");
    expect(within(imageTile).getByRole("img").getAttribute("src")).toBe(
      "/thumb.png",
    );
    expect(within(videoTile).getByRole("img").getAttribute("src")).toBe(
      "/poster.png",
    );
    expect(within(videoTile).getByText("20s · 720x1280")).toBeTruthy();
    fireEvent.click(within(imageTile).getByTitle("Source image"));
    expect(props.onOpenPreview).toHaveBeenLastCalledWith(image);
    fireEvent.click(within(videoTile).getByTitle("Driving video"));
    expect(props.onOpenPreview).toHaveBeenLastCalledWith(video);
    fireEvent.click(
      within(videoTile).getByRole("button", { name: "Remove Driving video" }),
    );
    expect(
      props.standardSlotRailProps.onClearSlot,
    ).toHaveBeenCalledExactlyOnceWith(slots[1]);
    expect(props.onOpenPreview).toHaveBeenCalledTimes(2);
    expect(props.onRemoveAttachment).not.toHaveBeenCalled();
    const replaceImage = within(imageTile).getByRole("button", {
      name: "Replace Source image",
    });
    fireEvent.click(replaceImage);
    fireEvent.click(screen.getByText("Choose from library"));
    expect(
      props.standardSlotRailProps.onOpenSlotLibrary,
    ).toHaveBeenCalledExactlyOnceWith(slots[0], replaceImage);
    const replaceVideo = within(videoTile).getByLabelText(
      "Replace Driving video",
    );
    expect(replaceVideo.getAttribute("accept")).toBe("video/*");
    const files = [new File([], "drive.mp4", { type: "video/mp4" })];
    fireEvent.change(replaceVideo, { target: { files } });
    expect(
      props.standardSlotRailProps.onPickFiles,
    ).toHaveBeenCalledExactlyOnceWith(slots[1], files, replaceVideo, true);
    expect(props.onOpenPreview).toHaveBeenCalledTimes(2);
  });

  it("keeps first/last frame upload inputs mapped to the correct slot", () => {
    const props = inputProps();
    const slots = resolveStandardComposerSlots({
      model: {
        input_patterns: ["first_last_frames"],
        image_inputs: { required_max: 2 },
      } as never,
      attachments: [],
      sourceAsset: null,
    }).slots;
    render(
      <Component
        {...props}
        standardSlotRailProps={{ ...props.standardSlotRailProps, slots }}
      />,
    );
    const start = screen.getByTestId(`${prefix}-slot-start-frame`);
    const end = screen.getByTestId(`${prefix}-slot-end-frame`);
    expect(start.getAttribute("accept")).toBe("image/*");
    expect(end.getAttribute("accept")).toBe("image/*");
    const files = [new File([], "frame.png", { type: "image/png" })];
    fireEvent.change(end, { target: { files } });
    expect(
      props.standardSlotRailProps.onPickFiles,
    ).toHaveBeenCalledExactlyOnceWith(slots[1], files, end);
    fireEvent.drop(start.closest("label")!);
    expect(
      props.standardSlotRailProps.onSlotDrop,
    ).toHaveBeenCalledExactlyOnceWith(expect.anything(), slots[0]);
  });

  it("opens the library for the chosen filled frame without changing the other", () => {
    const props = inputProps();
    const slots = resolveStandardComposerSlots({
      model: {
        input_patterns: ["first_last_frames"],
        image_inputs: { required_max: 2 },
      } as never,
      attachments: [],
      sourceAsset: null,
    }).slots;
    render(
      <Component
        {...props}
        standardSlotRailProps={{
          ...props.standardSlotRailProps,
          slots,
          buildPreview: (slot) => ({
            ...image,
            label: slot.label,
            url: `/${slot.id}.png`,
          }),
        }}
      />,
    );
    const end = within(
      screen.getByTestId(`${prefix}-slot-end-frame-filled`),
    ).getByRole("button", { name: `Replace ${slots[1].label}` });
    fireEvent.click(end);
    fireEvent.click(screen.getByText("Choose from library"));
    expect(
      props.standardSlotRailProps.onOpenSlotLibrary,
    ).toHaveBeenCalledExactlyOnceWith(slots[1], end);
    expect(props.standardSlotRailProps.onClearSlot).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId(`${prefix}-slot-start-frame-filled`))
        .getByRole("img")
        .getAttribute("src"),
    ).toBe("/slot-start-frame.png");
  });

  it("keeps Seedance frame preview labels, open and removal", () => {
    const props = inputProps();
    const first: AttachmentRecord = {
      id: "first",
      file: null,
      kind: "images",
      role: "first_frame",
      previewUrl: "/first.png",
    };
    const last: AttachmentRecord = {
      ...first,
      id: "last",
      role: "last_frame",
      previewUrl: "/last.png",
    };
    render(
      <Component
        {...props}
        inputRail="seedance"
        effectiveSeedanceMode="first_last_frames"
        seedanceFirstFrameAttachment={first}
        seedanceLastFrameAttachment={last}
      />,
    );
    fireEvent.click(screen.getByTitle("End frame"));
    expect(props.onOpenPreview.mock.calls[0][0]).toMatchObject({
      key: "attachment:last",
      label: "End frame",
      url: "/last.png",
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove End frame" }));
    expect(props.onRemoveAttachment).toHaveBeenCalledExactlyOnceWith("last");
    expect(props.onOpenPreview).toHaveBeenCalledTimes(1);
  });
});
