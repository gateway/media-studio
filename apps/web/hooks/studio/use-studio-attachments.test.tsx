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
import { useStudioReferenceLibrary } from "@/hooks/studio/use-studio-reference-library";
import { useStudioSourceAsset } from "@/hooks/studio/use-studio-source-asset";
import { buildAttachmentPreviewUrl } from "@/lib/studio-composer-file-utils";
import type {
  AttachmentRecord,
  ComposerStatusMessage,
} from "@/lib/media-studio-contract";
import {
  buildOrderedImageInputs,
  resolveStandardComposerSlots,
  type PresetSlotState,
} from "@/lib/media-studio-helpers";
import type { MediaAsset, MediaReference } from "@/lib/types";

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

function renderFileStaging(
  initial: AttachmentRecord[],
  sourceCount = 0,
  maxImageInputs = initial.length + sourceCount,
  seedanceComposer = false,
  gallerySource: MediaAsset | null = null,
) {
  URL.revokeObjectURL = vi.fn();
  const reportStatus = vi.fn();
  const { result } = renderHook(() => {
    const [attachments, setAttachments] = useState(initial);
    const source = useStudioSourceAsset();
    const actions = useStudioAttachments({
      attachments,
      seedanceComposer,
      maxImageInputs,
      maxVideoInputs: 0,
      maxAudioInputs: 0,
      stagedImageCount: attachments.length + sourceCount,
      stagedVideoCount: 0,
      stagedAudioCount: 0,
      setFormMessage: reportStatus,
      setAttachments,
      setPresetSlotStates: vi.fn(),
    });
    const library = useStudioReferenceLibrary({
      canOpenReferenceLibrary: true,
      structuredPresetActive: false,
      structuredPresetImageSlots: [],
      presetSlotStates: {},
      seedanceComposer,
      seedanceFirstFrameAttachment: null,
      seedanceLastFrameAttachment: null,
      effectiveSeedanceMode: "prompt_only",
      standardComposerUsesExplicitSlots: false,
      standardComposerSlots: [],
      orderedImageInputs: buildOrderedImageInputs(
        gallerySource,
        attachments,
        Boolean(gallerySource),
      ),
      dedicatedImageReferenceRailActive: !seedanceComposer,
      setOpenPicker: vi.fn(),
      setFormMessage: reportStatus,
      assignPresetSlotReference: actions.assignPresetSlotReference,
      addReferenceMediaAsAttachment: actions.addReferenceMediaAsAttachment,
      orderedImageReplacement: (input) => ({
        replaceAttachmentId:
          input.source === "attachment" ? input.attachment.id : undefined,
      }),
    });
    return { actions, attachments, source, reportStatus, library };
  });
  return result;
}

const replacement = () =>
  new File([], "replacement.png", { type: "image/png" });
const imageKinds: AttachmentRecord["kind"][] = ["images"];

it("replaces the Seedance start frame without disturbing the end frame", async () => {
  const start = imageAttachment("start", "first_frame");
  const end = imageAttachment("end", "last_frame");
  const staging = renderFileStaging([start, end], 0, 2, true);
  const image = replacement();

  await act(() =>
    staging.current.actions.addFiles([image], {
      role: "first_frame",
      allowedKinds: imageKinds,
      replaceAttachmentId: start.id,
    }),
  );

  expect(staging.current.attachments).toEqual([
    expect.objectContaining({ file: image, role: "first_frame" }),
    end,
  ]);
});

it("allows a Seedance reference replacement at capacity without appending", async () => {
  const first = imageAttachment("reference-1", "reference");
  const second = imageAttachment("reference-2", "reference");
  const staging = renderFileStaging([first, second], 0, 2, true);
  const image = replacement();

  await act(() =>
    staging.current.actions.addFiles([image], {
      role: "reference",
      allowedKinds: imageKinds,
      replaceAttachmentId: first.id,
    }),
  );

  expect(staging.current.attachments).toEqual([
    expect.objectContaining({ file: image, role: "reference" }),
    second,
  ]);
});

