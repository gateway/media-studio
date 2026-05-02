import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const cleanupRoots: string[] = [];
const registerReferenceMediaFile = vi.fn();
const resolveReferenceMedia = vi.fn();

vi.mock("@/lib/reference-media-storage", () => ({
  registerReferenceMediaFile,
  resolveReferenceMedia,
}));

afterAll(async () => {
  await Promise.all(
    cleanupRoots.map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    }),
  );
});

beforeEach(() => {
  vi.resetModules();
  registerReferenceMediaFile.mockReset();
  resolveReferenceMedia.mockReset();
});

describe("buildMediaPayloadFromFormData", () => {
  it("does not expose a dashboard index refresh side effect", async () => {
    const shared = await import("../app/api/control/media/shared");

    expect("triggerDashboardIndexRefresh" in shared).toBe(false);
  });

  it("maps structured preset files into preset_image_slots", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-web-"));
    cleanupRoots.push(tempRoot);
    process.env.MEDIA_STUDIO_DATA_ROOT = tempRoot;

    registerReferenceMediaFile.mockResolvedValueOnce({
      reference_id: "ref-person",
      stored_path: "reference-media/images/ref-person.png",
    });

    const { buildMediaPayloadFromFormData } = await import("../app/api/control/media/shared");
    const formData = new FormData();
    formData.set("intent", "submit");
    formData.set("model_key", "nano-banana-2");
    formData.set("prompt", "Portrait");
    formData.set("preset_id", "media-preset-3d-caricature-style-nano-banana-shared");
    formData.set("system_prompt_ids", JSON.stringify(["prompt-1"]));
    formData.set("preset_inputs_json", JSON.stringify({ actor: "Steve" }));
    formData.set("preset_slot_values_json", JSON.stringify({}));
    formData.append("preset_slot_file:person", new File(["fake-image"], "steve.png", { type: "image/png" }));

    const { payload } = await buildMediaPayloadFromFormData(formData);

    expect(payload.selected_system_prompt_ids).toEqual(["prompt-1"]);
    expect(payload.preset_text_values).toEqual({ actor: "Steve" });
    expect(payload.preset_image_slots).toBeTruthy();

    const personItems = (payload.preset_image_slots as Record<string, Array<Record<string, unknown>>>).person;
    expect(Array.isArray(personItems)).toBe(true);
    expect(personItems).toHaveLength(1);
    expect(personItems[0]).toEqual({
      reference_id: "ref-person",
      path: "reference-media/images/ref-person.png",
    });
  });

  it("preserves Seedance first and last frame roles in upload order", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-web-"));
    cleanupRoots.push(tempRoot);
    process.env.MEDIA_STUDIO_DATA_ROOT = tempRoot;

    registerReferenceMediaFile
      .mockResolvedValueOnce({
        reference_id: "ref-first",
        stored_path: "reference-media/images/first.png",
      })
      .mockResolvedValueOnce({
        reference_id: "ref-last",
        stored_path: "reference-media/images/last.png",
      });

    const { buildMediaPayloadFromFormData } = await import("../app/api/control/media/shared");
    const formData = new FormData();
    formData.set("intent", "validate");
    formData.set("model_key", "seedance-2.0");
    formData.set("task_mode", "reference_to_video");
    formData.set("prompt", "Use the first and last frame anchors.");
    formData.set("options", JSON.stringify({ duration: 4, resolution: "480p", aspect_ratio: "16:9" }));
    formData.set(
      "attachment_manifest",
      JSON.stringify([
        { id: "a", kind: "images", role: "first_frame", has_file: true },
        { id: "b", kind: "images", role: "last_frame", has_file: true },
      ]),
    );
    formData.append("attachments", new File(["first"], "first.png", { type: "image/png" }));
    formData.append("attachments", new File(["last"], "last.png", { type: "image/png" }));

    const { payload } = await buildMediaPayloadFromFormData(formData);
    const images = payload.images as Array<Record<string, unknown>>;

    expect(payload.task_mode).toBe("reference_to_video");
    expect(images).toHaveLength(2);
    expect(images.map((item) => item.role)).toEqual(["first_frame", "last_frame"]);
    expect(images.map((item) => item.reference_id)).toEqual(["ref-first", "ref-last"]);
    expect(images.map((item) => item.path)).toEqual([
      "reference-media/images/first.png",
      "reference-media/images/last.png",
    ]);
  });

  it("preserves Seedance multimodal reference roles and deterministic manifest ordering", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-web-"));
    cleanupRoots.push(tempRoot);
    process.env.MEDIA_STUDIO_DATA_ROOT = tempRoot;

    registerReferenceMediaFile
      .mockResolvedValueOnce({
        reference_id: "ref-image",
        stored_path: "reference-media/images/ref.png",
      })
      .mockResolvedValueOnce({
        reference_id: "ref-video",
        stored_path: "reference-media/videos/motion.mp4",
      })
      .mockResolvedValueOnce({
        reference_id: "ref-audio",
        stored_path: "reference-media/audios/voice.wav",
      });

    const { buildMediaPayloadFromFormData } = await import("../app/api/control/media/shared");
    const formData = new FormData();
    formData.set("intent", "submit");
    formData.set("model_key", "seedance-2.0");
    formData.set("task_mode", "reference_to_video");
    formData.set("prompt", "Use @image1, @video1, and @audio1 together.");
    formData.set("options", JSON.stringify({ duration: 4, resolution: "480p", aspect_ratio: "16:9" }));
    formData.set(
      "attachment_manifest",
      JSON.stringify([
        { id: "img1", kind: "images", role: "reference", has_file: true },
        { id: "vid1", kind: "videos", role: "reference", duration_seconds: 5, has_file: true },
        { id: "aud1", kind: "audios", role: "reference", has_file: true },
      ]),
    );
    formData.append("attachments", new File(["image"], "ref.png", { type: "image/png" }));
    formData.append("attachments", new File(["video"], "motion.mp4", { type: "video/mp4" }));
    formData.append("attachments", new File(["audio"], "voice.wav", { type: "audio/wav" }));

    const { payload } = await buildMediaPayloadFromFormData(formData);

    expect((payload.images as Array<Record<string, unknown>>).map((item) => item.role)).toEqual(["reference"]);
    expect((payload.videos as Array<Record<string, unknown>>).map((item) => item.role)).toEqual(["reference"]);
    expect((payload.audios as Array<Record<string, unknown>>).map((item) => item.role)).toEqual(["reference"]);
    expect((payload.videos as Array<Record<string, unknown>>)[0]?.duration_seconds).toBe(5);
  });

  it("resolves attachment and preset-slot reference ids into reusable library paths", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-web-"));
    cleanupRoots.push(tempRoot);
    process.env.MEDIA_STUDIO_DATA_ROOT = tempRoot;

    resolveReferenceMedia
      .mockResolvedValueOnce({
        reference_id: "ref-existing",
        stored_path: "reference-media/images/existing.png",
      })
      .mockResolvedValueOnce({
        reference_id: "ref-slot",
        stored_path: "reference-media/images/preset-slot.png",
      });

    const { buildMediaPayloadFromFormData } = await import("../app/api/control/media/shared");
    const formData = new FormData();
    formData.set("intent", "submit");
    formData.set("model_key", "nano-banana-2");
    formData.set("prompt", "Reuse a reference from the library");
    formData.set(
      "attachment_manifest",
      JSON.stringify([{ id: "ref-1", kind: "images", role: "reference", reference_id: "ref-existing", has_file: false }]),
    );
    formData.set("preset_slot_values_json", JSON.stringify({ person: [{ reference_id: "ref-slot" }] }));

    const { payload } = await buildMediaPayloadFromFormData(formData);

    expect(payload.images).toEqual([
      {
        reference_id: "ref-existing",
        path: "reference-media/images/existing.png",
        role: "reference",
      },
    ]);
    expect(payload.preset_image_slots).toEqual({
      person: [{ reference_id: "ref-slot", path: "reference-media/images/preset-slot.png" }],
    });
  });

  it("preserves preset slot gallery asset ids for API-side resolution", async () => {
    const { buildMediaPayloadFromFormData } = await import("../app/api/control/media/shared");
    const formData = new FormData();
    formData.set("intent", "submit");
    formData.set("model_key", "nano-banana-2");
    formData.set("prompt", "Reuse the selected gallery image inside the preset slot");
    formData.set("preset_slot_values_json", JSON.stringify({}));
    formData.set("preset_slot_asset:person", "123");

    const { payload } = await buildMediaPayloadFromFormData(formData);

    expect(payload.preset_image_slots).toEqual({
      person: [{ asset_id: 123 }],
    });
  });
});
