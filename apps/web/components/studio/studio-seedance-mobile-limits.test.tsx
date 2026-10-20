// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioMobileInputsContent } from "@/components/studio/studio-mobile-inputs-content";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { buildAttachmentPreview } from "@/lib/studio-reference-previews";

afterEach(cleanup);

function props() {
  return {
    inputRail: "seedance", effectiveSeedanceMode: "multimodal_reference",
    maxImageReferences: 30, maxVideoReferences: 10, maxAudioReferences: 10,
    imageLimitLabel: null, orderedImageInputs: [], canAddMoreImages: false, isDragActive: false,
    seedanceFirstFrameAttachment: null, seedanceLastFrameAttachment: null,
    seedanceReferenceImages: [], seedanceReferenceVideos: [], seedanceReferenceAudios: [],
    standardComposerSectionTitle: "Inputs", standardComposerSummaryLabel: null, standardComposerSlots: [],
    mobileAddTileClassName: "", mobileAddTilePlusIconClassName: "",
    buildOrderedImageInputPreview: () => null, buildAttachmentPreview,
    standardComposerSlotPreview: () => null, standardComposerSlotVisual: () => null,
    onSetDragActive: vi.fn(), onSetFormWarning: vi.fn(), onDropIntoSourceSlot: vi.fn(),
    onSeedanceReferenceDrop: vi.fn(), onOpenPreview: vi.fn(), onClearOrderedImageInput: vi.fn(),
    onRemoveAttachment: vi.fn(), onClearStandardComposerSlot: vi.fn(), onPickStandardComposerSlotFiles: vi.fn(),
    onAddFiles: vi.fn(), onAddImageFilesToOrderedSlot: vi.fn(), onResetFileInput: vi.fn(),
  } satisfies ComponentProps<typeof StudioMobileInputsContent>;
}

const groups = [
  { kind: "images", field: "seedanceReferenceImages", limit: 30, oldLimit: 9, visible: 4, mime: "image/png" },
  { kind: "videos", field: "seedanceReferenceVideos", limit: 10, oldLimit: 3, visible: 3, mime: "video/mp4" },
  { kind: "audios", field: "seedanceReferenceAudios", limit: 10, oldLimit: 3, visible: 3, mime: "audio/wav" },
] as const;

function references(kind: AttachmentRecord["kind"], count: number): AttachmentRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index}`, kind, role: "reference", file: null, previewUrl: `/reference-${index}`,
  }));
}

describe.each(groups)("phone Seedance $kind limits", ({ kind, field, limit, oldLimit, visible, mime }) => {
  it.each([0, oldLimit, limit - 1, limit, limit + 1])("uses model capacity at %i references", (count) => {
    render(<StudioMobileInputsContent {...props()} {...{ [field]: references(kind, count) }} />);
    expect(screen.getAllByText(`${count} / ${limit}`).length).toBeGreaterThan(0);
    expect(Boolean(screen.queryByTestId(`studio-mobile-seedance-group-input-${kind}`))).toBe(count < limit);
    if (count > visible) expect(screen.getByText(`+${count - visible}`)).toBeTruthy();
  });

  it("updates controls when switching 2.0 → 2.5 → 2.0 without losing references", () => {
    const base = props();
    const attachments = references(kind, oldLimit);
    const low = { maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3 };
    const { rerender } = render(<StudioMobileInputsContent {...base} {...low} {...{ [field]: attachments }} />);
    const inputId = `studio-mobile-seedance-group-input-${kind}`;
    expect(screen.queryByTestId(inputId)).toBeNull();
    rerender(<StudioMobileInputsContent {...base} {...{ [field]: attachments }} />);
    expect(screen.getByTestId(inputId)).toBeTruthy();
    expect(screen.getAllByText(`${oldLimit} / ${limit}`).length).toBeGreaterThan(0);
    rerender(<StudioMobileInputsContent {...base} {...low} {...{ [field]: attachments }} />);
    expect(screen.queryByTestId(inputId)).toBeNull();
    expect(screen.getAllByText(`${oldLimit} / ${oldLimit}`).length).toBeGreaterThan(0);
    expect(base.onRemoveAttachment).not.toHaveBeenCalled();
  });

  it("restores adding after removal below capacity without opening a preview", () => {
    const base = props();
    const attachments = references(kind, limit);
    const { rerender } = render(<StudioMobileInputsContent {...base} {...{ [field]: attachments }} />);
    expect(screen.queryByTestId(`studio-mobile-seedance-group-input-${kind}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`studio-mobile-seedance-group-tile-${kind}-${kind}-0-remove`));
    expect(base.onRemoveAttachment).toHaveBeenCalledWith(`${kind}-0`);
    expect(base.onOpenPreview).not.toHaveBeenCalled();
    rerender(<StudioMobileInputsContent {...base} {...{ [field]: attachments.slice(1) }} />);
    expect(screen.getByTestId(`studio-mobile-seedance-group-input-${kind}`)).toBeTruthy();
  });

  it("keeps upload kind, reference role and input reset", () => {
    const base = props();
    render(<StudioMobileInputsContent {...base} />);
    const input = screen.getByTestId(`studio-mobile-seedance-group-input-${kind}`);
    const files = [new File([], "reference", { type: mime })];
    fireEvent.change(input, { target: { files } });
    expect(base.onAddFiles).toHaveBeenCalledExactlyOnceWith(files, { role: "reference", allowedKinds: [kind] });
    expect(base.onResetFileInput).toHaveBeenCalledExactlyOnceWith(input);
  });
});

it("hides all reference add controls for a zero-capacity model", () => {
  render(<StudioMobileInputsContent {...props()} maxImageReferences={0} maxVideoReferences={0} maxAudioReferences={0} />);
  expect(screen.getAllByText("0 / 0")).toHaveLength(3);
  for (const { kind } of groups) expect(screen.queryByTestId(`studio-mobile-seedance-group-input-${kind}`)).toBeNull();
});
