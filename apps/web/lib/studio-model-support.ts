import type { MediaModelSummary } from "@/lib/types";
import { isRecord } from "@/lib/utils";

export const HIDDEN_STUDIO_OPTION_KEYS = new Set<string>();

const KNOWN_STUDIO_INPUT_PATTERNS = new Set([
  "prompt_only",
  "single_image",
  "image_edit",
  "first_last_frames",
  "motion_control",
  "multimodal_reference",
]);

export type StudioModelSupportStatus = "fully_supported" | "generic_supported" | "unsupported";

export type StudioModelSupport = {
  status: StudioModelSupportStatus;
  exposed: boolean;
  supportedInputPatterns: string[];
  unsupportedInputPatterns: string[];
  hiddenReason: string | null;
  supportSummary: string | null;
  unsupportedOptionKeys: string[];
};

function modelInputLimit(model: MediaModelSummary | null, inputKey: "image_inputs" | "video_inputs" | "audio_inputs") {
  const raw = isRecord(model?.[inputKey]) ? model?.[inputKey].required_max : null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
}

function specInputPatterns(model: MediaModelSummary | null) {
  const rawPrompt = (model?.prompt as Record<string, unknown> | undefined) ?? undefined;
  const byPattern =
    (rawPrompt?.default_profile_keys_by_input_pattern as Record<string, unknown> | undefined) ?? undefined;
  if (byPattern && typeof byPattern === "object") {
    return Object.keys(byPattern).filter(Boolean);
  }
  return [];
}

export function supportedModelInputPatterns(model: MediaModelSummary | null) {
  return Array.from(new Set([...(model?.input_patterns ?? []), ...specInputPatterns(model)]));
}

export function optionChoices(schema: Record<string, unknown>, currentValue: unknown) {
  if (Array.isArray(schema.allowed)) {
    return schema.allowed as unknown[];
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum as unknown[];
  }
  if (Array.isArray(schema.allowed_values)) {
    return schema.allowed_values as unknown[];
  }
  if (Array.isArray(schema.choices)) {
    return schema.choices as unknown[];
  }
  if (schema.type === "bool" || schema.type === "boolean" || typeof currentValue === "boolean" || typeof schema.default === "boolean") {
    return [true, false] as unknown[];
  }
  if (
    (schema.type === "int_range" || schema.type === "float_range" || schema.type === "number_range") &&
    typeof schema.min === "number" &&
    typeof schema.max === "number"
  ) {
    const min = Number(schema.min);
    const max = Number(schema.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max >= min && max - min <= 20) {
      return Array.from({ length: max - min + 1 }, (_, index) => min + index);
    }
  }
  return [] as unknown[];
}

function visibleOptionEntries(model: MediaModelSummary | null) {
  if (!model?.options || !isRecord(model.options)) {
    return [] as Array<[string, Record<string, unknown>]>;
  }
  return Object.entries(model.options).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      !HIDDEN_STUDIO_OPTION_KEYS.has(entry[0]) && isRecord(entry[1]),
  );
}

function deriveUnsupportedOptionKeys(model: MediaModelSummary | null) {
  return visibleOptionEntries(model)
    .filter(([, schema]) => optionChoices(schema, schema.default).length === 0)
    .map(([optionKey]) => optionKey)
    .sort((left, right) => left.localeCompare(right));
}

function buildUnsupportedSummary(hiddenReason: string, unsupportedOptionKeys: string[]) {
  if (!unsupportedOptionKeys.length) {
    return hiddenReason;
  }
  return `${hiddenReason} Unsupported option controls: ${unsupportedOptionKeys.join(", ")}.`;
}

