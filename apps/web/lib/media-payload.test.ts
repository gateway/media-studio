import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const cleanupRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    cleanupRoots.map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    }),
  );
});

describe("buildMediaPayloadFromFormData", () => {
  it("maps structured preset files into preset_image_slots", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-web-"));
    cleanupRoots.push(tempRoot);
    process.env.MEDIA_STUDIO_DATA_ROOT = tempRoot;

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
    expect(typeof personItems[0]?.path).toBe("string");
    await expect(fs.access(String(personItems[0]?.path))).resolves.toBeUndefined();
  });

  it("preserves Seedance first and last frame roles in upload order", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-web-"));
    cleanupRoots.push(tempRoot);
    process.env.MEDIA_STUDIO_DATA_ROOT = tempRoot;

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
        { id: "a", kind: "images", role: "first_frame" },
        { id: "b", kind: "images", role: "last_frame" },
      ]),
    );
    formData.append("attachments", new File(["first"], "first.png", { type: "image/png" }));
    formData.append("attachments", new File(["last"], "last.png", { type: "image/png" }));

    const { payload } = await buildMediaPayloadFromFormData(formData);
    const images = payload.images as Array<Record<string, unknown>>;

    expect(payload.task_mode).toBe("reference_to_video");
    expect(images).toHaveLength(2);
    expect(images.map((item) => item.role)).toEqual(["first_frame", "last_frame"]);
    await expect(fs.access(String(images[0]?.path))).resolves.toBeUndefined();
    await expect(fs.access(String(images[1]?.path))).resolves.toBeUndefined();
  });

  it("preserves Seedance multimodal reference roles and deterministic manifest ordering", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-web-"));
    cleanupRoots.push(tempRoot);
    process.env.MEDIA_STUDIO_DATA_ROOT = tempRoot;

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
        { id: "img1", kind: "images", role: "reference" },
        { id: "vid1", kind: "videos", role: "reference", duration_seconds: 5 },
        { id: "aud1", kind: "audios", role: "reference" },
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
});
