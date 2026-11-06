// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudioAttachments } from "@/hooks/studio/use-studio-attachments";
import { useStudioSourceAsset } from "@/hooks/studio/use-studio-source-asset";
import { buildAttachmentPreviewUrl } from "@/lib/studio-composer-file-utils";
import type {
  AttachmentRecord,
  ComposerStatusMessage,
} from "@/lib/media-studio-contract";
import type { PresetSlotState } from "@/lib/media-studio-helpers";

vi.mock("@/lib/studio-composer-file-utils", () => ({
  buildAttachmentPreviewUrl: vi.fn(async () => "blob:preview"),
}));

const probeVideoMetadataMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/video-metadata", () => ({
  probeVideoMetadata: probeVideoMetadataMock,
}));

function AttachmentHarness({
  files,
  restored = false,
}: {
  files: File[];
  restored?: boolean;
}) {
  const didRun = useRef(false);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [, setFormMessage] = useState<ComposerStatusMessage | null>(null);
  const [, setPresetSlotStates] = useState<Record<string, PresetSlotState>>({});
  const actions = useStudioAttachments({
    attachments,
    seedanceComposer: false,
    seedanceFirstFrameAttachment: null,
    seedanceLastFrameAttachment: null,
    seedanceReferenceImages: [],
    seedanceReferenceVideos: [],
    seedanceReferenceAudios: [],
    maxImageInputs: 4,
    maxVideoInputs: 4,
    maxAudioInputs: 4,
    stagedImageCount: 0,
    stagedVideoCount: 0,
    stagedAudioCount: 0,
    setFormMessage,
    setAttachments,
    setPresetSlotStates,
  });

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    void (restored ? actions.addRestoredFiles(files) : actions.addFiles(files));
  }, [actions, files, restored]);

  return (
    <div>
      <div data-testid="attachment-count">{attachments.length}</div>
      <div data-testid="attachment-duration">
        {attachments[0]?.durationSeconds ?? ""}
      </div>
      <div data-testid="attachment-resolution">
        {attachments[0]?.width ?? ""}x{attachments[0]?.height ?? ""}
      </div>
      <div data-testid="attachment-kind">{attachments[0]?.kind ?? ""}</div>
    </div>
  );
}

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  probeVideoMetadataMock.mockReset();
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

describe("useStudioAttachments", () => {
  it("stages uploaded video files with probed duration metadata", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const file = new File(["fixture"], "motion.mp4", { type: "video/mp4" });
    probeVideoMetadataMock.mockResolvedValueOnce({
      durationSeconds: 20.083333,
      width: 720,
      height: 1280,
      mimeType: "video/mp4",
      sizeBytes: file.size,
      sourceKind: "file",
    });

    render(<AttachmentHarness files={[file]} />);

    await waitFor(() =>
      expect(screen.getByTestId("attachment-count").textContent).toBe("1"),
    );
    expect(screen.getByTestId("attachment-kind").textContent).toBe("videos");
    expect(screen.getByTestId("attachment-duration").textContent).toBe(
      "20.083333",
    );
    expect(screen.getByTestId("attachment-resolution").textContent).toBe(
      "720x1280",
    );
    expect(probeVideoMetadataMock).toHaveBeenCalledWith(file);
  });

  it("does not probe non-video files", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const file = new File(["fixture"], "audio.wav", { type: "audio/wav" });

    render(<AttachmentHarness files={[file]} restored />);

    await waitFor(() =>
      expect(screen.getByTestId("attachment-count").textContent).toBe("1"),
    );
    expect(screen.getByTestId("attachment-kind").textContent).toBe("audios");
    expect(screen.getByTestId("attachment-duration").textContent).toBe("");
    expect(probeVideoMetadataMock).not.toHaveBeenCalled();
  });
});

function imageAttachment(
  id: string,
  role?: AttachmentRecord["role"],
): AttachmentRecord {
  return { id, role, file: null, kind: "images", previewUrl: `/${id}.png` };
}

