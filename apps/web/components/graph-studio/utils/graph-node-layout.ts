import type { CSSProperties } from "react";

import type { GraphMediaPreview, GraphNodeDefinition } from "../types";

export const GRAPH_PORT_COLORS: Record<string, string> = {
  any: "#b8c0c2",
  asset: "#d5b16c",
  audio: "#6fd0d4",
  image: "#b7f14f",
  job: "#88a4ff",
  json: "#f2a65f",
  music_track: "#6fd0d4",
  reference_media: "#7ed7a7",
  text: "#c88cff",
  video: "#60d2ff",
};

const GRAPH_NODE_ACCENTS: Record<string, string> = {
  blue: "#73a7ff",
  cyan: "#60d2ff",
  green: "#b7f14f",
  orange: "#f2a65f",
  purple: "#c88cff",
  yellow: "#f5d76e",
};

type SizeValue = {
  width?: unknown;
  height?: unknown;
};

export type ComputedGraphNodeLayout = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  style: CSSProperties;
};

export type GraphNodeLayoutOptions = {
  visibleFieldCount?: number;
  visiblePortCount?: number;
  textareaCount?: number;
};

export type GraphMediaPreviewFitSize = {
  width: number;
  height: number;
  autoSizedHeight: number;
};

type GraphNodePlacementLike = {
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  style?: { width?: unknown; height?: unknown };
};

type GraphNodePlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const GRAPH_NODE_COLLAPSED_HEIGHT = 54;
export const GRAPH_NODE_AUTO_HEIGHT_HARD_MAX = 3200;
const GRAPH_NODE_PLACEMENT_GAP = 72;
const GRAPH_NODE_PLACEMENT_ORIGIN = { x: 120, y: 120 };
const GRAPH_NODE_PLACEMENT_FALLBACK_WIDTH = 360;
const GRAPH_NODE_PLACEMENT_FALLBACK_HEIGHT = 280;
const GRAPH_NODE_PLACEMENT_COLUMN_LIMIT = 6;

export function graphNodeUsesContentAutoHeight(definitionOrType: GraphNodeDefinition | string) {
  const type = typeof definitionOrType === "string" ? definitionOrType : definitionOrType.type;
  if (type === "display.any") return false;
  if (type.startsWith("media.load_") || type.startsWith("media.save_") || type.startsWith("preview.")) return false;
  if (typeof definitionOrType !== "string" && definitionOrType.ui?.preview) return false;
  return true;
}

export function resolveGraphNodeCollapseStyle(options: {
  collapsed: boolean;
  autoSizedHeight?: number | null;
  minHeight: number;
  maxHeight: number;
}) {
  if (options.collapsed) {
    return { height: GRAPH_NODE_COLLAPSED_HEIGHT, minHeight: GRAPH_NODE_COLLAPSED_HEIGHT };
  }
  const autoSizedHeight = typeof options.autoSizedHeight === "number" && Number.isFinite(options.autoSizedHeight) ? options.autoSizedHeight : null;
  const autoMaxHeight = Math.max(options.maxHeight, GRAPH_NODE_AUTO_HEIGHT_HARD_MAX);
  const height = autoSizedHeight == null ? options.minHeight : clamp(autoSizedHeight, options.minHeight, autoMaxHeight);
  return { height, minHeight: Math.min(options.minHeight, height) };
}

export function resolveGraphContentAutoHeight(options: {
  requiredHeight: number;
  minHeight: number;
  maxHeight: number;
  currentHeight: number;
  previousAutoHeight?: number | null;
}) {
  const normalizedRequiredHeight = Math.max(0, Math.ceil(options.requiredHeight));
  if (!normalizedRequiredHeight) return null;
  const autoMaxHeight = Math.max(options.maxHeight, GRAPH_NODE_AUTO_HEIGHT_HARD_MAX);
  const clampedRequiredHeight = clamp(normalizedRequiredHeight, options.minHeight, autoMaxHeight);
  const currentHeight = Math.max(0, Math.ceil(options.currentHeight));
  const previousAutoHeight = typeof options.previousAutoHeight === "number" && Number.isFinite(options.previousAutoHeight) ? options.previousAutoHeight : null;
  const preservesManualHeight = previousAutoHeight != null && currentHeight > previousAutoHeight + 4 && currentHeight > clampedRequiredHeight;
  return {
    autoSizedHeight: clampedRequiredHeight,
    height: preservesManualHeight ? clamp(currentHeight, clampedRequiredHeight, autoMaxHeight) : clampedRequiredHeight,
    minHeight: options.minHeight,
  };
}

