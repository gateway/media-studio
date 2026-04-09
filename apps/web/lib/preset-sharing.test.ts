import { describe, expect, it } from "vitest";

import {
  buildImportedPresetPayload,
  createPortablePresetBundleManifest,
  parsePortablePresetBundleManifest,
  PORTABLE_PRESET_BUNDLE_KIND,
  PORTABLE_PRESET_BUNDLE_SCHEMA_VERSION,
  resolvePresetImport,
} from "@/lib/preset-sharing";
import type { MediaPreset } from "@/lib/types";

function buildPreset(overrides: Partial<MediaPreset> = {}): MediaPreset {
  return {
    preset_id: overrides.preset_id ?? "preset-1",
    key: overrides.key ?? "portrait-preset",
    label: overrides.label ?? "Portrait Preset",
    status: overrides.status ?? "active",
    model_key: overrides.model_key ?? "nano-banana-2",
    source_kind: overrides.source_kind ?? "custom",
    base_builtin_key: overrides.base_builtin_key ?? null,
    applies_to_models: overrides.applies_to_models ?? ["nano-banana-2", "nano-banana-pro"],
    applies_to_task_modes: overrides.applies_to_task_modes ?? ["image_edit"],
    applies_to_input_patterns: overrides.applies_to_input_patterns ?? ["single_image"],
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

describe("preset-sharing", () => {
  it("creates and parses the portable manifest shape", () => {
    const manifest = createPortablePresetBundleManifest(buildPreset());
    expect(manifest.kind).toBe(PORTABLE_PRESET_BUNDLE_KIND);
    expect(manifest.schema_version).toBe(PORTABLE_PRESET_BUNDLE_SCHEMA_VERSION);

    const parsed = parsePortablePresetBundleManifest(manifest);
    expect(parsed.preset.key).toBe("portrait-preset");
    expect(parsed.preset.input_schema_json).toHaveLength(1);
    expect(parsed.preset.input_slots_json).toHaveLength(1);
  });

  it("skips an exact duplicate custom preset", () => {
    const preset = buildPreset();
    const resolution = resolvePresetImport([preset], createPortablePresetBundleManifest(preset).preset);
    expect(resolution.status).toBe("skipped");
    expect(resolution.payload).toBeNull();
  });

  it("imports a same-key conflict as a copy", () => {
    const existing = buildPreset();
    const incoming = buildPreset({ prompt_template: "Create [[person]] as {{style}} with dramatic light." });
    const resolution = resolvePresetImport([existing], createPortablePresetBundleManifest(incoming).preset);
    expect(resolution.status).toBe("copied");
    expect(resolution.payload?.key).toBe("portrait-preset-copy");
    expect(resolution.payload?.label).toBe("Portrait Preset Copy");
  });

  it("imports a shipped shared preset as a local copy instead of skipping it", () => {
    const sharedPreset = buildPreset({
      preset_id: "media-preset-portrait-shared",
      source_kind: "custom",
    });
    const resolution = resolvePresetImport(
      [sharedPreset],
      createPortablePresetBundleManifest(sharedPreset).preset,
    );
    expect(resolution.status).toBe("copied");
    expect(resolution.payload?.source_kind).toBe("imported");
    expect(resolution.payload?.key).toBe("portrait-preset-copy");
  });

  it("builds imported preset payloads with imported source kind", () => {
    const payload = buildImportedPresetPayload(createPortablePresetBundleManifest(buildPreset()).preset);
    expect(payload.source_kind).toBe("imported");
    expect(payload.applies_to_models).toEqual(["nano-banana-2", "nano-banana-pro"]);
  });
});
