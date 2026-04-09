import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

import { createPortablePresetBundleManifest } from "@/lib/preset-sharing";
import type { MediaPreset } from "@/lib/types";

const getControlApiJson = vi.fn();
const postControlApiJson = vi.fn();
const mapPresetRecord = vi.fn((preset: Record<string, unknown>) => preset);
const readPresetThumbnailBuffer = vi.fn();
const storePresetThumbnailBuffer = vi.fn();

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  postControlApiJson,
  mapPresetRecord,
}));

vi.mock("@/lib/preset-thumbnail-storage", () => ({
  readPresetThumbnailBuffer,
  storePresetThumbnailBuffer,
}));

function buildPreset(overrides: Partial<MediaPreset> = {}): MediaPreset {
  return {
    preset_id: overrides.preset_id ?? "preset-1",
    key: overrides.key ?? "portrait-preset",
    label: overrides.label ?? "Portrait Preset",
    status: overrides.status ?? "active",
    model_key: overrides.model_key ?? "nano-banana-2",
    source_kind: overrides.source_kind ?? "custom",
    base_builtin_key: overrides.base_builtin_key ?? null,
    applies_to_models: overrides.applies_to_models ?? ["nano-banana-2"],
    applies_to_task_modes: overrides.applies_to_task_modes ?? [],
    applies_to_input_patterns: overrides.applies_to_input_patterns ?? [],
    prompt_template: overrides.prompt_template ?? "Create [[person]] as {{style}}.",
    system_prompt_template: overrides.system_prompt_template ?? null,
    system_prompt_ids: overrides.system_prompt_ids ?? [],
    default_options_json: overrides.default_options_json ?? {},
    rules_json: overrides.rules_json ?? {},
    requires_image: overrides.requires_image ?? true,
    requires_video: overrides.requires_video ?? false,
    requires_audio: overrides.requires_audio ?? false,
    input_schema_json:
      overrides.input_schema_json ??
      [{ key: "style", label: "Style", placeholder: "", default_value: "", required: true }],
    input_slots_json:
      overrides.input_slots_json ??
      [{ key: "person", label: "Person", help_text: "", required: true, max_files: 1 }],
    choice_groups_json: overrides.choice_groups_json ?? [],
    thumbnail_path: overrides.thumbnail_path ?? null,
    thumbnail_url: overrides.thumbnail_url ?? null,
    notes: overrides.notes ?? null,
    version: overrides.version ?? "v1",
    priority: overrides.priority ?? 100,
    created_at: overrides.created_at ?? null,
    updated_at: overrides.updated_at ?? null,
    description: overrides.description ?? null,
  };
}

async function buildBundle({
  preset,
  thumbnailFileName,
}: {
  preset: MediaPreset;
  thumbnailFileName?: string | null;
}) {
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify(
      createPortablePresetBundleManifest({
        ...preset,
        thumbnail: thumbnailFileName ? { file_name: thumbnailFileName } : null,
      }),
      null,
      2,
    ),
  );
  if (thumbnailFileName) {
    zip.file(thumbnailFileName, Buffer.from("thumb"));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return new File([buffer], "preset.zip", { type: "application/zip" });
}