it("does not exceed Seedance capacity when a library selection wins against a decoding upload", async () => {
  const staging = renderFileStaging([], 0, 1, true);
  const libraryImage: MediaReference = {
    reference_id: "saved-reference",
    kind: "image",
    status: "ready",
    stored_path: "references/saved.png",
    stored_url: "/references/saved.png",
    file_size_bytes: 12,
    sha256: "fixture",
    usage_count: 0,
  };
  let finishPreview!: (url: string) => void;
  vi.mocked(buildAttachmentPreviewUrl).mockReturnValueOnce(
    new Promise((resolve) => {
      finishPreview = resolve;
    }),
  );
  const config = { role: "reference" as const, allowedKinds: imageKinds };
  const upload = staging.current.actions.addFiles([replacement()], config);

  act(() => {
    staging.current.actions.addReferenceMediaAsAttachment(libraryImage, config);
  });
  await act(async () => {
    finishPreview("blob:discarded-upload");
    await upload;
  });

  expect(staging.current.attachments).toEqual([
    expect.objectContaining({ referenceId: libraryImage.reference_id }),
  ]);
  expect(staging.current.reportStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ tone: "warning" }),
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:discarded-upload");
});

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

it("replaces the targeted reference after an earlier image is removed during a gallery fetch", async () => {
  const first = imageAttachment("first");
  const target = imageAttachment("target", "reference");
  const last = imageAttachment("last");
  const staging = renderFileStaging([first, target, last]);
  const galleryImage: MediaAsset = {
    asset_id: "gallery-replacement",
    generation_kind: "image",
    created_at: "2026-11-07T00:00:00Z",
    hero_original_url: "/files/gallery-replacement.png",
  };
  let finishFetch!: (response: Response) => void;
  const fetchAsset = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(
    new Promise((resolve) => {
      finishFetch = resolve;
    }),
  );

  const pending = staging.current.actions.addGalleryAssetAsAttachment(
    galleryImage,
    null,
    imageKinds,
    { replaceAttachmentId: target.id },
  );
  expect(fetchAsset).toHaveBeenCalledOnce();
  act(() => staging.current.actions.removeAttachment(first.id));
  await act(async () => {
    finishFetch(
      new Response("gallery image", {
        headers: { "Content-Type": "image/png" },
      }),
    );
    await pending;
  });

  expect(staging.current.attachments).toHaveLength(2);
  expect(staging.current.attachments[0]?.file?.name).toBe(
    "gallery-replacement.png",
  );
  expect(staging.current.attachments[0]?.file?.type).toBe("image/png");
  expect(staging.current.attachments[1]).toEqual(last);
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

it("appends a library reference after a gallery source and an uploaded image", () => {
  const gallerySource: MediaAsset = {
    asset_id: "gallery-source",
    generation_kind: "image",
    created_at: "2026-11-07T00:00:00Z",
  };
  const uploaded = { ...imageAttachment("uploaded"), file: replacement() };
  const reference: MediaReference = {
    reference_id: "saved-reference",
    kind: "image",
    status: "ready",
    stored_path: "references/saved.png",
    stored_url: "/references/saved.png",
    file_size_bytes: 12,
    sha256: "fixture",
    usage_count: 0,
  };
  const staging = renderFileStaging([uploaded], 1, 3);

  act(() => {
    staging.current.source.setSourceAssetId(gallerySource.asset_id);
    staging.current.actions.addReferenceMediaAsAttachment(reference, {
      role: "reference",
      allowedKinds: imageKinds,
    });
  });

  expect(staging.current.source.sourceAssetId).toBe(gallerySource.asset_id);
  expect(
    buildOrderedImageInputs(gallerySource, staging.current.attachments, true),
  ).toEqual([
    { source: "asset", asset: gallerySource },
    { source: "attachment", attachment: uploaded },
    expect.objectContaining({ source: "reference", reference }),
  ]);

  act(() => {
    staging.current.actions.addReferenceMediaAsAttachment(reference, {
      role: "reference",
      allowedKinds: imageKinds,
    });
  });
  expect(staging.current.attachments).toHaveLength(2);
});

const replacementLibraryImage: MediaReference = {
  reference_id: "library-replacement",
  kind: "image",
  status: "ready",
  stored_path: "references/replacement.png",
  stored_url: "/references/replacement.png",
  file_size_bytes: 12,
  sha256: "fixture",
  usage_count: 0,
};

it("replaces a standard end frame after a gallery start frame without appending", () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  const start: MediaAsset = {
    asset_id: "gallery-start",
    generation_kind: "image",
    created_at: "2026-11-07T00:00:00Z",
  };
  const end = imageAttachment("attached-end");
  const staging = renderFileStaging([end], 1, 2, false, start);
  const { slots } = resolveStandardComposerSlots({
    model: {
      input_patterns: ["first_last_frames"],
      image_inputs: { required_max: 2 },
    } as never,
    attachments: [end],
    sourceAsset: start,
  });
  const opener = document.createElement("button");
  act(() =>
    staging.current.library.openStandardSlotReferenceLibrary(slots[1], opener),
  );
  expect(staging.current.library.referenceLibraryReturnFocus.current).toBe(
    opener,
  );
  act(() =>
    staging.current.library.handleReferenceLibrarySelect(
      replacementLibraryImage,
    ),
  );
  expect(
    buildOrderedImageInputs(start, staging.current.attachments, true),
  ).toEqual([
    { source: "asset", asset: start },
    expect.objectContaining({
      source: "reference",
      reference: replacementLibraryImage,
    }),
  ]);
});

it("replaces a Seedance library end frame while keeping the original start", () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  const start = imageAttachment("start", "first_frame");
  const end = imageAttachment("end", "last_frame");
  const staging = renderFileStaging([start, end], 0, 2, true);
  act(() =>
    staging.current.library.openComposerReferenceLibrary(
      "images",
      "last_frame",
      null,
      { replaceAttachmentId: end.id },
    ),
  );
  act(() =>
    staging.current.library.handleReferenceLibrarySelect(
      replacementLibraryImage,
    ),
  );
  expect(staging.current.attachments).toEqual([
    start,
    expect.objectContaining({
      role: "last_frame",
      referenceRecord: replacementLibraryImage,
    }),
  ]);
});

