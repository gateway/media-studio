// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  studioComposerModelLabel,
  useStudioShellCatalog,
} from "@/hooks/studio/use-studio-shell-catalog";
import type {
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
} from "@/lib/types";

function model(overrides: Partial<MediaModelSummary> & Pick<MediaModelSummary, "key">): MediaModelSummary {
  return {
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    generation_kind: overrides.generation_kind ?? "image",
    task_modes: overrides.task_modes ?? [],
    capability_summary: overrides.capability_summary ?? [],
    studio_exposed: overrides.studio_exposed,
  } as MediaModelSummary;
}

function preset(overrides: Partial<MediaPreset> & Pick<MediaPreset, "preset_id" | "key">): MediaPreset {
  return {
    preset_id: overrides.preset_id,
    key: overrides.key,
    label: overrides.label ?? overrides.key,
  } as MediaPreset;
}

describe("useStudioShellCatalog", () => {
  it("merges hydrated presets and exposes only enabled Studio models", () => {
    const models = [
      model({ key: "gpt-image-2", label: "GPT Image 2" }),
      model({ key: "seedance-2", label: "Seedance 2.0 Standard", generation_kind: "video" }),
      model({ key: "hidden-model", studio_exposed: false }),
      model({ key: "disabled-model" }),
    ];
    const queuePolicies = [
      { model_key: "disabled-model", enabled: false },
    ] as MediaModelQueuePolicy[];
    const presets = [
      preset({ preset_id: "preset-1", key: "portrait", label: "Portrait" }),
    ];
    const hydratedPresets = [
      preset({ preset_id: "preset-1", key: "portrait", label: "Portrait Detailed" }),
      preset({ preset_id: "preset-2", key: "product", label: "Product" }),
    ];

    const { result } = renderHook(() =>
      useStudioShellCatalog({
        models,
        presets,
        hydratedPresets,
        queuePolicies,
      }),
    );

    expect(result.current.studioPresetCatalog.map((entry) => entry.label)).toEqual([
      "Product",
      "Portrait Detailed",
    ]);
    expect(result.current.enabledStudioModels.map((entry) => entry.key)).toEqual([
      "gpt-image-2",
      "seedance-2",
    ]);
    expect(result.current.enabledStudioModelChoices).toEqual([
      {
        value: "gpt-image-2",
        label: "GPT Image 2",
        groupLabel: "Images",
        groupOrder: 1,
      },
      {
        value: "seedance-2",
        label: "Seedance 2.0",
        groupLabel: "Video",
        groupOrder: 2,
      },
    ]);
    expect(result.current.modelIconByKey.has("hidden-model")).toBe(true);
  });

  it("normalizes empty and long model labels for compact composer controls", () => {
    expect(studioComposerModelLabel(null)).toBe("Model");
    expect(studioComposerModelLabel("Seedance 2.0 Standard")).toBe("Seedance 2.0");
  });
});
