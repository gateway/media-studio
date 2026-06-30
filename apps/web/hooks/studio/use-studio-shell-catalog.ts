"use client";

import { useMemo } from "react";
import {
  Clapperboard,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";

import type {
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
} from "@/lib/types";

export function studioComposerModelLabel(label: string | null | undefined) {
  if (!label) return "Model";
  if (label === "Seedance 2.0 Standard") return "Seedance 2.0";
  return label;
}

export function studioComposerModelIcon(model: MediaModelSummary | null | undefined): LucideIcon {
  if (!model) {
    return Clapperboard;
  }
  const taskModes = model.task_modes ?? [];
  const capabilities = model.capability_summary ?? [];
  const isVideoModel =
    model.generation_kind === "video" ||
    taskModes.some((mode) => mode.includes("video") || mode === "motion_control") ||
    capabilities.includes("video");
  return isVideoModel ? Clapperboard : ImageIcon;
}

export function studioComposerModelChoice(model: MediaModelSummary) {
  const isVideoModel = studioComposerModelIcon(model) === Clapperboard;
  return {
    value: model.key,
    label: studioComposerModelLabel(model.label),
    groupLabel: isVideoModel ? "Video" : "Images",
    groupOrder: isVideoModel ? 2 : 1,
  };
}

export function mergeStudioPresetDetail(presets: MediaPreset[], detail: MediaPreset) {
  return [
    detail,
    ...presets.filter((preset) => preset.preset_id !== detail.preset_id && preset.key !== detail.key),
  ];
}

export async function fetchStudioPresetDetail(presetIdOrKey: string) {
  const response = await fetch(`/api/control/media-presets/${encodeURIComponent(presetIdOrKey)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Unable to load preset details.");
  }
  const payload = (await response.json()) as { ok?: boolean; preset?: MediaPreset | null; error?: string };
  if (payload.ok === false || !payload.preset) {
    throw new Error(payload.error ?? "Unable to load preset details.");
  }
  return payload.preset;
}

type StudioShellCatalogParams = {
  models: MediaModelSummary[];
  presets: MediaPreset[];
  hydratedPresets: MediaPreset[];
  queuePolicies: MediaModelQueuePolicy[];
};

export function useStudioShellCatalog({
  models,
  presets,
  hydratedPresets,
  queuePolicies,
}: StudioShellCatalogParams) {
  const studioPresetCatalog = useMemo(
    () => hydratedPresets.reduce((current, preset) => mergeStudioPresetDetail(current, preset), presets),
    [hydratedPresets, presets],
  );
  const enabledStudioModels = useMemo(
    () =>
      models.filter((model) => {
        if (model.studio_exposed === false) {
          return false;
        }
        const policy = queuePolicies.find((entry) => entry.model_key === model.key);
        return policy?.enabled ?? true;
      }),
    [models, queuePolicies],
  );
  const enabledStudioModelChoices = useMemo(
    () => enabledStudioModels.map(studioComposerModelChoice),
    [enabledStudioModels],
  );
  const modelIconByKey = useMemo(
    () => new Map(models.map((model) => [model.key, studioComposerModelIcon(model)])),
    [models],
  );

  return {
    studioPresetCatalog,
    enabledStudioModels,
    enabledStudioModelChoices,
    modelIconByKey,
  };
}