export function deriveStudioModelSupport(model: MediaModelSummary | null): StudioModelSupport {
  if (!model) {
    return {
      status: "unsupported",
      exposed: false,
      supportedInputPatterns: [],
      unsupportedInputPatterns: [],
      hiddenReason: "Studio could not load this model definition.",
      supportSummary: "Studio could not load this model definition.",
      unsupportedOptionKeys: [],
    };
  }

  const patterns = supportedModelInputPatterns(model);
  const unsupportedInputPatterns = patterns.filter((pattern) => !KNOWN_STUDIO_INPUT_PATTERNS.has(pattern));
  const unsupportedOptionKeys = deriveUnsupportedOptionKeys(model);
  const maxImageInputs = modelInputLimit(model, "image_inputs");
  const maxVideoInputs = modelInputLimit(model, "video_inputs");
  const maxAudioInputs = modelInputLimit(model, "audio_inputs");
  const patternSet = new Set(patterns);

  if (!patterns.length) {
    const hiddenReason = "Studio could not recognize any supported input pattern for this model.";
    return {
      status: "unsupported",
      exposed: false,
      supportedInputPatterns: [],
      unsupportedInputPatterns,
      hiddenReason,
      supportSummary: buildUnsupportedSummary(hiddenReason, unsupportedOptionKeys),
      unsupportedOptionKeys,
    };
  }

  if (unsupportedInputPatterns.length) {
    const hiddenReason = `Studio does not understand this model's input pattern yet: ${unsupportedInputPatterns.join(", ")}.`;
    return {
      status: "unsupported",
      exposed: false,
      supportedInputPatterns: patterns.filter((pattern) => KNOWN_STUDIO_INPUT_PATTERNS.has(pattern)),
      unsupportedInputPatterns,
      hiddenReason,
      supportSummary: buildUnsupportedSummary(hiddenReason, unsupportedOptionKeys),
      unsupportedOptionKeys,
    };
  }

  if (patternSet.has("multimodal_reference") && model.key !== "seedance-2.0") {
    const hiddenReason = "Studio only exposes multimodal reference contracts through the dedicated Seedance flow right now.";
    return {
      status: "unsupported",
      exposed: false,
      supportedInputPatterns: patterns,
      unsupportedInputPatterns,
      hiddenReason,
      supportSummary: buildUnsupportedSummary(hiddenReason, unsupportedOptionKeys),
      unsupportedOptionKeys,
    };
  }

  const promptOnly = patternSet.size === 1 && patternSet.has("prompt_only");
  const explicitFirstLastFrames =
    patternSet.has("first_last_frames") && maxImageInputs === 2 && maxVideoInputs === 0 && maxAudioInputs === 0;
  const explicitMotionControl =
    patternSet.has("motion_control") && maxImageInputs === 1 && maxVideoInputs === 1 && maxAudioInputs === 0;
  const explicitSingleImage =
    !patternSet.has("first_last_frames") &&
    !patternSet.has("motion_control") &&
    maxImageInputs === 1 &&
    maxVideoInputs === 0 &&
    maxAudioInputs === 0 &&
    (patternSet.has("single_image") || patternSet.has("image_edit"));
  const genericImageOnly =
    !patternSet.has("first_last_frames") &&
    !patternSet.has("motion_control") &&
    !patternSet.has("multimodal_reference") &&
    maxImageInputs > 1 &&
    maxVideoInputs === 0 &&
    maxAudioInputs === 0 &&
    Array.from(patternSet).every((pattern) => pattern === "prompt_only" || pattern === "single_image" || pattern === "image_edit") &&
    (patternSet.has("single_image") || patternSet.has("image_edit"));
  const supportedSeedance =
    model.key === "seedance-2.0" &&
    Array.from(patternSet).every((pattern) =>
      pattern === "prompt_only" ||
      pattern === "single_image" ||
      pattern === "first_last_frames" ||
      pattern === "multimodal_reference",
    );

  let status: StudioModelSupportStatus;
  let hiddenReason: string | null = null;
  let supportSummary: string | null = null;

  if (supportedSeedance) {
    status = "fully_supported";
    supportSummary = "Studio can use the dedicated Seedance frame and reference composer for this contract.";
  } else if (explicitMotionControl) {
    status = "fully_supported";
    supportSummary = "Studio can render explicit source-image and driving-video slots for this model.";
  } else if (explicitFirstLastFrames) {
    status = "fully_supported";
    supportSummary = "Studio can render explicit start-frame and end-frame slots for this model.";
  } else if (explicitSingleImage) {
    status = "fully_supported";
    supportSummary = "Studio can render the standard single-image slot for this model.";
  } else if (promptOnly) {
    status = "fully_supported";
    supportSummary = "Studio can use the standard prompt-only composer for this model.";
  } else if (genericImageOnly) {
    status = "generic_supported";
    supportSummary = `Studio will use the generic attachment composer for up to ${maxImageInputs} image inputs.`;
  } else {
    status = "unsupported";
    hiddenReason = "Studio does not have a safe composer contract for this mix of image, video, and audio inputs yet.";
    supportSummary = hiddenReason;
  }

  if (status !== "unsupported" && unsupportedOptionKeys.length) {
    status = "generic_supported";
    const optionSummary = `Some options still rely on provider defaults because Studio does not have dropdown controls for: ${unsupportedOptionKeys.join(", ")}.`;
    supportSummary = supportSummary ? `${supportSummary} ${optionSummary}` : optionSummary;
  }

  return {
    status,
    exposed: status !== "unsupported",
    supportedInputPatterns: patterns,
    unsupportedInputPatterns,
    hiddenReason,
    supportSummary,
    unsupportedOptionKeys,
  };
}
