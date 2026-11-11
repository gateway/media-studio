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
import type { MediaAsset, MediaModelSummary } from "@/lib/types";

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
    vi.stubGlobal("localStorage", window.sessionStorage);
    vi.stubGlobal(
      "URL",
      class extends URL {
        static revokeObjectURL = vi.fn();
      },
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith("/api/control/files/")
        ? new Response("fixture", { headers: { "Content-Type": "image/png" } })
        : new Response(null, { status: 404 }),
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
        assets={["start", "end", "replacement"].map(galleryImage)}
        latestAsset={null}
      />,
    );

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
