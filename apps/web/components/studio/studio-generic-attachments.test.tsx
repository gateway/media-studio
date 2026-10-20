// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioMobileInputsContent, StudioSourceAttachmentStrip } from "@/components/studio/studio-composer-input-strips";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { buildAttachmentPreview } from "@/lib/studio-reference-previews";

function genericProps() {
  return {
    dedicatedImageReferenceRailActive: false,
    seedanceComposer: false,
    standardComposerUsesExplicitSlots: false,
    sourceAttachmentStripVisible: true,
    genericSourceInputsAvailable: true,
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
    currentSourceAsset: null,
    canUseSourceAsset: false,
    attachments: [] as AttachmentRecord[],
    genericSourceAddTileVisible: false,
    stagedVideoCount: 0,
    stagedAudioCount: 0,
    maxVideoInputs: 0,
    maxAudioInputs: 0,
    explicitVideoImageSlots: false,
    explicitMotionControlSlots: false,
    mobileAddTileClassName: "",
    mobileAddTilePlusIconClassName: "",
    buildOrderedImageInputPreview: () => null,
    buildAttachmentPreview,
    buildAssetReferencePreview: () => null,
    standardComposerSlotPreview: () => null,
    standardComposerSlotVisual: () => null,
    onSetDragActive: vi.fn(),
    onSetFormWarning: vi.fn(),
    onDropIntoSourceSlot: vi.fn(),
    onSeedanceReferenceDrop: vi.fn(),
    onOpenPreview: vi.fn(),
    onClearOrderedImageInput: vi.fn(),
    onClearSourceAsset: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onClearStandardComposerSlot: vi.fn(),
    onPickStandardComposerSlotFiles: vi.fn(),
    onAddFiles: vi.fn(),
    onAddImageFilesToOrderedSlot: vi.fn(),
    onResetFileInput: vi.fn(),
  } satisfies ComponentProps<typeof StudioSourceAttachmentStrip> & ComponentProps<typeof StudioMobileInputsContent>;
}

function attachment(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return { id: "image-1", file: null, kind: "images", role: null, previewUrl: "/local.png", ...overrides };
}

const referenceRecord = {
  reference_id: "ref-1", kind: "video", status: "ready", attached_project_ids: [],
  original_filename: "Library video.mp4", stored_path: "reference.mp4", mime_type: "video/mp4",
  file_size_bytes: 1, sha256: "abc", width: 720, height: 1280, duration_seconds: 20,
  stored_url: "/stored.mp4", thumb_url: "/thumb.webp", poster_url: "/poster.webp",
  usage_count: 0, last_used_at: null, metadata: {},
  created_at: "2026-06-19T00:00:00.000Z", updated_at: "2026-06-19T00:00:00.000Z",
} satisfies NonNullable<AttachmentRecord["referenceRecord"]>;

afterEach(cleanup);

describe.each([
  { name: "desktop", Component: StudioSourceAttachmentStrip, prefix: "studio-attachment-tile-", size: "h-[82px]" },
  { name: "mobile", Component: StudioMobileInputsContent, prefix: "studio-mobile-attachment-tile-", size: "h-[72px]" },
])("$name generic attachments", ({ Component, prefix, size }) => {
  it("opens the selected file and removes only its attachment without opening another preview", () => {
    const props = genericProps();
    props.attachments = [attachment({ file: new File([], "My image.png") }), attachment({ id: "image-2" })];
    render(<Component {...props} />);
    const tile = screen.getByTestId(`${prefix}image-1`);
    expect(tile.className).toContain(size);
    expect(within(tile).getByText("Image")).toBeTruthy();
    expect(within(tile).getByRole("img").getAttribute("src")).toBe("/local.png");
    fireEvent.click(within(tile).getByTitle("My image.png"));
    expect(props.onOpenPreview).toHaveBeenCalledExactlyOnceWith({
      key: "attachment:image-1", label: "My image.png", url: "/local.png", kind: "images",
      posterUrl: undefined, metadataLabel: null,
    });
    fireEvent.click(within(tile).getByRole("button", { name: "Remove My image.png" }));
    expect(props.onRemoveAttachment).toHaveBeenCalledExactlyOnceWith("image-1");
    expect(props.onOpenPreview).toHaveBeenCalledTimes(1);
    expect(props.onAddFiles).not.toHaveBeenCalled();
  });

  it("keeps saved video names, posters, playback URLs and metadata", () => {
    const props = genericProps();
    props.attachments = [attachment({ kind: "videos", previewUrl: null, referenceRecord })];
    render(<Component {...props} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/poster.webp");
    expect(screen.getByText("Video")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Library video.mp4"));
    expect(props.onOpenPreview).toHaveBeenCalledExactlyOnceWith({
      key: "attachment:image-1", label: "Library video.mp4", url: "/stored.mp4", kind: "videos",
      posterUrl: "/poster.webp", metadataLabel: "20s · 720x1280",
    });
  });

  it("honors custom preview builders and passes the original attachment, name and ID", () => {
    const props = genericProps();
    const item = attachment({ file: new File([], "Local.mp4"), referenceRecord });
    const customPreview = { key: "custom", label: "Custom", url: "/custom.mp4", kind: "videos" as const, metadataLabel: "Custom metadata" };
    const builder = vi.fn(() => customPreview);
    render(<Component {...props} attachments={[item]} buildAttachmentPreview={builder} />);
    fireEvent.click(screen.getByTitle("Custom"));
    expect(builder).toHaveBeenCalledExactlyOnceWith(item, "Local.mp4", item.id);
    expect(props.onOpenPreview).toHaveBeenCalledExactlyOnceWith(customPreview);
  });

  it.each([
    { name: "saved reference", item: attachment({ kind: "videos", previewUrl: null, referenceRecord }), label: "Library video.mp4", url: "/stored.mp4", posterUrl: "/poster.webp" },
    { name: "missing media", item: attachment({ previewUrl: null }), label: "Reference", url: "", posterUrl: null },
    { name: "empty local URL", item: attachment({ previewUrl: "", referenceRecord }), label: "Library video.mp4", url: "", posterUrl: "/poster.webp" },
  ])("retains the null-builder fallback for $name", ({ item, label, url, posterUrl }) => {
    const props = genericProps();
    render(<Component {...props} attachments={[item]} buildAttachmentPreview={() => null} />);
    fireEvent.click(screen.getByTitle(label));
    expect(props.onOpenPreview).toHaveBeenCalledExactlyOnceWith({ key: `attachment:${item.id}`, label, url, kind: item.kind, posterUrl });
  });

  it("opens audio without rendering an image and keeps the four-tile limit", () => {
    const props = genericProps();
    const audio = attachment({ id: "audio-1", kind: "audios", previewUrl: "/audio.wav" });
    render(<Component {...props} attachments={[audio, ...[2, 3, 4, 5].map((id) => attachment({ id: `image-${id}` }))]} />);
    const tile = screen.getByTestId(`${prefix}audio-1`);
    expect(within(tile).queryByRole("img")).toBeNull();
    fireEvent.click(within(tile).getByTitle("Reference"));
    expect(props.onOpenPreview.mock.calls[0][0]).toMatchObject({ kind: "audios", url: "/audio.wav" });
    expect(screen.queryByTestId(`${prefix}image-5`)).toBeNull();
    expect(screen.getByTestId(`${prefix}image-4`)).toBeTruthy();
    expect(screen.getByText(/^\+1/)).toBeTruthy();
  });
});
