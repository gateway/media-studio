import type { AttachmentRecord } from "@/lib/media-studio-contract";
import type { MediaAsset, MediaModelSummary } from "@/lib/types";
import { formatVideoDuration } from "@/lib/video-metadata";

const KLING_MOTION_CONTROL_MODEL_KEYS = new Set(["kling-2.6-motion", "kling-3.0-motion"]);
const KLING_MOTION_MIN_DURATION_SECONDS = 3;
const KLING_MOTION_IMAGE_ORIENTATION_MAX_SECONDS = 10;
const KLING_MOTION_VIDEO_ORIENTATION_MAX_SECONDS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function modelHasMotionControlPattern(model: MediaModelSummary | null) {
  return Array.isArray(model?.input_patterns) && model.input_patterns.includes("motion_control");
}

export function motionVideoDurationFromAsset(asset: MediaAsset | null): number | null {
  if (asset?.generation_kind !== "video") return null;
  const directDuration = finiteNumber((asset as unknown as Record<string, unknown>).duration_seconds);
  if (directDuration != null) return directDuration;
  const payload = isRecord(asset.payload) ? asset.payload : null;
  const outputs = Array.isArray(payload?.outputs) ? payload.outputs : [];
  for (const output of outputs) {
    if (!isRecord(output)) continue;
    const duration = finiteNumber(output.duration_seconds ?? output.durationSeconds);
    if (duration != null) return duration;
  }
  return null;
}

export function motionVideoDurationFromAttachments(
  attachments: Array<Pick<AttachmentRecord, "kind" | "durationSeconds" | "referenceRecord">>,
) {
  for (const attachment of attachments) {
    if (attachment.kind !== "videos") continue;
    const duration = finiteNumber(attachment.durationSeconds ?? attachment.referenceRecord?.duration_seconds);
    if (duration != null) return duration;
  }
  return null;
}

function normalizeCharacterOrientation(value: unknown) {
  return value === "video" ? "video" : "image";
}

export function motionControlVideoInputError({
  model,
  attachments,
  sourceAsset,
  optionValues,
}: {
  model: MediaModelSummary | null;
  attachments: AttachmentRecord[];
  sourceAsset: MediaAsset | null;
  optionValues: Record<string, unknown>;
}) {
  if (!model?.key || !KLING_MOTION_CONTROL_MODEL_KEYS.has(model.key) || !modelHasMotionControlPattern(model)) {
    return null;
  }

  const durationSeconds =
    motionVideoDurationFromAttachments(attachments) ?? motionVideoDurationFromAsset(sourceAsset);
  if (durationSeconds == null) return null;

  const orientation = normalizeCharacterOrientation(optionValues.character_orientation);
  const maxDuration =
    orientation === "video"
      ? KLING_MOTION_VIDEO_ORIENTATION_MAX_SECONDS
      : KLING_MOTION_IMAGE_ORIENTATION_MAX_SECONDS;
  const durationLabel = formatVideoDuration(durationSeconds) ?? `${durationSeconds}s`;

  if (durationSeconds < KLING_MOTION_MIN_DURATION_SECONDS) {
    return `Driving video is ${durationLabel}. Kling motion control requires at least ${KLING_MOTION_MIN_DURATION_SECONDS}s.`;
  }

  if (durationSeconds > maxDuration) {
    return `Driving video is ${durationLabel}. Kling motion control allows up to ${maxDuration}s when character orientation is ${orientation}.`;
  }

  return null;
}