describe("media preset sharing routes", () => {
  beforeEach(() => {
    vi.resetModules();
    getControlApiJson.mockReset();
    postControlApiJson.mockReset();
    mapPresetRecord.mockImplementation((preset: Record<string, unknown>) => preset);
    readPresetThumbnailBuffer.mockReset();
    storePresetThumbnailBuffer.mockReset();
  });

  it("exports a preset bundle with manifest and thumbnail", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: [buildPreset({ thumbnail_path: "preset-thumbnails/preset-thumb.webp" })],
    });
    readPresetThumbnailBuffer.mockResolvedValueOnce(Buffer.from("thumbnail"));

    const { GET } = await import("@/app/api/control/media-presets/export/[presetId]/route");
    const response = await GET(new Request("http://localhost/api/control/media-presets/export/preset-1"), {
      params: Promise.resolve({ presetId: "preset-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("text")) as {
      preset: { thumbnail?: { file_name?: string } | null };
    };
    expect(manifest.preset.thumbnail?.file_name).toBe("assets/preset-thumb.webp");
    expect(await zip.file("assets/preset-thumb.webp")?.async("text")).toBe("thumbnail");
  });

  it("imports a preset bundle without a thumbnail", async () => {
    getControlApiJson.mockResolvedValueOnce({ ok: true, data: [] });
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { ...buildPreset(), preset_id: "preset-imported" },
    });

    const bundle = await buildBundle({ preset: buildPreset() });
    const formData = new FormData();
    formData.set("file", bundle);

    const { POST } = await import("@/app/api/control/media-presets/import/route");
    const response = await POST(new Request("http://localhost/api/control/media-presets/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("created");
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/media/presets",
      expect.objectContaining({
        key: "portrait-preset",
        source_kind: "imported",
        thumbnail_path: null,
        thumbnail_url: null,
      }),
      "admin",
    );
  });

  it("imports a preset bundle with a thumbnail", async () => {
    getControlApiJson.mockResolvedValueOnce({ ok: true, data: [] });
    storePresetThumbnailBuffer.mockResolvedValueOnce({
      thumbnail_path: "preset-thumbnails/imported-thumb.webp",
      thumbnail_url: "/api/preset-thumbnails/imported-thumb.webp",
    });
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { ...buildPreset(), preset_id: "preset-imported" },
    });

    const bundle = await buildBundle({
      preset: buildPreset(),
      thumbnailFileName: "assets/thumbnail.webp",
    });
    const formData = new FormData();
    formData.set("file", bundle);

    const { POST } = await import("@/app/api/control/media-presets/import/route");
    const response = await POST(new Request("http://localhost/api/control/media-presets/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("created");
    expect(storePresetThumbnailBuffer).toHaveBeenCalled();
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/media/presets",
      expect.objectContaining({
        thumbnail_path: "preset-thumbnails/imported-thumb.webp",
        thumbnail_url: "/api/preset-thumbnails/imported-thumb.webp",
      }),
      "admin",
    );
  });

  it("skips an exact duplicate custom preset import", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: [buildPreset()],
    });

    const bundle = await buildBundle({ preset: buildPreset() });
    const formData = new FormData();
    formData.set("file", bundle);

    const { POST } = await import("@/app/api/control/media-presets/import/route");
    const response = await POST(new Request("http://localhost/api/control/media-presets/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("skipped");
    expect(postControlApiJson).not.toHaveBeenCalled();
  });

  it("imports a built-in shared preset as a local copy", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: [buildPreset({ preset_id: "media-preset-portrait-shared" })],
    });
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { ...buildPreset(), preset_id: "preset-imported-copy", key: "portrait-preset-copy", label: "Portrait Preset Copy" },
    });

    const bundle = await buildBundle({ preset: buildPreset() });
    const formData = new FormData();
    formData.set("file", bundle);

    const { POST } = await import("@/app/api/control/media-presets/import/route");
    const response = await POST(new Request("http://localhost/api/control/media-presets/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("copied");
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/media/presets",
      expect.objectContaining({
        key: "portrait-preset-copy",
        label: "Portrait Preset Copy",
        source_kind: "imported",
      }),
      "admin",
    );
  });

  it("rejects invalid ZIP bundles", async () => {
    const formData = new FormData();
    formData.set("file", new File([Buffer.from("not-a-zip")], "invalid.zip", { type: "application/zip" }));

    const { POST } = await import("@/app/api/control/media-presets/import/route");
    const response = await POST(new Request("http://localhost/api/control/media-presets/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/valid ZIP bundles/i);
  });

  it("rejects missing manifests", async () => {
    const zip = new JSZip();
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const formData = new FormData();
    formData.set("file", new File([buffer], "missing-manifest.zip", { type: "application/zip" }));

    const { POST } = await import("@/app/api/control/media-presets/import/route");
    const response = await POST(new Request("http://localhost/api/control/media-presets/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/manifest\.json/i);
  });

  it("rejects unsupported manifest versions", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      kind: "media_studio_preset_bundle",
      schema_version: 99,
      preset: buildPreset(),
    }));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const formData = new FormData();
    formData.set("file", new File([buffer], "unsupported.zip", { type: "application/zip" }));

    const { POST } = await import("@/app/api/control/media-presets/import/route");
    const response = await POST(new Request("http://localhost/api/control/media-presets/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not supported/i);
  });
});
