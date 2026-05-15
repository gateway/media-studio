import type { StudioNode } from "../types";
import { cloneRecord } from "./graph-media-preview";

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function styleForCopiedGraphNode(node: StudioNode): StudioNode["style"] {
  const style = cloneRecord(node.style ?? {}) as NonNullable<StudioNode["style"]>;
  const width = numberOrNull(node.width) ?? numberOrNull(style.width);
  const height = numberOrNull(node.height) ?? numberOrNull(style.height);
  if (width != null) style.width = width;
  if (height != null) style.height = height;
  return style;
}
