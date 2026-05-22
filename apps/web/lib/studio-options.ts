import {
  Clapperboard,
  Clock3,
  Globe2,
  Monitor,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";

import { HIDDEN_STUDIO_OPTION_KEYS, optionChoices } from "@/lib/studio-model-support";
import type { MediaModelSummary } from "@/lib/types";
import { isRecord } from "@/lib/utils";

export type StudioChoice = {
  value: string;
  label: string;
};

export type MultiShotParseResult = {
  shots: Array<{ duration: number; prompt: string }>;
  errors: string[];
  totalDuration: number;
};

const STUDIO_PICKER_WIDTHS: Record<string, string> = {
  model: "w-full sm:w-[224px]",
  preset: "w-full sm:w-[162px]",
  "output-count": "w-[calc(50%-0.25rem)] sm:w-[90px]",
  duration: "w-[calc(50%-0.25rem)] sm:w-[124px]",
  aspect_ratio: "w-[calc(50%-0.25rem)] sm:w-[100px]",
  sound: "w-[calc(50%-0.25rem)] sm:w-[96px]",
  audio: "w-[calc(50%-0.25rem)] sm:w-[96px]",
  resolution: "w-[calc(50%-0.25rem)] sm:w-[104px]",
  output_format: "w-[calc(50%-0.25rem)] sm:w-[108px]",
  mode: "w-[calc(50%-0.25rem)] sm:w-[102px]",
  google_search: "w-[calc(50%-0.25rem)] sm:w-[112px]",
};

export function optionEntries(model: MediaModelSummary | null) {
  if (Array.isArray(model?.studio_dynamic_options) && model.studio_dynamic_options.length) {
    return model.studio_dynamic_options
      .filter((option) => option && !option.hidden_from_studio && option.key && !HIDDEN_STUDIO_OPTION_KEYS.has(option.key))
      .map((option) => {
        const schema: Record<string, unknown> = {
          type: option.type,
          allowed: option.allowed,
          default: option.default,
          min: option.min,
          max: option.max,
          required: option.required,
          label: option.label,
          help_text: option.help_text,
          ui_group: option.ui_group,
          ui_order: option.ui_order,
          advanced: option.advanced,
        };
        return [option.key, schema] as [string, Record<string, unknown>];
      });
  }
  if (!model?.options || !isRecord(model.options)) {
    return [] as Array<[string, Record<string, unknown>]>;
  }
  return Object.entries(model.options).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      !HIDDEN_STUDIO_OPTION_KEYS.has(entry[0]) && isRecord(entry[1]),
  );
}

export function sanitizeStudioOptions(options: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !HIDDEN_STUDIO_OPTION_KEYS.has(key)),
  );
}

export function hasUsableOptionValue(value: unknown) {
  if (value == null) {
    return false;
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

export function buildNormalizedStudioOptions(
  model: MediaModelSummary | null,
  currentOptions: Record<string, unknown>,
  presetDefaults?: Record<string, unknown> | null,
) {
  const seededOptions: Record<string, unknown> = {
    ...(isRecord(model?.defaults) ? model.defaults : {}),
    ...(isRecord(presetDefaults) ? presetDefaults : {}),
    ...currentOptions,
  };
  for (const [optionKey, schema] of optionEntries(model)) {
    if (optionKey === "sound" && !hasUsableOptionValue(currentOptions[optionKey])) {
      seededOptions[optionKey] = false;
      continue;
    }
    if (hasUsableOptionValue(seededOptions[optionKey])) {
      continue;
    }
    if (hasUsableOptionValue(schema.default)) {
      seededOptions[optionKey] = schema.default;
      continue;
    }
    const choices = optionChoices(schema, seededOptions[optionKey]);
    if (choices.length) {
      seededOptions[optionKey] = choices[0];
    }
  }
  return sanitizeStudioOptions(seededOptions);
}

export function stripUnsupportedStudioOptions(
  modelKey: string,
  inputPattern: string,
  options: Record<string, unknown>,
) {
  const sanitized = { ...options };
  if (modelKey === "kling-3.0-i2v" && inputPattern === "first_last_frames") {
    delete sanitized.aspect_ratio;
  }
  return sanitized;
}

function aspectRatioIcon(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) {
    return RectangleHorizontal;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return RectangleHorizontal;
  }
  if (Math.abs(width - height) < 0.001) {
    return Square;
  }
  return width > height ? RectangleHorizontal : RectangleVertical;
}

export function optionIcon(optionKey: string, value?: unknown) {
  if (optionKey.includes("sound") || optionKey.includes("audio")) {
    return Volume2;
  }
  if (optionKey.includes("google_search") || optionKey.includes("web")) {
    return Globe2;
  }
  if (optionKey.includes("duration")) {
    return Clock3;
  }
  if (optionKey.includes("ratio")) {
    return aspectRatioIcon(value);
  }
  if (optionKey.includes("resolution") || optionKey.includes("size")) {
    return RectangleHorizontal;
  }
  if (optionKey.includes("preset")) {
    return Sparkles;
  }
  if (optionKey.includes("model")) {
    return Clapperboard;
  }
  if (optionKey.includes("orientation") || optionKey.includes("mode")) {
    return SlidersHorizontal;
  }
  return Monitor;
}

export function pickerWidth(pickerId: string) {
  const exact = STUDIO_PICKER_WIDTHS[pickerId];
  if (exact) {
    return exact;
  }
  if (pickerId.includes("audio")) return STUDIO_PICKER_WIDTHS.audio;
  if (pickerId.includes("duration")) return STUDIO_PICKER_WIDTHS.duration;
  if (pickerId.includes("ratio")) return STUDIO_PICKER_WIDTHS.aspect_ratio;
  if (pickerId.includes("resolution") || pickerId.includes("size")) return STUDIO_PICKER_WIDTHS.resolution;
  if (pickerId.includes("format")) return STUDIO_PICKER_WIDTHS.output_format;
  if (pickerId.includes("web")) return STUDIO_PICKER_WIDTHS.google_search;
  return "w-[calc(50%-0.25rem)] sm:w-[108px]";
}

export function pickerMenuHeightCap(pickerId: string) {
  if (pickerId === "model") {
    return 520;
  }
  return 360;
}

export function serializeOptionChoice(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value ?? "");
}