function renderFileStaging(initial: AttachmentRecord[], sourceCount = 0) {
  URL.revokeObjectURL = vi.fn();
  const { result } = renderHook(() => {
    const [attachments, setAttachments] = useState(initial);
    const source = useStudioSourceAsset();
    const actions = useStudioAttachments({
      attachments,
      seedanceComposer: false,
      seedanceFirstFrameAttachment: null,
      seedanceLastFrameAttachment: null,
      seedanceReferenceImages: [],
      seedanceReferenceVideos: [],
      seedanceReferenceAudios: [],
      maxImageInputs: initial.length + sourceCount,
      maxVideoInputs: 0,
      maxAudioInputs: 0,
      stagedImageCount: initial.length + sourceCount,
      stagedVideoCount: 0,
      stagedAudioCount: 0,
      setFormMessage: vi.fn(),
      setAttachments,
      setPresetSlotStates: vi.fn(),
    });
    return { actions, attachments, source };
  });
  return result;
}

const replacement = () =>
  new File([], "replacement.png", { type: "image/png" });
const imageKinds: AttachmentRecord["kind"][] = ["images"];

it("replaces a gallery source at the image limit ahead of a following library reference", async () => {
  const following = imageAttachment("library", "reference");
  const staging = renderFileStaging([following], 1);
  const claimSourceImage = vi.fn(() => true);
  const config = { allowedKinds: imageKinds, claimSourceImage };
  const video = new File([], "video.mp4", { type: "video/mp4" });
  await act(() => staging.current.actions.addFiles([video], config));
  expect(claimSourceImage).not.toHaveBeenCalled();
  expect(staging.current.attachments).toEqual([following]);

  const image = replacement();
  await act(() => staging.current.actions.addFiles([image], config));
  expect(claimSourceImage).toHaveBeenCalledTimes(1);
  expect(staging.current.attachments).toEqual([
    expect.objectContaining({ file: image }),
    following,
  ]);
});

it("discards a decoded file if its gallery source is no longer staged", async () => {
  const following = imageAttachment("library", "reference");
  const staging = renderFileStaging([following], 1);
  await act(() =>
    staging.current.actions.addFiles([replacement()], {
      allowedKinds: imageKinds,
      claimSourceImage: () => false,
    }),
  );
  expect(staging.current.attachments).toEqual([following]);
  expect(staging.current.attachments).toEqual([following]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

it("replaces the library item at its exact position among uploaded images", async () => {
  const library = imageAttachment("library", "reference");
  const uploaded = imageAttachment("uploaded");
  const staging = renderFileStaging([library, uploaded]);
  const image = replacement();
  await act(() =>
    staging.current.actions.addFiles([image], {
      allowedKinds: imageKinds,
      replaceAttachmentId: library.id,
    }),
  );
  expect(staging.current.attachments).toEqual([
    expect.objectContaining({ file: image }),
    uploaded,
  ]);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it.each(["A", "B"])(
  "resolves replacement of B by identity after %s is removed during preview decoding",
  async (removedId) => {
    const first = imageAttachment("A");
    const target = imageAttachment("B");
    const last = imageAttachment("C");
    const staging = renderFileStaging([first, target, last]);
    const image = replacement();
    let resolvePreview!: (url: string) => void;
    vi.mocked(buildAttachmentPreviewUrl).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const pending = staging.current.actions.addFiles([image], {
      allowedKinds: imageKinds,
      replaceAttachmentId: target.id,
    });
    act(() => staging.current.actions.removeAttachment(removedId));
    await act(async () => {
      resolvePreview("blob:delayed");
      await pending;
    });
    if (removedId === target.id) {
      expect(staging.current.attachments).toEqual([first, last]);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:delayed");
    } else {
      expect(staging.current.attachments).toEqual([
        expect.objectContaining({ file: image }),
        last,
      ]);
    }
  },
);

it("discards a decode when the real source owner clears and re-stages the same gallery ID", async () => {
  const library = imageAttachment("library", "reference");
  const staging = renderFileStaging([library], 1);
  const { setSourceAssetId } = staging.current.source;
  act(() => setSourceAssetId("gallery-asset"));
  let resolvePreview!: (url: string) => void;
  vi.mocked(buildAttachmentPreviewUrl).mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePreview = resolve;
    }),
  );
  const pending = staging.current.actions.addFiles([replacement()], {
    allowedKinds: imageKinds,
    claimSourceImage: staging.current.source.prepareSourceReplacement(
      "gallery-asset",
      () => setSourceAssetId(null),
    ),
  });
  act(() => {
    setSourceAssetId(null);
    setSourceAssetId("gallery-asset");
  });
  await act(async () => {
    resolvePreview("blob:stale-source");
    await pending;
  });
  expect(staging.current.source.sourceAssetId).toBe("gallery-asset");
  expect(staging.current.attachments).toEqual([library]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:stale-source");
});
