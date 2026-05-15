import type { CSSProperties } from "react";

import type { GraphNodeDefinition } from "../types";

export const GRAPH_PORT_COLORS: Record<string, string> = {
  any: "#b8c0c2",
  asset: "#d5b16c",
  audio: "#6fd0d4",
  image: "#b7f14f",
  job: "#88a4ff",
  json: "#f2a65f",
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
  const minHeight = Math.max(170, previewSizeFloor?.height ?? 0, Math.floor(minSize.height ?? contentMinHeight));
  const maxWidth = Math.max(minWidth, Math.floor(maxSize.width ?? 860));
  const maxHeight = Math.max(minHeight, Math.floor(maxSize.height ?? 1200));
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

export function graphNodeIconToken(definition: GraphNodeDefinition) {
  return typeof definition.ui?.icon === "string" ? definition.ui.icon : "info";
}
