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

    const { buildMediaPayloadFromFormData } = await import("@/app/api/control/media/shared");
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
});
