// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { MediaStudio } from "@/components/media-studio";
import type {
  MediaAsset,
  MediaModelSummary,
  MediaReference,
} from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/studio-composer-file-utils", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/studio-composer-file-utils")
  >()),
  buildAttachmentPreviewUrl: async (file: File) => `/preview/${file.name}`,
}));

vi.mock("@/lib/video-metadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video-metadata")>()),
  probeVideoMetadata: async () => ({
    durationSeconds: 5,
    width: 1280,
    height: 720,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__mediaStudioComposerDraft;
  window.sessionStorage.clear();
});

const kling: MediaModelSummary = {
  key: "kling-3.0-i2v",
  label: "Kling 3.0 Image to Video",
  provider_model: "kling/v3-image-to-video",
  generation_kind: "video",
  task_modes: ["image_to_video"],
  input_patterns: ["single_image", "first_last_frames"],
  image_inputs: { required_min: 1, required_max: 2 },
};

const seedance: MediaModelSummary = {
  key: "seedance-2.0-mini",
  label: "Seedance 2.0 Mini",
  provider_model: "bytedance/seedance-2-mini",
  generation_kind: "video",
  task_modes: ["text_to_video", "reference_to_video"],
  input_patterns: [
    "prompt_only",
    "single_image",
    "first_last_frames",
    "multimodal_reference",
  ],
  image_inputs: { required_min: 0, required_max: 9 },
  video_inputs: { required_min: 0, required_max: 3 },
  audio_inputs: { required_min: 0, required_max: 3 },
};

function galleryImage(id: string): MediaAsset {
  return {
    asset_id: id,
    created_at: "2026-11-11T00:00:00Z",
    generation_kind: "image",
    status: "succeeded",
    hero_original_url: `/files/${id}.png`,
    hero_thumb_url: `/files/${id}.png`,
  };
}

function renderStudio(model: MediaModelSummary, assets: MediaAsset[]) {
  vi.stubGlobal("localStorage", window.sessionStorage);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = vi.fn();
    },
  );
  render(
    <MediaStudio
      apiHealthy
      models={[model]}
      presets={[]}
      prompts={[]}
      enhancementConfigs={[]}
      queueSettings={null}
      queuePolicies={[]}
      projects={[]}
      batches={[]}
      jobs={[]}
      assets={assets}
      latestAsset={null}
    />,
  );
}

function dropGalleryImage(id: string, target: HTMLElement) {
  const card = screen
    .getAllByTestId("studio-gallery-card")
    .find((element) => element.dataset.assetId === id);
  expect(card).toBeDefined();
  const payload = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => payload.set(type, value),
    getData: (type: string) => payload.get(type) ?? "",
    setDragImage: vi.fn(),
    files: [],
  };
  fireEvent.dragStart(card!, { dataTransfer });
  expect(fireEvent.dragOver(target, { dataTransfer })).toBe(false);
  fireEvent.drop(target, { dataTransfer });
}

it.each([
  { model: kling, media: "gallery" },
  { model: kling, media: "file" },
  { model: seedance, media: "gallery" },
  { model: seedance, media: "file" },
])(
  "replaces only the occupied $model.label End frame on $media drop",
  async ({ model, media }) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith("/api/control/files/")
        ? new Response("fixture", { headers: { "Content-Type": "image/png" } })
        : new Response(null, { status: 404 }),
    );
    renderStudio(model, ["start", "end", "replacement"].map(galleryImage));

    const isKling = model === kling;
    const startInput = isKling
      ? "studio-standard-slot-slot-start-frame"
      : "seedance-slot-input-first_frame";
    const endInput = isKling
      ? "studio-standard-slot-slot-end-frame"
      : "seedance-slot-input-last_frame";
    const startFilled = isKling
      ? "studio-standard-slot-slot-start-frame-filled"
      : "seedance-slot-filled-first_frame";
    const endFilled = isKling
      ? "studio-standard-slot-slot-end-frame-filled"
      : "seedance-slot-filled-last_frame";
    const preview = (tile: HTMLElement) => within(tile).getByRole("img");

    dropGalleryImage("start", screen.getByTestId(startInput).closest("label")!);
    const startTile = await screen.findByTestId(startFilled);
    const startUrl = isKling
      ? "/api/control/files/start.png"
      : "/preview/start.png";
    expect(preview(startTile).getAttribute("src")).toBe(startUrl);

    dropGalleryImage("end", screen.getByTestId(endInput).closest("label")!);
    const endTile = await screen.findByTestId(endFilled);
    expect(preview(endTile).getAttribute("src")).toBe("/preview/end.png");

    if (media === "gallery") {
      dropGalleryImage("replacement", preview(endTile));
    } else {
      const dataTransfer = {
        getData: () => "",
        files: [
          new File(["fixture"], "replacement.png", { type: "image/png" }),
        ],
      };
      expect(fireEvent.dragOver(preview(endTile), { dataTransfer })).toBe(
        false,
      );
      fireEvent.drop(preview(endTile), { dataTransfer });
    }
    await waitFor(() =>
      expect(preview(screen.getByTestId(endFilled)).getAttribute("src")).toBe(
        "/preview/replacement.png",
      ),
    );
    expect(preview(screen.getByTestId(startFilled)).getAttribute("src")).toBe(
      startUrl,
    );

    fireEvent.click(within(endTile).getByTestId(`${endFilled}-remove`));
    // If a third image slipped into the draft, removing End would expose it.
    expect(screen.queryByTestId(endFilled)).toBeNull();
    expect(preview(screen.getByTestId(startFilled)).getAttribute("src")).toBe(
      startUrl,
    );
  },
);