export function shouldSyncGraphContentAutoHeight(options: {
  requiredHeight: number;
  currentWrapperHeight?: number | null;
  previousMeasuredHeight?: number | null;
}) {
  const requiredHeight = Math.max(0, Math.ceil(options.requiredHeight));
  if (!requiredHeight) return false;
  const previousMeasuredHeight =
    typeof options.previousMeasuredHeight === "number" && Number.isFinite(options.previousMeasuredHeight)
      ? Math.ceil(options.previousMeasuredHeight)
      : null;
  const currentWrapperHeight =
    typeof options.currentWrapperHeight === "number" && Number.isFinite(options.currentWrapperHeight)
      ? Math.ceil(options.currentWrapperHeight)
      : null;
  if (previousMeasuredHeight == null || Math.abs(previousMeasuredHeight - requiredHeight) > 2) return true;
  return currentWrapperHeight != null && currentWrapperHeight + 2 < requiredHeight;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sizeFromUi(value: unknown): { width: number | null; height: number | null } {
  const size = (value ?? {}) as SizeValue;
  return {
    width: numberOrNull(size.width),
    height: numberOrNull(size.height),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function currentNodeSize(node: { width?: number | null; height?: number | null; style?: { width?: unknown; height?: unknown } }) {
  return {
    width: numberOrNull(node.width) ?? numberOrNull(node.style?.width),
    height: numberOrNull(node.height) ?? numberOrNull(node.style?.height),
  };
}

export function graphNodePlacementSize(node: Omit<GraphNodePlacementLike, "position">) {
  return {
    width: numberOrNull(node.width) ?? numberOrNull(node.style?.width) ?? GRAPH_NODE_PLACEMENT_FALLBACK_WIDTH,
    height: numberOrNull(node.height) ?? numberOrNull(node.style?.height) ?? GRAPH_NODE_PLACEMENT_FALLBACK_HEIGHT,
  };
}

function graphNodePlacementRect(node: GraphNodePlacementLike): GraphNodePlacementRect {
  const size = graphNodePlacementSize(node);
  return { x: node.position.x, y: node.position.y, ...size };
}

function placementRectsOverlap(first: GraphNodePlacementRect, second: GraphNodePlacementRect, gap: number) {
  return !(
    first.x + first.width + gap <= second.x ||
    second.x + second.width + gap <= first.x ||
    first.y + first.height + gap <= second.y ||
    second.y + second.height + gap <= first.y
  );
}

export function findOpenGraphNodePosition({
  existingNodes,
  size,
  preferredPosition = GRAPH_NODE_PLACEMENT_ORIGIN,
}: {
  existingNodes: GraphNodePlacementLike[];
  size: { width: number; height: number };
  preferredPosition?: { x: number; y: number };
}) {
  const occupied = existingNodes.map(graphNodePlacementRect);
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const rowStep = height + GRAPH_NODE_PLACEMENT_GAP;
  const columnStep = width + GRAPH_NODE_PLACEMENT_GAP + 120;
  const start = {
    x: Number.isFinite(preferredPosition.x) ? preferredPosition.x : GRAPH_NODE_PLACEMENT_ORIGIN.x,
    y: Number.isFinite(preferredPosition.y) ? preferredPosition.y : GRAPH_NODE_PLACEMENT_ORIGIN.y,
  };
  let candidate = { ...start };

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const candidateRect = { ...candidate, width, height };
    if (!occupied.some((rect) => placementRectsOverlap(candidateRect, rect, GRAPH_NODE_PLACEMENT_GAP))) {
      return candidate;
    }
    const nextRow = (attempt + 1) % GRAPH_NODE_PLACEMENT_COLUMN_LIMIT;
    candidate =
      nextRow === 0
        ? { x: candidate.x + columnStep, y: start.y }
        : { x: candidate.x, y: candidate.y + rowStep };
  }

  return {
    x: start.x + occupied.length * columnStep,
    y: start.y,
  };
}

function accentColor(definition: GraphNodeDefinition) {
  const ui = definition.ui ?? {};
  const rawColor = typeof ui.color === "string" ? ui.color : typeof ui.accent === "string" ? ui.accent : "blue";
  if (rawColor.startsWith("#")) return rawColor;
  return GRAPH_NODE_ACCENTS[rawColor] ?? GRAPH_NODE_ACCENTS.blue;
}

function mediaPreviewSizeFloor(definition: GraphNodeDefinition) {
  const hasPreview = Boolean(definition.ui?.preview) || definition.type.startsWith("media.load_") || definition.type.startsWith("media.save_");
  if (!hasPreview) return null;
  const mediaTypes = [
    definition.type.includes("video") || definition.ports.inputs.some((port) => port.type === "video") || definition.ports.outputs.some((port) => port.type === "video")
      ? "video"
      : null,
    definition.type.includes("image") || definition.ports.inputs.some((port) => port.type === "image") || definition.ports.outputs.some((port) => port.type === "image")
      ? "image"
      : null,
  ];
  if (mediaTypes.includes("video")) return { width: 380, height: 360 };
  if (mediaTypes.includes("image")) return { width: 360, height: 360 };
  return null;
}

export function graphPortColor(portType: string | null | undefined) {
  if (!portType) return GRAPH_PORT_COLORS.any;
  return GRAPH_PORT_COLORS[portType] ?? GRAPH_PORT_COLORS.any;
}

export function graphEdgeClassForPortType(portType: string | null | undefined) {
  return `graph-edge graph-edge-${portType ?? "unknown"}`;
}

export function graphEdgeStyleForPortType(portType: string | null | undefined): CSSProperties {
  return { stroke: graphPortColor(portType), strokeLinecap: "round", strokeLinejoin: "round" };
}

export function computeGraphNodeLayout(
  definition: GraphNodeDefinition,
  metadata?: Record<string, unknown>,
  options?: GraphNodeLayoutOptions,
): ComputedGraphNodeLayout {
  const ui = definition.ui ?? {};
  const defaultSize = sizeFromUi(ui.default_size);
  const minSize = sizeFromUi(ui.min_size);
  const maxSize = sizeFromUi(ui.max_size);
  const visibleFields = definition.fields.filter((field) => !field.hidden);
  const visiblePorts = [...definition.ports.inputs, ...definition.ports.outputs].filter((port) => !port.advanced);
  const textareaCount = visibleFields.filter((field) => field.type === "textarea").length;
  const hasPreview = Boolean(ui.preview) || definition.type.startsWith("media.load_") || definition.type.startsWith("media.save_");
  const contentMinWidth = hasPreview ? 260 : 240;
  const fieldCount = options?.visibleFieldCount ?? visibleFields.length;
  const portCount = options?.visiblePortCount ?? visiblePorts.length;
  const dynamicTextareaCount = options?.textareaCount ?? textareaCount;
  const contentMinHeight = 132 + fieldCount * 52 + portCount * 28 + dynamicTextareaCount * 70 + (hasPreview ? 140 : 0);
  const previewSizeFloor = mediaPreviewSizeFloor(definition);
  const minWidth = Math.max(contentMinWidth, previewSizeFloor?.width ?? 0, Math.floor(minSize.width ?? 240));
  const minHeight = Math.max(170, previewSizeFloor?.height ?? 0, Math.floor(contentMinHeight), Math.floor(minSize.height ?? 0));
  const fallbackMaxWidth = hasPreview ? 2400 : 860;
  const fallbackMaxHeight = hasPreview ? 2400 : 1200;
  const maxWidth = Math.max(minWidth, Math.floor(maxSize.width ?? fallbackMaxWidth));
  const maxHeight = Math.max(minHeight, Math.floor(maxSize.height ?? fallbackMaxHeight));
  const styleMetadata = ((metadata?.style ?? {}) as { width?: unknown; height?: unknown }) ?? {};
  const requestedWidth = numberOrNull(styleMetadata.width) ?? defaultSize.width ?? minWidth;
  const requestedHeight = numberOrNull(styleMetadata.height) ?? defaultSize.height ?? minHeight;
  const width = clamp(Math.floor(requestedWidth), minWidth, maxWidth);
  const height = clamp(Math.floor(requestedHeight), minHeight, maxHeight);
  const accent = accentColor(definition);
  return {
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    style: {
      "--graph-node-accent": accent,
      "--graph-node-handle": accent,
    } as CSSProperties,
  };
}

export function graphMediaPreviewFitSignature(preview: GraphMediaPreview | null | undefined) {
  if (!preview?.width || !preview.height || (preview.mediaType !== "image" && preview.mediaType !== "video")) return "";
  return `${preview.mediaType}:${preview.width}x${preview.height}:${preview.url}`;
}

export function computeGraphMediaPreviewFitSize(options: {
  definition: GraphNodeDefinition;
  node: { width?: number | null; height?: number | null; style?: { width?: unknown; height?: unknown } };
  preview: GraphMediaPreview | null | undefined;
  autoSizedHeight?: number | null;
}): GraphMediaPreviewFitSize | null {
  const { definition, node, preview } = options;
  if (!preview?.width || !preview.height) return null;
  if (preview.mediaType !== "image" && preview.mediaType !== "video") return null;
  const isMediaNode =
    definition.type === "display.any" ||
    definition.type.startsWith("media.load_") ||
    definition.type.startsWith("media.save_") ||
    Boolean(definition.ui?.preview);
  if (!isMediaNode) return null;

  const layout = computeGraphNodeLayout(definition);
  const current = currentNodeSize(node);
  const currentHeight = current.height ?? layout.height;
  const autoSizedHeight = numberOrNull(options.autoSizedHeight);
  if (autoSizedHeight != null && Math.abs(currentHeight - autoSizedHeight) > 2) return null;

  const ratio = clamp(preview.width / preview.height, 0.3, 3.2);
  const isPortrait = ratio < 0.82;
  const isLandscape = ratio > 1.18;
  const previewBox = isPortrait ? 430 : isLandscape ? 360 : 380;
  const contentWidth = isPortrait ? Math.max(300, previewBox * ratio) : Math.max(360, previewBox * ratio);
  const desiredWidth = clamp(Math.ceil(contentWidth + 42), layout.minWidth, layout.maxWidth);
  const previewHeight = isLandscape ? Math.max(220, desiredWidth / ratio - 42) : previewBox;
  const baseWithoutPreview = Math.max(layout.minHeight - 140, 220);
  const desiredHeight = clamp(Math.ceil(baseWithoutPreview + previewHeight), layout.minHeight, layout.maxHeight);
  const currentWidth = current.width ?? layout.width;
  const nextWidth = desiredWidth > currentWidth + 2 ? desiredWidth : currentWidth;
  const nextHeight = desiredHeight > currentHeight + 2 ? desiredHeight : currentHeight;
  if (Math.abs(nextWidth - currentWidth) <= 2 && Math.abs(nextHeight - currentHeight) <= 2) return null;
  return {
    width: nextWidth,
    height: nextHeight,
    autoSizedHeight: nextHeight,
  };
}

export function graphNodeIconToken(definition: GraphNodeDefinition) {
  return typeof definition.ui?.icon === "string" ? definition.ui.icon : "info";
}