it.each([false, true])(
  "replaces exactly the chosen reference through the library at capacity (Seedance: %s)",
  (seedance) => {
    const fetchUsage = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response());
    const role = seedance ? "reference" : null;
    const first = imageAttachment("first", role);
    const target = imageAttachment("target", role);
    const last = imageAttachment("last", role);
    const staging = renderFileStaging([first, target, last], 0, 3, seedance);
    const opener = document.createElement("button");
    const openReplacement = () =>
      staging.current.library.openComposerReferenceLibrary(
        "images",
        "reference",
        opener,
        {
          replaceAttachmentId: target.id,
        },
      );

    act(openReplacement);
    expect(staging.current.library.referenceLibraryReturnFocus.current).toBe(
      opener,
    );
    act(() => staging.current.library.setReferenceLibraryTarget(null));
    expect(staging.current.attachments).toEqual([first, target, last]);
    expect(fetchUsage).not.toHaveBeenCalled();

    act(openReplacement);
    act(() =>
      staging.current.library.handleReferenceLibrarySelect(
        replacementLibraryImage,
      ),
    );
    expect(staging.current.attachments).toEqual([
      first,
      expect.objectContaining({
        referenceId: replacementLibraryImage.reference_id,
      }),
      last,
    ]);
    expect(staging.current.library.referenceLibraryTarget).toBeNull();
    expect(fetchUsage).toHaveBeenCalledOnce();
  },
);

