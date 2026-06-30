import type { MediaAsset, MediaReference } from "@/lib/types";
import { videoMetadataLabels } from "@/lib/video-metadata";
import type { GraphMediaPreview, GraphRun } from "../types";
import { normalizeGraphExecutionMode } from "./graph-node-execution";

export function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function closestAspectLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  const ratio = width / height;
  const common = [
    ["1:1", 1],
    ["2:3", 2 / 3],
    ["3:2", 3 / 2],
    ["3:4", 3 / 4],
    ["4:3", 4 / 3],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["21:9", 21 / 9],
  ] as const;
  const nearest = common.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), common[0]);
  if (Math.abs(nearest[1] - ratio) < 0.025) return nearest[0];
  return `${width}:${height}`;
}

function assetOutputMetadata(asset: MediaAsset): { width: number | null; height: number | null; durationSeconds: number | null } {
  const payload = asRecord(asset.payload);
  const outputs = payload?.outputs;
  const firstOutput = Array.isArray(outputs) ? asRecord(outputs[0]) : null;
  return {
    width: numberValue(firstOutput?.width),
    height: numberValue(firstOutput?.height),
    durationSeconds: numberValue(firstOutput?.duration_seconds),
  };
}

export function previewFromReference(reference: MediaReference | undefined): GraphMediaPreview | null {
  if (!reference) return null;
  const mediaType = reference.kind === "video" ? "video" : reference.kind === "audio" ? "audio" : "image";
  const url = mediaType === "image" ? reference.stored_url ?? reference.thumb_url ?? reference.poster_url : reference.stored_url;
  if (!url) return null;
  const width = reference.width ?? null;
  const height = reference.height ?? null;
  const metadataLabels = videoMetadataLabels({
    durationSeconds: reference.duration_seconds ?? null,
    width,
    height,
  });
  return {
    mediaType,
    url,
    fullUrl: reference.stored_url ?? url,
    posterUrl: mediaType === "video" || mediaType === "audio" ? reference.poster_url ?? reference.thumb_url ?? null : null,
    label: reference.original_filename ?? reference.reference_id,
    width,
    height,
    durationSeconds: reference.duration_seconds ?? null,
    durationLabel: metadataLabels.durationLabel,
    aspectLabel: metadataLabels.aspectLabel ?? closestAspectLabel(width, height),
    resolutionLabel: metadataLabels.resolutionLabel,
  };
}

export function previewFromAsset(asset: MediaAsset | undefined): GraphMediaPreview | null {
  if (!asset) return null;
  const mediaType = asset.generation_kind === "video" ? "video" : asset.generation_kind === "audio" ? "audio" : "image";
  const url =
    mediaType === "video"
      ? asset.hero_web_url ?? asset.hero_original_url ?? asset.hero_poster_url ?? asset.hero_thumb_url
      : mediaType === "audio"
        ? asset.hero_web_url ?? asset.hero_original_url ?? asset.hero_poster_url ?? asset.hero_thumb_url
        : asset.hero_thumb_url ?? asset.hero_poster_url ?? asset.hero_web_url ?? asset.hero_original_url;
  if (!url) return null;
  const metadata = assetOutputMetadata(asset);
  const metadataLabels = videoMetadataLabels(metadata);
  return {
    mediaType,
    url,
    fullUrl: asset.hero_original_url ?? asset.hero_web_url ?? url,
    posterUrl: mediaType === "video" || mediaType === "audio" ? asset.hero_poster_url ?? asset.hero_thumb_url ?? null : null,
    label: asset.prompt_summary ?? String(asset.asset_id),
    width: metadata.width,
    height: metadata.height,
    durationSeconds: metadata.durationSeconds,
    durationLabel: metadataLabels.durationLabel,
    aspectLabel: metadataLabels.aspectLabel ?? closestAspectLabel(metadata.width, metadata.height),
    resolutionLabel: metadataLabels.resolutionLabel,
  };
}

export function firstOutputRef(snapshot: Record<string, unknown> | undefined): { asset_id?: string; reference_id?: string } | null {
  if (!snapshot) return null;
  for (const port of ["image", "asset", "video", "audio", "track_1", "track_2", "value"]) {
    const refs = snapshot[port];
    if (Array.isArray(refs) && refs[0] && typeof refs[0] === "object") {
      return refs[0] as { asset_id?: string; reference_id?: string };
    }
  }
  return null;
}

export function outputRefs(snapshot: Record<string, unknown> | undefined): Array<{ asset_id?: string; reference_id?: string }> {
  if (!snapshot) return [];
  for (const port of ["images", "assets", "audios", "image", "asset", "video", "audio", "track_1", "track_2", "value"]) {
    const refs = snapshot[port];
    if (Array.isArray(refs)) {
      return refs.filter((ref): ref is { asset_id?: string; reference_id?: string } => Boolean(ref && typeof ref === "object"));
    }
  }
  return [];
}

export function assetIdsFromGraphRun(run: GraphRun | null | undefined): string[] {
  const ids = new Set<string>();
  const collect = (snapshot: Record<string, unknown> | undefined) => {
    outputRefs(snapshot).forEach((ref) => {
      if (ref.asset_id) ids.add(String(ref.asset_id));
    });
  };
  collect(run?.output_snapshot_json);
  run?.nodes?.forEach((node) => collect(node.output_snapshot_json));
  return Array.from(ids);
}

export function graphMediaDragPayload(payload: { source: "reference" | "asset"; id: string; mediaType?: string | null }) {
  return JSON.stringify(payload);
}

export function cloneRecord<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function nodeUiFromMetadata(metadata?: Record<string, unknown>) {
  const ui = asRecord(metadata?.ui);
  const execution = asRecord(metadata?.execution);
  const cachedArtifactIds = asRecord(execution?.cached_artifact_ids);
  return {
    collapsed: Boolean(ui?.collapsed),
    advancedExpanded: ui?.advancedExpanded === true,
    hasSavedAdvancedExpanded: ui ? Object.prototype.hasOwnProperty.call(ui, "advancedExpanded") : false,
    accentColor: typeof ui?.accentColor === "string" ? ui.accentColor : null,
    nodeColor: typeof ui?.nodeColor === "string" ? ui.nodeColor : null,
    nodeHeaderColor: typeof ui?.nodeHeaderColor === "string" ? ui.nodeHeaderColor : null,
    customTitle: typeof ui?.customTitle === "string" ? ui.customTitle : null,
    executionMode: normalizeGraphExecutionMode(execution?.mode),
    executionCache: {
      cachedRunId: typeof execution?.cached_run_id === "string" ? execution.cached_run_id : null,
      cachedArtifactIds: cachedArtifactIds
        ? Object.fromEntries(Object.entries(cachedArtifactIds).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((value) => typeof value === "string")))
        : undefined,
    },
  };
}

export function readGraphMediaDragPayload(dataTransfer: DataTransfer): { source: "reference" | "asset"; id: string; mediaType?: string | null } | null {
  const raw = dataTransfer.getData("application/x-media-studio-graph-media");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { source?: unknown; id?: unknown; mediaType?: unknown };
    if ((parsed.source === "reference" || parsed.source === "asset") && typeof parsed.id === "string") {
      return {
        source: parsed.source,
        id: parsed.id,
        mediaType: typeof parsed.mediaType === "string" ? parsed.mediaType : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}