it("replaces only the full Driving video slot using the shared file and library menu", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const reference: MediaReference = {
    reference_id: "library-video",
    kind: "video",
    status: "ready",
    stored_path: "references/replacement.mp4",
    stored_url: "/references/replacement.mp4",
    thumb_url: "/references/replacement.jpg",
    file_size_bytes: 12,
    sha256: "fixture",
    usage_count: 0,
  };
  const fetchLibrary = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      if (String(input).startsWith("/api/control/reference-media?")) {
        return Response.json({ ok: true, items: [reference] });
      }
      return new Response(null, { status: 404 });
    });
  renderStudio(
    {
      ...kling,
      key: "kling-3.0-motion",
      label: "Kling 3.0 Motion Control",
      task_modes: ["motion_control"],
      input_patterns: ["motion_control"],
      image_inputs: { required_min: 1, required_max: 1 },
      video_inputs: { required_min: 1, required_max: 1 },
    },
    [galleryImage("source")],
  );

  const sourceId = "studio-standard-slot-slot-source-image";
  const videoId = "studio-standard-slot-slot-driving-video";
  const videoTile = () => screen.getByTestId(`${videoId}-filled`);
  const replaceButton = () =>
    within(videoTile()).getByRole("button", { name: "Replace Driving video" });
  const pickFile = (id: string, file: File) =>
    fireEvent.change(screen.getByTestId(id), { target: { files: [file] } });
  const videoFile = (name: string) =>
    new File(["fixture"], name, { type: "video/mp4" });

  dropGalleryImage("source", screen.getByTestId(sourceId).closest("label")!);
  pickFile(videoId, videoFile("original.mp4"));
  const originalTile = await screen.findByTestId(`${videoId}-filled`);
  expect(originalTile.querySelector("video")?.getAttribute("src")).toBe(
    "/preview/original.mp4",
  );

  fireEvent.click(replaceButton());
  fireEvent.click(screen.getByText("Upload file"));
  pickFile(
    `${videoId}-replace`,
    new File([], "wrong.png", { type: "image/png" }),
  );
  expect(videoTile().querySelector("video")?.getAttribute("src")).toBe(
    "/preview/original.mp4",
  );

  fireEvent.click(replaceButton());
  fireEvent.click(screen.getByText("Upload file"));
  pickFile(`${videoId}-replace`, videoFile("local-replacement.mp4"));
  await waitFor(() =>
    expect(videoTile().querySelector("video")?.getAttribute("src")).toBe(
      "/preview/local-replacement.mp4",
    ),
  );

  fireEvent.click(replaceButton());
  fireEvent.click(screen.getByText("Choose from library"));
  fireEvent.click(await screen.findByRole("button", { name: "Use video" }));
  expect(fetchLibrary).toHaveBeenCalledWith(
    expect.stringMatching(/reference-media\?.*kind=video/),
    expect.anything(),
  );
  expect(within(videoTile()).getByRole("img").getAttribute("src")).toBe(
    reference.thumb_url,
  );
  expect(screen.queryByTestId("studio-reference-library")).toBeNull();

  fireEvent.click(
    within(videoTile()).getByRole("button", { name: "Remove Driving video" }),
  );
  expect(screen.queryByTestId(`${videoId}-filled`)).toBeNull();
  expect(
    within(screen.getByTestId(`${sourceId}-filled`))
      .getByRole("img")
      .getAttribute("src"),
  ).toBe("/api/control/files/source.png");
});