it("uses the source claim for library replacement and preserves its first position", () => {
  const following = imageAttachment("following");
  const staging = renderFileStaging([following], 1);
  act(() => staging.current.source.setSourceAssetId("gallery-source"));
  const claimSourceImage = staging.current.source.prepareSourceReplacement(
    "gallery-source",
    () => staging.current.source.setSourceAssetId(null),
  );
  act(() =>
    staging.current.actions.addReferenceMediaAsAttachment(
      replacementLibraryImage,
      {
        allowedKinds: imageKinds,
        claimSourceImage,
      },
    ),
  );
  expect(staging.current.source.sourceAssetId).toBeNull();
  expect(staging.current.attachments).toEqual([
    expect.objectContaining({
      referenceId: replacementLibraryImage.reference_id,
    }),
    following,
  ]);
});

it("replaces the requested filled preset slot while an earlier slot is empty", () => {
  const fetchUsage = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response());
  const previousScene = {
    assetId: "scene-asset",
    file: null,
    previewUrl: "/scene.png",
  };
  const portrait = {
    key: "portrait",
    label: "Portrait",
    helpText: "",
    maxFiles: 1,
    required: true,
  };
  const scene = {
    key: "scene",
    label: "Scene",
    helpText: "",
    maxFiles: 1,
    required: true,
  };
  const reference: MediaReference = {
    reference_id: "library-image",
    kind: "image",
    status: "ready",
    stored_path: "references/library.png",
    stored_url: "/references/library.png",
    file_size_bytes: 12,
    sha256: "fixture",
    usage_count: 0,
  };
  const opener = document.createElement("button");
  const { result } = renderHook(() => {
    const [presetSlotStates, setPresetSlotStates] = useState<
      Record<string, PresetSlotState>
    >({
      scene: previousScene,
    });
    const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
    const [, setFormMessage] = useState<ComposerStatusMessage | null>(null);
    const actions = useStudioAttachments({
      attachments,
      seedanceComposer: false,
      maxImageInputs: 2,
      maxVideoInputs: 0,
      maxAudioInputs: 0,
      stagedImageCount: 0,
      stagedVideoCount: 0,
      stagedAudioCount: 0,
      setFormMessage,
      setAttachments,
      setPresetSlotStates,
    });
    const library = useStudioReferenceLibrary({
      canOpenReferenceLibrary: true,
      structuredPresetActive: true,
      structuredPresetImageSlots: [portrait, scene],
      presetSlotStates,
      seedanceComposer: false,
      seedanceFirstFrameAttachment: null,
      seedanceLastFrameAttachment: null,
      effectiveSeedanceMode: "prompt_only",
      standardComposerUsesExplicitSlots: false,
      standardComposerSlots: [],
      orderedImageInputs: [],
      dedicatedImageReferenceRailActive: false,
      setOpenPicker: () => {},
      setFormMessage,
      assignPresetSlotReference: actions.assignPresetSlotReference,
      addReferenceMediaAsAttachment: actions.addReferenceMediaAsAttachment,
      orderedImageReplacement: () => ({}),
    });
    return { library, presetSlotStates, attachments };
  });

  act(() =>
    result.current.library.openPresetSlotReferenceLibrary(scene, opener),
  );
  expect(result.current.library.referenceLibraryReturnFocus.current).toBe(
    opener,
  );
  expect(result.current.presetSlotStates).toEqual({ scene: previousScene });
  act(() => result.current.library.handleReferenceLibrarySelect(reference));
  expect(result.current.presetSlotStates).toEqual({
    scene: expect.objectContaining({
      assetId: null,
      referenceId: "library-image",
      previewUrl: "/references/library.png",
    }),
  });
  expect(result.current.attachments).toEqual([]);
  expect(result.current.library.referenceLibraryTarget).toBeNull();
  expect(fetchUsage).toHaveBeenCalledOnce();
});