export function parseOptionChoice(schema: Record<string, unknown>, value: string) {
  if (schema.type === "bool" || schema.type === "boolean" || typeof schema.default === "boolean") {
    return value === "true";
  }
  if (schema.type === "number" || schema.type === "int_range" || schema.type === "float_range" || schema.type === "number_range") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

export function optionShortLabel(optionKey: string) {
  if (optionKey === "aspect_ratio") return "Aspect";
  if (optionKey === "resolution") return "Resolution";
  if (optionKey === "output_format") return "Format";
  if (optionKey === "duration") return "Duration";
  if (optionKey === "sound") return "Audio";
  if (optionKey === "google_search") return "Web";
  if (optionKey === "multi_shots") return "Multi View";
  if (optionKey === "mode") return "Mode";
  return optionKey.replaceAll("_", " ");
}

export function optionBooleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return false;
}

export function toWholeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

export function parseMultiShotScript(script: string, selectedDuration: unknown): MultiShotParseResult {
  const trimmed = script.trim();
  if (!trimmed) {
    return {
      shots: [],
      errors: ["Add one shot per line in the format `seconds | prompt`."],
      totalDuration: 0,
    };
  }

  const errors: string[] = [];
  const shots = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      const separatorIndex = line.indexOf("|");
      if (separatorIndex === -1) {
        errors.push(`Line ${index + 1} must use \`seconds | prompt\`.`);
        return [];
      }

      const durationText = line.slice(0, separatorIndex).trim();
      const promptText = line.slice(separatorIndex + 1).trim();
      const duration = Number(durationText);

      if (!Number.isInteger(duration) || duration <= 0) {
        errors.push(`Line ${index + 1} needs a whole-number duration before the pipe.`);
        return [];
      }

      if (duration < 1 || duration > 12) {
        errors.push(`Line ${index + 1} duration must stay between 1 and 12 seconds.`);
        return [];
      }

      if (!promptText) {
        errors.push(`Line ${index + 1} needs prompt text after the pipe.`);
        return [];
      }

      return [{ duration, prompt: promptText }];
    });

  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const expectedDuration = toWholeNumber(selectedDuration);
  if (expectedDuration != null && shots.length && totalDuration !== expectedDuration) {
    errors.push(`Shot durations total ${totalDuration}s, but the selected duration is ${expectedDuration}s.`);
  }

  return { shots, errors, totalDuration };
}

export function displayChoiceLabel(optionKey: string, _schema: Record<string, unknown>, value: unknown) {
  if (value == null || value === "") {
    return "Select";
  }
  if (optionKey === "mode" && typeof value === "string") {
    if (value === "std" || value === "720p") return "Standard";
    if (value === "pro" || value === "1080p") return "High";
  }
  if (optionKey === "duration") {
    const duration = toWholeNumber(value);
    return duration != null ? `${duration}s` : String(value);
  }
  if (optionKey === "output_format" && typeof value === "string") {
    return value.toUpperCase();
  }
  if ((optionKey === "resolution" || optionKey === "size") && typeof value === "string") {
    return value.replaceAll("_", " ").toUpperCase();
  }
  if (typeof value === "boolean") {
    if (optionKey === "google_search") return value ? "On" : "Off";
    if (optionKey === "sound") return value ? "On" : "Off";
    return value ? "On" : "Off";
  }
  if (typeof value === "string") {
    return value.replaceAll("_", " ");
  }
  return String(value);
}

export function displayOptionControlLabel(optionKey: string, valueLabel: string) {
  if (optionKey === "duration") {
    return valueLabel.toLowerCase() === "select" ? "Duration" : `Duration ${valueLabel}`;
  }
  return valueLabel;
}

export function studioOptionChoices(
  modelKey: string | null | undefined,
  optionKey: string,
  schema: Record<string, unknown>,
  currentValue: unknown,
) {
  return optionChoices(schema, currentValue);
}

export function buildChoiceList(
  modelKey: string | null | undefined,
  optionKey: string,
  schema: Record<string, unknown>,
  currentValue: unknown,
): StudioChoice[] {
  return studioOptionChoices(modelKey, optionKey, schema, currentValue).map((choice) => ({
    value: serializeOptionChoice(choice),
    label: displayChoiceLabel(optionKey, schema, choice),
  }));
}
