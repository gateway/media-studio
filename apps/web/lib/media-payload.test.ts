import { beforeEach, describe, expect, it, vi } from "vitest";
const registerReferenceMediaFile = vi.fn();
const resolveReferenceMedia = vi.fn();

vi.mock("@/lib/reference-media-storage", () => ({
  registerReferenceMediaFile,
  resolveReferenceMedia,
}));

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

// Storage is mocked at the import boundary: these cases only parse in-memory FormData.
describe("media FormData characterization", () => {
  async function build(fields: Record<string, string> = {}) {
    const { buildMediaPayloadFromFormData } = await import("../app/api/control/media/shared");
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    return buildMediaPayloadFromFormData(formData);
  }

  it.each([undefined, "", "  "])("defaults missing or empty fields (%j)", async (value) => {
    const fields = value === undefined ? {} : Object.fromEntries(
      ["intent", "model_key", "prompt", "options", "metadata", "multi_prompt", "enhance", "system_prompt_ids",
        "preset_inputs_json", "preset_slot_values_json", "attachment_manifest"].map((key) => [key, value]),
    );
    expect(await build(fields)).toEqual({
      intent: "validate", modelKey: "", payload: {
        model_key: "", prompt: "", enhance: false, options: {}, metadata: {}, selected_system_prompt_ids: [],
      },
    });
    expect(registerReferenceMediaFile).not.toHaveBeenCalled();
    expect(resolveReferenceMedia).not.toHaveBeenCalled();
  });

  it.each(["{broken", "[]", "null", "42", '"text"'])("rejects non-record preset fields (%s)", async (value) => {
    const { payload } = await build({ preset_inputs_json: value, preset_slot_values_json: value });
    expect(payload).not.toHaveProperty("preset_text_values");
    expect(payload).not.toHaveProperty("preset_image_slots");
  });

  it("retains JSON fallbacks and record-only array entries", async () => {
    const { payload } = await build({
      options: "{broken", metadata: "{broken", system_prompt_ids: "{broken",
      multi_prompt: '[null,1,"text",[],{"prompt":"keep"}]', attachment_manifest: "{broken",
    });
    expect(payload).toEqual({ model_key: "", prompt: "", enhance: false, options: {}, metadata: {},
      selected_system_prompt_ids: [], multi_prompt: [{ prompt: "keep" }] });
    expect(registerReferenceMediaFile).not.toHaveBeenCalled();
    expect(resolveReferenceMedia).not.toHaveBeenCalled();
  });

  it.each(["{}", "null", "1", '"text"'])("ignores non-array multi prompts and manifests (%s)", async (value) => {
    const { payload } = await build({ multi_prompt: value, attachment_manifest: value });
    expect(payload).not.toHaveProperty("multi_prompt");
    expect(payload).not.toHaveProperty("images");
    expect(resolveReferenceMedia).not.toHaveBeenCalled();
  });

  it("preserves permissive JSON values outside record-only fields", async () => {
    const { payload } = await build({ options: "[]", metadata: "null", system_prompt_ids: '{"legacy":true}' });
    expect(payload.options).toEqual({});
    expect(payload.metadata).toBeNull();
    expect(payload.selected_system_prompt_ids).toEqual({ legacy: true });
    await expect(build({ options: "null" })).rejects.toThrow(TypeError);
  });

  it.each([[" true ", true], ["TRUE", true], ["false", false], ["1", false], ["on", false]])(
    "parses enhance %s as %s", async (enhance, expected) => {
      expect((await build({ enhance })).payload.enhance).toBe(expected);
    },
  );

  it("retains option coercions without trimming other strings", async () => {
    const { payload } = await build({ options: JSON.stringify({ sound: " OFF ", duration: "5 s", count: "02",
      enabled: "TRUE", disabled: "False", ratio: " 16:9 ", negative: "-1", decimal: "1.5", nested: { keep: "true" } }) });
    expect(payload.options).toEqual({ sound: false, duration: 5, count: 2, enabled: true, disabled: false,
      ratio: " 16:9 ", negative: "-1", decimal: "1.5", nested: { keep: "true" } });
  });

  it.each([["0", undefined], ["-1", undefined], ["NaN", undefined], ["Infinity", undefined], ["0.4", 1], ["2.9", 2]])(
    "coerces output count %s", async (output_count, expected) => {
      expect((await build({ output_count })).payload.output_count).toBe(expected);
    },
  );

  it("trims model and scalar fields and keeps custom presets ahead of builtin keys", async () => {
    const fields = { intent: " ENHANCE ", model_key: " model ", prompt: " prompt ", task_mode: " mode ",
      source_asset_id: " 12 ", project_id: " project ", preset_id: " custom ", preset_key: " builtin-key ",
      preset_inputs_json: '{"actor":"Steve"}' };
    const result = await build(fields);
    expect(result).toMatchObject({ intent: "enhance", modelKey: "model", payload: {
      model_key: "model", prompt: "prompt", task_mode: "mode", source_asset_id: "12", project_id: "project",
      preset_id: "custom", preset_text_values: { actor: "Steve" },
    } });
    expect(result.payload).not.toHaveProperty("prompt_preset_key");
    const builtin = await build({ ...fields, preset_id: " builtin:test " });
    expect(builtin.payload.prompt_preset_key).toBe("builtin-key");
    expect(builtin.payload).not.toHaveProperty("preset_id");
    expect((await build({ intent: " OTHER " })).intent).toBe("other");
  });

  it("normalizes slot records while preserving keys, objects and empty slots", async () => {
    const { payload } = await build({ preset_slot_values_json: JSON.stringify({
      "": { asset_id: 99 }, " person ": { asset_id: "123", path: "existing.png", extra: true },
      mixed: [null, [], "discard", 1, { asset_id: 1 }, { path: "image.png" }],
      empty: null, primitive: "discard", nested: [[{ asset_id: 2 }]],
    }) });
    expect(payload.preset_image_slots).toEqual({
      " person ": [{ asset_id: "123", path: "existing.png", extra: true }],
      mixed: [{ asset_id: 1 }, { path: "image.png" }], empty: [], primitive: [], nested: [],
    });
    expect(registerReferenceMediaFile).not.toHaveBeenCalled();
    expect(resolveReferenceMedia).not.toHaveBeenCalled();
  });

  it.each(["validate", "submit"])("uses the same attachment operations for %s", async (intent) => {
    const { buildMediaPayloadFromFormData } = await import("../app/api/control/media/shared");
    resolveReferenceMedia.mockResolvedValue({ reference_id: "canonical", stored_path: "stored.png" });
    registerReferenceMediaFile.mockResolvedValue({ reference_id: "uploaded", stored_path: "uploaded.mp4" });
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("attachment_manifest", JSON.stringify([
      null, [], { id: "", kind: "images", reference_id: "ignored" },
      { id: "ref", kind: "unknown", role: " reference ", reference_id: " existing ", has_file: true, duration_seconds: "" },
      { id: "upload", kind: "videos", has_file: "false", duration_seconds: "bad" },
      { id: "missing", kind: "images", has_file: true },
    ]));
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    formData.append("attachments", new File([], "empty.png"));
    formData.append("attachments", "ignored");
    formData.append("attachments", file);
    const result = await buildMediaPayloadFromFormData(formData);
    expect(result.intent).toBe(intent);
    expect(result.payload.images).toEqual([{ reference_id: "canonical", path: "stored.png", role: "reference", duration_seconds: 0 }]);
    expect(result.payload.videos).toEqual([{ reference_id: "uploaded", path: "uploaded.mp4" }]);
    expect(resolveReferenceMedia).toHaveBeenCalledExactlyOnceWith("existing");
    expect(registerReferenceMediaFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it.each(["validate", "submit"])("retains unresolved-reference errors for %s", async (intent) => {
    resolveReferenceMedia.mockResolvedValue(null);
    await expect(build({ intent, attachment_manifest: '[{"id":"a","kind":"images","reference_id":"missing"}]' }))
      .rejects.toThrow("Unable to resolve the selected reference media item.");
    await expect(build({ intent, preset_slot_values_json: '{"person":{"reference_id":"missing"}}' }))
      .rejects.toThrow("Unable to resolve the selected preset reference media item.");
    expect(registerReferenceMediaFile).not.toHaveBeenCalled();
  });

  it("resolves only pathless slot references and deduplicates numeric asset ids", async () => {
    resolveReferenceMedia.mockResolvedValue({ reference_id: "canonical", stored_path: "stored.png" });
    const { payload } = await build({ preset_slot_values_json: JSON.stringify({
      person: [{ reference_id: " existing ", extra: true }, { reference_id: "skip", path: "already.png" }, { asset_id: "12" }],
    }), "preset_slot_asset:person": "12", "preset_slot_asset:invalid": "NaN", "preset_slot_asset:zero": "0" });
    expect(payload.preset_image_slots).toEqual({ person: [
      { reference_id: "canonical", path: "stored.png", extra: true }, { reference_id: "skip", path: "already.png" }, { asset_id: "12" },
    ] });
    expect(resolveReferenceMedia).toHaveBeenCalledExactlyOnceWith("existing");
  });
});
