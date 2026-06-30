// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudioAttachments } from "@/hooks/studio/use-studio-attachments";
import type { AttachmentRecord, ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { PresetSlotState } from "@/lib/media-studio-helpers";

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
      <div data-testid="attachment-duration">{attachments[0]?.durationSeconds ?? ""}</div>
      <div data-testid="attachment-resolution">{attachments[0]?.width ?? ""}x{attachments[0]?.height ?? ""}</div>
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

    await waitFor(() => expect(screen.getByTestId("attachment-count").textContent).toBe("1"));
    expect(screen.getByTestId("attachment-kind").textContent).toBe("videos");
    expect(screen.getByTestId("attachment-duration").textContent).toBe("20.083333");
    expect(screen.getByTestId("attachment-resolution").textContent).toBe("720x1280");
    expect(probeVideoMetadataMock).toHaveBeenCalledWith(file);
  });

  it("does not probe non-video files", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const file = new File(["fixture"], "audio.wav", { type: "audio/wav" });

    render(<AttachmentHarness files={[file]} restored />);

    await waitFor(() => expect(screen.getByTestId("attachment-count").textContent).toBe("1"));
    expect(screen.getByTestId("attachment-kind").textContent).toBe("audios");
    expect(screen.getByTestId("attachment-duration").textContent).toBe("");
    expect(probeVideoMetadataMock).not.toHaveBeenCalled();
  });
});
