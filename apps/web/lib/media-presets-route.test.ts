import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();
const postControlApiJson = vi.fn();

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  postControlApiJson,
  mapPresetRecord: (preset: Record<string, unknown>) => preset,
  mapPresetSummaryRecord: (preset: Record<string, unknown>) => ({
    preset_id: String(preset.preset_id),
    key: String(preset.key),
    label: String(preset.label),
    description: preset.description ?? null,
    status: String(preset.status ?? "active"),
    model_key: preset.model_key ?? null,
    source_kind: preset.source_kind ?? "custom",
    base_builtin_key: preset.base_builtin_key ?? null,
    applies_to_models: preset.applies_to_models_json ?? [],
    applies_to_task_modes: preset.applies_to_task_modes_json ?? [],
    applies_to_input_patterns: preset.applies_to_input_patterns_json ?? [],
    requires_image: Boolean(preset.requires_image),
    requires_video: Boolean(preset.requires_video),
    requires_audio: Boolean(preset.requires_audio),
    thumbnail_path: preset.thumbnail_path ?? null,
    thumbnail_url: preset.thumbnail_url ?? null,
    version: preset.version ?? null,
    priority: Number(preset.priority ?? 100),
    created_at: preset.created_at ?? null,
    updated_at: preset.updated_at ?? null,
    input_schema_count: Array.isArray(preset.input_schema_json) ? preset.input_schema_json.length : 0,
    input_slots_count: Array.isArray(preset.input_slots_json) ? preset.input_slots_json.length : 0,
  }),
}));

function buildPreset() {
  return {
    preset_id: "preset-1",
    key: "portrait-preset",
    label: "Portrait Preset",
    description: "Portrait preset",
    status: "active",
    model_key: "gpt-image-2",
    source_kind: "custom",
    applies_to_models_json: ["gpt-image-2"],
    applies_to_task_modes_json: ["text_to_image"],
    applies_to_input_patterns_json: ["prompt_only"],
    prompt_template: "Create {{subject}}.",
    system_prompt_template: "You are an image director.",
    default_options_json: { size: "1024x1024" },
    rules_json: { avoid: ["logos"] },
    input_schema_json: [{ key: "subject", label: "Subject" }],
    input_slots_json: [{ key: "reference", label: "Reference" }],
    notes: "Large internal note.",
    thumbnail_url: "/preset-thumb.webp",
    created_at: "2026-06-09T00:00:00.000Z",
    updated_at: "2026-06-09T00:00:00.000Z",
  };
}

describe("control media-presets route", () => {
  beforeEach(() => {
    vi.resetModules();
    getControlApiJson.mockReset();
    postControlApiJson.mockReset();
  });

  it("keeps the default media-presets response backward compatible", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { items: [buildPreset()], total: 1, limit: 60, offset: 0, next_offset: null },
    });

    const { GET } = await import("@/app/api/control/media-presets/route");
    const response = await GET(new Request("http://localhost/api/control/media-presets?limit=60&status=active"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.presets[0]).toMatchObject({
      preset_id: "preset-1",
      prompt_template: "Create {{subject}}.",
      default_options_json: { size: "1024x1024" },
      input_schema_json: [{ key: "subject", label: "Subject" }],
    });
    expect(getControlApiJson).toHaveBeenCalledWith("/media/presets/search?limit=60&offset=0&status=active", "read");
  });

  it("returns a lightweight summary contract when view=summary is requested", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { items: [buildPreset()], total: 1, limit: 60, offset: 0, next_offset: null },
    });

    const { GET } = await import("@/app/api/control/media-presets/route");
    const response = await GET(
      new Request("http://localhost/api/control/media-presets?limit=60&status=active&view=summary"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.presets[0]).toMatchObject({
      preset_id: "preset-1",
      key: "portrait-preset",
      label: "Portrait Preset",
      input_schema_count: 1,
      input_slots_count: 1,
      thumbnail_url: "/preset-thumb.webp",
    });
    expect(payload.presets[0]).not.toHaveProperty("prompt_template");
    expect(payload.presets[0]).not.toHaveProperty("system_prompt_template");
    expect(payload.presets[0]).not.toHaveProperty("default_options_json");
    expect(payload.presets[0]).not.toHaveProperty("rules_json");
    expect(payload.presets[0]).not.toHaveProperty("input_schema_json");
    expect(payload.presets[0]).not.toHaveProperty("input_slots_json");
    expect(payload.presets[0]).not.toHaveProperty("notes");
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/presets/search?limit=60&offset=0&status=active",
      "read",
    );
  });

  it("keeps the error envelope and status when preset search fails", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "Search unavailable.",
    });

    const { GET } = await import("@/app/api/control/media-presets/route");
    const response = await GET(new Request("http://localhost/api/control/media-presets?limit=60&status=active"));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ ok: false, error: "Search unavailable." });
  });
});
